from flask import Flask, request, jsonify, render_template, send_file, session, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from dotenv import load_dotenv, set_key
from groq import Groq
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, Image as RLImage
from reportlab.lib import colors
from datetime import datetime
import os
import io
from textwrap import wrap

import json

import requests
import threading
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
ENV_PATH = os.path.join(BASE_DIR, '.env')

load_dotenv(ENV_PATH, override=True)

# load Stability AI key after env vars are ready
stability_api_key = os.getenv('STABILITY_API_KEY')
print(f"[debug] stability_api_key loaded: {repr(stability_api_key)}")
if not stability_api_key:
    print("Warning: STABILITY_API_KEY not set; image generation features may fail.")

groq_api_key = os.getenv("GROQ_API_KEY")
if not groq_api_key:
    raise ValueError("GROQ_API_KEY is not set in the environment variables. Please check your .env file.")

client = Groq(api_key=groq_api_key)

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev-secret-change-me")

AUTH_USER = os.getenv("MARKETAI_USERNAME", "admin")
AUTH_PASS = os.getenv("MARKETAI_PASSWORD", "admin")

db_path = os.path.join(BASE_DIR, 'database', 'marketai.db')

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + db_path
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)


class Lead(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100))
    budget = db.Column(db.Integer)
    urgency = db.Column(db.Integer)
    authority = db.Column(db.Integer)
    score = db.Column(db.Integer)
    category = db.Column(db.String(20))


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class LeadScoreRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)

    name = db.Column(db.String(120), nullable=True)
    email = db.Column(db.String(160), nullable=True)
    company = db.Column(db.String(160), nullable=True)

    demographic_score = db.Column(db.Integer, nullable=False, default=0)  # 0..10
    behavior_score = db.Column(db.Integer, nullable=False, default=0)  # 0..10
    financial_score = db.Column(db.Integer, nullable=False, default=0)  # 0..10
    engagement_score = db.Column(db.Integer, nullable=False, default=0)  # 0..10
    need_fit_score = db.Column(db.Integer, nullable=False, default=0)  # 0..10

    total_score = db.Column(db.Integer, nullable=False, default=0)  # 0..100
    category = db.Column(db.String(20), nullable=False, default="Cold")  # Cold/Warm/Hot

    notes_json = db.Column(db.Text, nullable=True)  # free-form notes for each factor
    breakdown_json = db.Column(db.Text, nullable=True)  # weight/breakdown + recommendations

with app.app_context():
    db.create_all()


def is_logged_in():
    return bool(session.get("user"))


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_logged_in():
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


@app.before_request
def enforce_auth():
    public_paths = {"/login", "/signup", "/logout"}
    if request.path in public_paths or request.path.startswith("/static/"):
        return None

    if is_logged_in():
        return None

    # APIs return JSON; pages redirect.
    if request.path.startswith("/") and request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        return jsonify({"error": "Unauthorized"}), 401

    return redirect(url_for("login", next=request.path))


def _clamp_int(v, lo, hi, default=0):
    try:
        n = int(v)
    except Exception:
        return default
    return max(lo, min(hi, n))


def score_lead(payload):
    """
    Deterministic lead scoring using 5 factors (0..10 each).
    Weighted equally to produce a 0..100 total.
    """
    demo = _clamp_int(payload.get("demographic_score"), 0, 10, 0)
    beh = _clamp_int(payload.get("behavior_score"), 0, 10, 0)
    fin = _clamp_int(payload.get("financial_score"), 0, 10, 0)
    eng = _clamp_int(payload.get("engagement_score"), 0, 10, 0)
    fit = _clamp_int(payload.get("need_fit_score"), 0, 10, 0)

    weights = {
        "demographic": 20,
        "behavior": 20,
        "financial": 20,
        "engagement": 20,
        "need_fit": 20,
    }

    total = round(
        (demo / 10) * weights["demographic"]
        + (beh / 10) * weights["behavior"]
        + (fin / 10) * weights["financial"]
        + (eng / 10) * weights["engagement"]
        + (fit / 10) * weights["need_fit"]
    )

    if total >= 75:
        category = "Hot"
    elif total >= 45:
        category = "Warm"
    else:
        category = "Cold"

    recommendations = []
    if fit <= 4:
        recommendations.append("Improve need/problem fit: clarify pain points, refine ICP, add proof (case studies).")
    if eng <= 4:
        recommendations.append("Increase engagement: send tailored follow-ups, offer demo, add retargeting & nurture email.")
    if fin <= 4:
        recommendations.append("Qualify budget: confirm willingness to pay, propose lower tier, or adjust package/value.")
    if beh <= 4:
        recommendations.append("Capture behavior intent: track key actions (pricing page, demo request), personalize outreach.")
    if demo <= 4:
        recommendations.append("Refine demographic match: target roles/industries/regions that convert best.")

    breakdown = {
        "inputs": {
            "demographic": demo,
            "behavior": beh,
            "financial": fin,
            "engagement": eng,
            "need_fit": fit,
        },
        "weights": weights,
        "total_score": total,
        "category": category,
        "recommendations": recommendations[:6],
    }

    return {
        "total_score": total,
        "category": category,
        "breakdown": breakdown,
    }



def generate_detailed_campaign(product, audience, platform):
    """Generate detailed campaign content using AI"""
    prompt = f"""
    Create a DETAILED, COMPREHENSIVE professional marketing campaign with the following sections:
    
    Product: {product}
    Target Audience: {audience}
    Platform: {platform}
    
    Please provide DETAILED output in this exact format:
    
    1. CAMPAIGN OBJECTIVE:
    [Provide 2-3 sentences clearly stating the goal]
    
    2. TARGET AUDIENCE INSIGHT:
    [Provide detailed demographic, psychographic, and behavioral insights]
    
    3. KEY MESSAGING PILLARS:
    [List 3-4 core messages with detailed explanation]
    
    4. CAMPAIGN TAGLINE:
    [Create a catchy, memorable tagline]
    
    5. EMAIL MARKETING:
    Subject Line: [Engaging subject line]
    Preview Text: [Preview text]
    Email Body: [Detailed email content - 150+ words]
    
    6. SOCIAL MEDIA STRATEGY:
    - Platform: {platform}
    - Content Themes: [List 3-4 content themes]
    - Posting Strategy: [Frequency and timing recommendations]
    - Hashtag Strategy: [Relevant hashtags]
    - Engagement Tactics: [How to engage audience]
    
    7. CALL TO ACTION:
    Primary CTA: [Main action]
    Secondary CTA: [Supporting action]
    CTA Copy: [Persuasive CTA text]
    
    8. SUCCESS METRICS:
    - KPI 1: [Metric and target]
    - KPI 2: [Metric and target]
    - KPI 3: [Metric and target]
    
    9. CAMPAIGN TIMELINE:
    [Provide a week-by-week breakdown for 4 weeks]
    
    10. BUDGET ALLOCATION RECOMMENDATION:
    [Breakdown recommended budget across channels]
    """
    
    try:
        chat_completion = client.chat.completions.create(
            messages=[
                {"role": "user", "content": prompt}
            ],
            model="llama-3.1-8b-instant"
        )
        return chat_completion.choices[0].message.content
    except Exception as e:
        print(f"Groq API Error: {str(e)}")
        raise Exception(f"Failed to generate campaign: {str(e)}")


def generate_campaign_from_description(description):
    """Use free-form description to build a campaign."""
    prompt = f"""
    The user has provided the following description for a marketing campaign:

    {description}

    Based on that description, create a full professional marketing campaign
    following this structured format:

    1. CAMPAIGN OBJECTIVE:
    2. TARGET AUDIENCE INSIGHT:
    3. KEY MESSAGING PILLARS:
    4. CAMPAIGN TAGLINE:
    5. EMAIL MARKETING (Subject, Preview, Body):
    6. SOCIAL MEDIA STRATEGY:
       - Platforms and themes
       - Posting strategy
       - Hashtags
       - Engagement tactics
    7. CALL TO ACTION (Primary, Secondary, Copy):
    8. SUCCESS METRICS:
    9. CAMPAIGN TIMELINE:
    10. BUDGET ALLOCATION RECOMMENDATION:

    Be thorough, creative, and make reasonable assumptions when details are missing.
    """
    try:
        chat_completion = client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant"
        )
        return chat_completion.choices[0].message.content
    except Exception as e:
        print(f"Groq API Error (description): {str(e)}")
        raise


def extract_product_features(product_name, details):
    """Call AI to summarize key features and style cues for a product."""
    prompt = f"""
    Analyze the following product and provide 3-5 important features as bullet points.
    Also suggest visual style elements (colors, mood, layout ideas) that would work
    well on a promotional poster.

    Product Name: {product_name}
    Details: {details}
    """
    try:
        completion = client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant"
        )
        return completion.choices[0].message.content
    except Exception as e:
        print(f"Error extracting features: {e}")
        return ""



@app.route('/admin/check-stability-key', methods=['GET'])
@login_required
def check_stability_key():
    """Validate the currently loaded STABILITY_API_KEY by querying the Stability account endpoint."""
    if not stability_api_key:
        return jsonify({"ok": False, "message": "No STABILITY_API_KEY configured."}), 400
    headers = {"Authorization": f"Bearer {stability_api_key}"}
    try:
        resp = requests.get("https://api.stability.ai/v1/user/account", headers=headers, timeout=10)
        if resp.status_code == 200:
            return jsonify({"ok": True, "message": "Key is valid (account reachable)."})
        if resp.status_code == 401:
            return jsonify({"ok": False, "message": "Unauthorized (invalid or expired key)."}), 200
        return jsonify({"ok": False, "message": f"Unexpected status {resp.status_code}", "detail": resp.text}), 200
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route('/admin/rotate-stability-key', methods=['POST'])
@login_required
def rotate_stability_key():
    """Accept a new Stability API key, persist it to `.env`, update in-process, and validate it."""
    payload = request.json or {}
    new_key = payload.get('key')
    if not new_key:
        return jsonify({"ok": False, "message": "Missing 'key' in JSON payload."}), 400

    try:
        # Persist to .env
        set_key(ENV_PATH, 'STABILITY_API_KEY', new_key)
        # Update in-process variable
        global stability_api_key
        stability_api_key = new_key

        # Quick validation
        headers = {"Authorization": f"Bearer {stability_api_key}"}
        try:
            resp = requests.get("https://api.stability.ai/v1/user/account", headers=headers, timeout=10)
            if resp.status_code == 200:
                return jsonify({"ok": True, "message": "Key stored and validated."})
            if resp.status_code == 401:
                return jsonify({"ok": True, "message": "Key stored but validation failed: Unauthorized (invalid/expired)."}), 200
            return jsonify({"ok": True, "message": f"Key stored; validation returned {resp.status_code}", "detail": resp.text}), 200
        except Exception as e:
            return jsonify({"ok": True, "message": "Key stored but validation request failed.", "error": str(e)}), 200

    except Exception as ex:
        return jsonify({"ok": False, "error": str(ex)}), 500




def create_campaign_pdf(campaign_content, product, audience, platform):
    """Create a professional PDF document from campaign content with INR formatting"""
    
    pdf_buffer = io.BytesIO()
    pdf = SimpleDocTemplate(pdf_buffer, pagesize=letter, topMargin=0.5*inch, bottomMargin=0.5*inch)
    
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=28,
        textColor=colors.HexColor('#1f4788'),
        spaceAfter=12,
        alignment=1,  # Center alignment
        fontName='Helvetica-Bold'
    )
    
    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=14,
        textColor=colors.HexColor('#ffffff'),
        backColor=colors.HexColor('#1f4788'),
        spaceAfter=8,
        spaceBefore=12,
        fontName='Helvetica-Bold',
        leftIndent=5,
        rightIndent=5,
        topPadding=5,
        bottomPadding=5
    )
    
    subheading_style = ParagraphStyle(
        'SubHeading',
        parent=styles['Heading3'],
        fontSize=11,
        textColor=colors.HexColor('#2563eb'),
        spaceAfter=6,
        spaceBefore=6,
        fontName='Helvetica-Bold'
    )
    
    body_style = ParagraphStyle(
        'CustomBody',
        parent=styles['BodyText'],
        fontSize=10,
        spaceAfter=8,
        alignment=4,  # Left alignment
        leading=14
    )
    
    elements = []
    
    elements.append(Paragraph("MARKETING CAMPAIGN STRATEGY", title_style))
    elements.append(Spacer(1, 0.1*inch))
    
    info_data = [
        ['<b>Product:</b>', product if product else 'N/A'],
        ['<b>Target Audience:</b>', audience if audience else 'N/A'],
        ['<b>Platform:</b>', platform if platform else 'N/A'],
        ['<b>Generated Date:</b>', datetime.now().strftime("%B %d, %Y")],
        ['<b>Currency:</b>', '₹ INR (Indian Rupees)']
    ]
    
    info_table = Table(info_data, colWidths=[1.8*inch, 3.7*inch])
    info_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#d9e8ff')),
        ('BACKGROUND', (1, 0), (1, -1), colors.HexColor('#f0f4ff')),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#1f4788')),
        ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
        ('ALIGN', (1, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#bfdbfe'))
    ]))
    
    elements.append(info_table)
    elements.append(Spacer(1, 0.4*inch))
    
    sections = campaign_content.split('\n')
    current_section = ""
    
    for line in sections:
        line = line.strip()
        
        if not line:
            if current_section:
                elements.append(Paragraph(current_section, body_style))
                current_section = ""
            elements.append(Spacer(1, 0.08*inch))
            continue
        
        if any(line.startswith(f"{i}.") for i in range(1, 12)):
            if current_section:
                elements.append(Paragraph(current_section, body_style))
                current_section = ""
            elements.append(Paragraph(f"<b>{line}</b>", heading_style))
        
        elif line.endswith(':') and not any(c.isdigit() for c in line.split('.')[0]):
            if current_section:
                elements.append(Paragraph(current_section, body_style))
                current_section = ""
            elements.append(Paragraph(f"<b>{line}</b>", subheading_style))
        
        elif any(keyword in line.lower() for keyword in ['budget', 'cost', 'price', 'allocation', '₹', 'inr', 'rupees']):
            if current_section:
                elements.append(Paragraph(current_section, body_style))
                current_section = ""
            if '₹' not in line and 'inr' not in line.lower():
                formatted_line = f"<b>{line}</b> (₹ INR)"
                elements.append(Paragraph(formatted_line, subheading_style))
            else:
                elements.append(Paragraph(f"<b>{line}</b>", subheading_style))
        
        else:
            current_section += line + " "
    
    if current_section:
        elements.append(Paragraph(current_section, body_style))
    
    elements.append(Spacer(1, 0.4*inch))
    footer_line = Paragraph("_" * 80, body_style)
    elements.append(footer_line)
    
    footer_text = f"<b>MarketAI Suite</b> | Generated on {datetime.now().strftime('%A, %B %d, %Y at %I:%M %p')} | Currency: ₹ INR"
    elements.append(Paragraph(footer_text, subheading_style))
    
    pdf.build(elements)
    pdf_buffer.seek(0)
    
    return pdf_buffer


@app.route('/')
@login_required
def home():
    return render_template('index.html')


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        if is_logged_in():
            return redirect(url_for("home"))
        return render_template("login.html", error=None)

    username = (request.form.get("username") or "").strip()
    password = request.form.get("password") or ""

    user = User.query.filter_by(username=username).first() if username else None
    is_db_ok = bool(user and check_password_hash(user.password_hash, password))
    is_env_ok = username == AUTH_USER and password == AUTH_PASS

    if is_db_ok or is_env_ok:
        session["user"] = username
        next_url = request.args.get("next") or "/"
        if not next_url.startswith("/"):
            next_url = "/"
        return redirect(next_url)

    return render_template("login.html", error="Invalid username or password.")


@app.route("/signup", methods=["GET", "POST"])
def signup():
    if request.method == "GET":
        if is_logged_in():
            return redirect(url_for("home"))
        return render_template("signup.html", error=None)

    username = (request.form.get("username") or "").strip()
    password = request.form.get("password") or ""
    confirm = request.form.get("confirm_password") or ""

    if not username or len(username) < 3:
        return render_template("signup.html", error="Username must be at least 3 characters.")
    if not password or len(password) < 6:
        return render_template("signup.html", error="Password must be at least 6 characters.")
    if password != confirm:
        return render_template("signup.html", error="Passwords do not match.")

    exists = User.query.filter_by(username=username).first()
    if exists:
        return render_template("signup.html", error="Username already exists. Please choose another.")

    user = User(username=username, password_hash=generate_password_hash(password))
    db.session.add(user)
    db.session.commit()

    session["user"] = username
    return redirect(url_for("home"))


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))



@app.route('/generate-campaign', methods=['POST'])
def generate_campaign():
    try:
        data = request.json
        description = data.get("description")

        if description:
            campaign = generate_campaign_from_description(description)
            return jsonify({"campaign": campaign})

        product = data.get("product")
        audience = data.get("audience")
        platform = data.get("platform")

        if not product or not audience or not platform:
            return jsonify({"error": "Missing required fields"}), 400

        campaign = generate_detailed_campaign(product, audience, platform)

        return jsonify({"campaign": campaign})
    
    except Exception as e:
        print(f"Error in generate_campaign: {str(e)}")
        return jsonify({"error": f"Server error: {str(e)}"}), 500


@app.route('/download-campaign-pdf', methods=['POST'])
def download_campaign_pdf():
    """Generate and download campaign as PDF"""
    try:
        data = request.json
        product = data.get("product")
        audience = data.get("audience")
        platform = data.get("platform")
        campaign_content = data.get("campaign_content")
        
        if not all([product, audience, platform, campaign_content]):
            return jsonify({"error": "Missing required fields"}), 400
        
        
        pdf_buffer = create_campaign_pdf(campaign_content, product, audience, platform)
        
        
        filename = f"Campaign_{product.replace(' ', '_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
        
        return send_file(
            pdf_buffer,
            mimetype='application/pdf',
            as_attachment=True,
            download_name=filename
        )
    
    except Exception as e:
        print(f"Error in download_campaign_pdf: {str(e)}")
        return jsonify({"error": f"Server error: {str(e)}"}), 500


@app.route("/api/lead-score", methods=["POST"])
def api_lead_score():
    try:
        data = request.json or {}
        result = score_lead(data)

        save = bool(data.get("save"))
        if save:
            notes = {
                "demographic": data.get("demographic_note") or "",
                "behavior": data.get("behavior_note") or "",
                "financial": data.get("financial_note") or "",
                "engagement": data.get("engagement_note") or "",
                "need_fit": data.get("need_fit_note") or "",
            }

            rec = LeadScoreRecord(
                name=(data.get("name") or "").strip() or None,
                email=(data.get("email") or "").strip() or None,
                company=(data.get("company") or "").strip() or None,
                demographic_score=_clamp_int(data.get("demographic_score"), 0, 10, 0),
                behavior_score=_clamp_int(data.get("behavior_score"), 0, 10, 0),
                financial_score=_clamp_int(data.get("financial_score"), 0, 10, 0),
                engagement_score=_clamp_int(data.get("engagement_score"), 0, 10, 0),
                need_fit_score=_clamp_int(data.get("need_fit_score"), 0, 10, 0),
                total_score=result["total_score"],
                category=result["category"],
                notes_json=json.dumps(notes, ensure_ascii=False),
                breakdown_json=json.dumps(result["breakdown"], ensure_ascii=False),
            )
            db.session.add(rec)
            db.session.commit()
            result["saved_id"] = rec.id

        return jsonify(result)
    except Exception as e:
        print(f"Error in api_lead_score: {str(e)}")
        return jsonify({"error": f"Server error: {str(e)}"}), 500


@app.route("/api/leads", methods=["GET"])
def api_leads():
    try:
        limit = _clamp_int(request.args.get("limit"), 1, 100, 25)
        rows = LeadScoreRecord.query.order_by(LeadScoreRecord.created_at.desc()).limit(limit).all()

        out = []
        for r in rows:
            out.append(
                {
                    "id": r.id,
                    "created_at": r.created_at.isoformat(),
                    "name": r.name,
                    "email": r.email,
                    "company": r.company,
                    "scores": {
                        "demographic": r.demographic_score,
                        "behavior": r.behavior_score,
                        "financial": r.financial_score,
                        "engagement": r.engagement_score,
                        "need_fit": r.need_fit_score,
                    },
                    "total_score": r.total_score,
                    "category": r.category,
                    "notes": json.loads(r.notes_json) if r.notes_json else {},
                    "breakdown": json.loads(r.breakdown_json) if r.breakdown_json else {},
                }
            )

        return jsonify({"items": out})
    except Exception as e:
        print(f"Error in api_leads: {str(e)}")
        return jsonify({"error": f"Server error: {str(e)}"}), 500





@app.route('/chatbot', methods=['POST'])
def chatbot():
    try:
        data = request.json
        user_message = data.get("message")
        
        if not user_message:
            return jsonify({"error": "No message provided"}), 400
        
        
        prompt = f"""You are an expert marketing consultant for MarketAI Suite. 
        The user is asking: {user_message}
        
        Provide a concise, helpful response (2-3 sentences max) that:
        - Directly answers their question
        - Provides actionable advice
        - Relates to marketing campaigns, audience targeting, or campaign strategy
        
        Keep your response friendly and professional."""
        
        chat_completion = client.chat.completions.create(
            messages=[
                {"role": "user", "content": prompt}
            ],
            model="llama-3.1-8b-instant"
        )
        
        response = chat_completion.choices[0].message.content
        
        return jsonify({"response": response})
    
    except Exception as e:
        print(f"Error in chatbot: {str(e)}")
        return jsonify({"error": f"Chatbot error: {str(e)}"}), 500


def generate_competitor_analysis(data):
    product = data.get("product") or ""
    audience = data.get("audience") or ""
    your_position = data.get("positioning") or ""
    region = data.get("region") or ""
    competitors = data.get("competitors") or ""

    competitors_text = competitors
    if isinstance(competitors, list):
        competitors_text = ", ".join(str(c) for c in competitors if c)

    prompt = f"""
You are a senior marketing strategist.

Product: {product}
Target audience: {audience}
Region/market: {region}
Our positioning / offer: {your_position}
Key competitors: {competitors_text}

Provide a concise but insightful competitor analysis with sections:

1. MARKET SNAPSHOT
   - Short summary of the landscape and buyer expectations.

2. COMPETITOR TABLE (TEXT)
   - For each main competitor: name, core offer, strengths, weaknesses, pricing/positioning.

3. GAP & OPPORTUNITY ANALYSIS
   - Where MarketAI can win vs these competitors.

4. DIFFERENTIATION & MESSAGING
   - 3–5 sharp positioning angles and key messages.

5. ACTIONABLE MOVES (NEXT 30–60 DAYS)
   - Concrete ideas for campaigns, content, and product tweaks to stand out.

Keep it focused, specific to the product, and avoid very generic advice.
""".strip()

    chat_completion = client.chat.completions.create(
        messages=[{"role": "user", "content": prompt}],
        model="llama-3.1-8b-instant",
    )
    return chat_completion.choices[0].message.content


@app.route("/api/competitor-analysis", methods=["POST"])
def api_competitor_analysis():
    try:
        data = request.json or {}
        analysis = generate_competitor_analysis(data)
        return jsonify({"analysis": analysis})
    except Exception as e:
        print(f"Error in api_competitor_analysis: {str(e)}")
        return jsonify({"error": f"Server error: {str(e)}"}), 500



if __name__ == "__main__":
    app.run(debug=True)
