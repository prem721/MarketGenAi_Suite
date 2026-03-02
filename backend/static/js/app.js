/* global window, document, navigator, fetch */

const state = {
  busy: false,
};

/* ================================
   Safe DOM Helper
================================ */
function $(id) {
  return document.getElementById(id);
}

/* ================================
   Toast (Simple)
================================ */
function toast(message, type = "ok") {
  const toastsHtml = $('toasts');
  if (!toastsHtml) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  toastsHtml.appendChild(t);
  setTimeout(() => t.remove(), 3000);
  console.log(`[${type.toUpperCase()}] ${message}`);
}

/* ================================
   Busy State
================================ */
function setBusy(value) {
  state.busy = value;
  const btns = document.querySelectorAll('button:not(.ghost-btn):not(.icon-btn):not(.nav-item):not(.seg-btn):not(.chip)');
  btns.forEach(b => {
      if(!b.hasAttribute('data-original-disabled')) {
          b.disabled = value;
      }
  });
}

/* ================================
   API Helpers
================================ */
async function apiJson(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.headers.get("content-type")?.includes("application/pdf")) {
    return res; // Return raw response for PDF download
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }

  return data;
}

/* ================================
   Routing & Tabs
================================ */
function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('is-active'));
      const target = e.currentTarget;
      target.classList.add('is-active');

      document.querySelectorAll('.route').forEach(r => r.classList.remove('is-active'));
      const routeId = 'route-' + target.dataset.route;
      const routeEl = $(routeId);
      if(routeEl) routeEl.classList.add('is-active');
    });
  });

  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.seg-btn').forEach(b => {
        b.classList.remove('is-active');
        b.setAttribute('aria-selected', 'false');
      });
      const target = e.currentTarget;
      target.classList.add('is-active');
      target.setAttribute('aria-selected', 'true');

      document.querySelectorAll('.mode').forEach(m => m.classList.remove('is-active'));
      const modeId = 'mode-' + target.dataset.mode;
      const modeEl = $(modeId);
      if(modeEl) modeEl.classList.add('is-active');
    });
  });
}

function initUI() {
  const themeToggle = $('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      const label = $('themeLabel');
      if(label) label.textContent = next === 'dark' ? 'Dark' : 'Light';
    });
  }

  if ($('openAssistant') && $('assistantClose') && $('assistant')) {
    $('openAssistant').addEventListener('click', () => $('assistant').removeAttribute('aria-hidden'));
    $('assistantClose').addEventListener('click', () => $('assistant').setAttribute('aria-hidden', 'true'));
  }

  if ($('btnQuickFill')) {
    $('btnQuickFill').addEventListener('click', () => {
      const activeMode = document.querySelector('.seg-btn.is-active')?.dataset.mode;
      if (activeMode === 'guided') {
        if($('product')) $('product').value = 'AI resume builder';
        if($('audience')) $('audience').value = 'Fresh graduates & job switchers in India';
        if($('platform')) $('platform').value = 'Instagram + Email';
      } else {
        if($('description')) $('description').value = 'Launch a new AI resume builder targeted at college students for the upcoming interview season.';
      }
    });
  }

  if ($('btnClear')) {
    $('btnClear').addEventListener('click', () => {
      if($('product')) $('product').value = '';
      if($('audience')) $('audience').value = '';
      if($('platform')) $('platform').value = '';
      if($('description')) $('description').value = '';
      
      if($('campaignOutput')) {
        $('campaignOutput').textContent = '';
        $('campaignOutput').hidden = true;
      }
      if($('outputEmpty')) $('outputEmpty').hidden = false;
      if($('btnDownload')) $('btnDownload').disabled = true;
      if($('btnCopy')) $('btnCopy').disabled = true;
      if($('btnSave')) $('btnSave').disabled = true;
      if($('metaWords')) $('metaWords').textContent = '0 words';
      if($('metaStatus')) $('metaStatus').textContent = 'Ready';
    });
  }
}

/* ================================
   Campaign Generation
================================ */
async function generateCampaign() {
  if (state.busy) return;

  const activeMode = document.querySelector('.seg-btn.is-active')?.dataset.mode;
  let payload = {};

  if (activeMode === 'guided') {
      const product = $("product")?.value.trim();
      const audience = $("audience")?.value.trim();
      const platform = $("platform")?.value.trim();

      if (!product || !audience || !platform) {
        toast("Please fill all fields.", "bad");
        return;
      }
      payload = { product, audience, platform };
  } else {
      const description = $("description")?.value.trim();
      if (!description) {
        toast("Please enter a campaign brief.", "bad");
        return;
      }
      payload = { description };
  }

  setBusy(true);
  if ($('metaStatus')) $('metaStatus').textContent = 'Generating...';

  try {
    const data = await apiJson("/generate-campaign", payload);

    if ($("campaignOutput")) {
      $("campaignOutput").textContent = data.campaign;
      $("campaignOutput").hidden = false;
      if ($('outputEmpty')) $('outputEmpty').hidden = true;
      if ($('btnDownload')) {
        $('btnDownload').disabled = false;
        $('btnDownload').dataset.campaign = data.campaign; // store for download
      }
      if ($('btnCopy')) $('btnCopy').disabled = false;
      if ($('btnSave')) {
          $('btnSave').disabled = false;
          $('btnSave').dataset.campaignData = JSON.stringify({
              ...payload,
              campaign: data.campaign,
              date: new Date().toISOString()
          });
      }
      
      const words = data.campaign.split(/\s+/).filter(w => w.length > 0).length;
      if ($('metaWords')) $('metaWords').textContent = words + ' words';
    }

    toast("Campaign generated!", "ok");
  } catch (err) {
    toast(err.message, "bad");
  } finally {
    setBusy(false);
    if ($('metaStatus')) $('metaStatus').textContent = 'Ready';
  }
}

async function downloadPdf() {
    const campaignContent = $('btnDownload')?.dataset.campaign;
    if (!campaignContent) return;
    
    // Attempt to extract fields if we are in guided mode
    const product = $("product")?.value.trim() || "Campaign";
    const audience = $("audience")?.value.trim() || "Audience";
    const platform = $("platform")?.value.trim() || "Platform";
    
    setBusy(true);
    try {
        const res = await apiJson("/download-campaign-pdf", {
            product, audience, platform, campaign_content: campaignContent
        });
        const blob = await (res.blob ? res.blob() : new Response(res.body).blob());
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Campaign_${product.replace(/\s+/g, '_')}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        toast("PDF downloaded!", "ok");
    } catch(err) {
        toast(err.message, "bad");
    } finally {
        setBusy(false);
    }
}

/* ================================
   Lead Scoring
================================ */
function updateBadges() {
    ['Demo', 'Beh', 'Fin', 'Eng', 'Fit'].forEach(type => {
        const el = $(`score${type}`);
        const badge = $(`badge${type}`);
        if(el && badge) {
            el.addEventListener('input', (e) => {
                badge.textContent = e.target.value;
            });
        }
    });
}

function loadHistory() {
    fetch("/api/leads")
        .then(r => r.json())
        .then(data => {
            if(data.leads && data.leads.length > 0) {
                if($('leadHistoryEmpty')) $('leadHistoryEmpty').hidden = true;
                if($('leadHistoryTableWrapper')) $('leadHistoryTableWrapper').hidden = false;
                const tbody = $('leadHistoryBody');
                if(tbody) {
                    tbody.innerHTML = '';
                    data.leads.forEach(lead => {
                        const tr = document.createElement('tr');
                        const catClass = lead.category ? lead.category.toLowerCase().replace(' ', '-') : 'cold';
                        tr.innerHTML = `
                            <td>${lead.name || '-'}</td>
                            <td>${lead.company || '-'}</td>
                            <td>${lead.total_score}</td>
                            <td><span class="badge badge-${catClass}">${lead.category || 'Unknown'}</span></td>
                            <td>${new Date(lead.created_at).toLocaleDateString()}</td>
                        `;
                        tbody.appendChild(tr);
                    });
                }
            }
        }).catch(err => console.error(err));
}

async function scoreLead() {
  if (state.busy) return;

  const name = $("leadName")?.value.trim();
  const email = $("leadEmail")?.value.trim();
  const company = $("leadCompany")?.value.trim();

  if (!name) {
    toast("Enter lead name.", "bad");
    return;
  }

  setBusy(true);

  try {
    const data = await apiJson("/api/lead-score", {
      save: true,
      name, email, company,
      demographic_score: parseInt($('scoreDemo')?.value || 0),
      behavior_score: parseInt($('scoreBeh')?.value || 0),
      financial_score: parseInt($('scoreFin')?.value || 0),
      engagement_score: parseInt($('scoreEng')?.value || 0),
      need_fit_score: parseInt($('scoreFit')?.value || 0),
    });

    if ($("leadScoreValue")) $("leadScoreValue").textContent = data.total_score;
    if ($("leadScoreCategory")) {
        $("leadScoreCategory").textContent = data.category;
        const catClass = data.category ? data.category.toLowerCase().replace(/\s+/g, '-') : 'cold';
        $("leadScoreCategory").className = `lead-score-category cat-${catClass}`;
    }
    
    if($("leadScoreBar")) {
        const fill = $("leadScoreBar").querySelector('.lead-bar-fill');
        if(fill) {
            fill.style.width = `${data.total_score}%`;
            const catClass = data.category ? data.category.toLowerCase().replace(/\s+/g, '-') : 'cold';
            fill.className = `lead-bar-fill fill-${catClass}`;
        }
    }

    if($("leadScoreRecommendations") && data.breakdown) {
        $("leadScoreRecommendations").innerHTML = '';
        const recs = document.createElement('ul');
        for (const [key, val] of Object.entries(data.breakdown)) {
            const li = document.createElement('li');
            li.textContent = `${key.replace(/_/g, ' ')}: ${val}/20`;
            recs.appendChild(li);
        }
        $("leadScoreRecommendations").appendChild(recs);
    }

    toast("Lead scored and saved!", "ok");
    loadHistory(); // Reload history
  } catch (err) {
    toast(err.message, "bad");
  } finally {
    setBusy(false);
  }
}

/* ================================
   Competitor Analysis
================================ */
async function runCompAnalysis() {
    if (state.busy) return;

    const product = $("compProduct")?.value.trim();
    const audience = $("compAudience")?.value.trim();
    const region = $("compRegion")?.value.trim();
    const positioning = $("compPositioning")?.value.trim();
    const competitors = $("compList")?.value.trim();

    if (!product || !competitors) {
        toast("Please fill at least product and competitors.", "bad");
        return;
    }

    setBusy(true);

    try {
        const data = await apiJson("/api/competitor-analysis", {
            product, audience, region, positioning, competitors
        });

        if ($("compAnalysisOutput")) {
            $("compAnalysisOutput").textContent = data.analysis;
            $("compAnalysisOutput").hidden = false;
            if ($('compAnalysisEmpty')) $('compAnalysisEmpty').hidden = true;
            if ($('btnCopyCompAnalysis')) $('btnCopyCompAnalysis').disabled = false;
        }

        toast("Analysis complete!", "ok");
    } catch (err) {
        toast(err.message, "bad");
    } finally {
        setBusy(false);
    }
}

/* ================================
   Assistant Chatbot
================================ */
async function sendChat() {
    if (state.busy) return;
    const input = $('chatInput');
    const msg = input.value.trim();
    if (!msg) return;

    input.value = '';
    
    const messages = $('chatMessages');
    const userMsg = document.createElement('div');
    userMsg.className = 'chat-msg user-msg';
    userMsg.innerHTML = `<div class="chat-bubble">${msg}</div>`;
    messages.appendChild(userMsg);
    messages.scrollTop = messages.scrollHeight;

    setBusy(true);
    try {
        const data = await apiJson("/chatbot", { message: msg });
        
        const aiMsg = document.createElement('div');
        aiMsg.className = 'chat-msg ai-msg';
        aiMsg.innerHTML = `<div class="chat-bubble">${data.response}</div>`;
        messages.appendChild(aiMsg);
        messages.scrollTop = messages.scrollHeight;
    } catch (err) {
        toast(err.message, "bad");
    } finally {
        setBusy(false);
    }
}

/* ================================
   Clipboard Copy
================================ */
function copyToClipboard(elementId) {
    const el = $(elementId);
    if(el && el.textContent) {
        navigator.clipboard.writeText(el.textContent)
            .then(() => toast("Copied to clipboard!", "ok"))
            .catch(() => toast("Failed to copy", "bad"));
    }
}

/* ================================
   Library (Local Storage)
================================ */
function initLibrary() {
    if($('btnSave')) {
        $('btnSave').addEventListener('click', (e) => {
            const dataStr = e.currentTarget.dataset.campaignData;
            if(dataStr) {
                const campaigns = JSON.parse(localStorage.getItem('marketAI_library') || '[]');
                campaigns.push(JSON.parse(dataStr));
                localStorage.setItem('marketAI_library', JSON.stringify(campaigns));
                toast("Saved to library!", "ok");
                renderLibrary();
            }
        });
    }
    
    if($('btnExportLibrary')) {
        $('btnExportLibrary').addEventListener('click', () => {
            const dataStr = localStorage.getItem('marketAI_library') || '[]';
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `MarketAI_Library_${new Date().toISOString().slice(0,10)}.json`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
        });
    }

    if($('btnClearLibrary')) {
        $('btnClearLibrary').addEventListener('click', () => {
            if(confirm("Are you sure you want to clear your local library?")) {
                localStorage.removeItem('marketAI_library');
                renderLibrary();
                toast("Library cleared.", "ok");
            }
        });
    }

    renderLibrary();
}

function renderLibrary() {
    const campaigns = JSON.parse(localStorage.getItem('marketAI_library') || '[]');
    const list = $('libraryList');
    const empty = $('libraryEmpty');
    
    if(!list || !empty) return;

    if(campaigns.length === 0) {
        empty.hidden = false;
        list.hidden = true;
    } else {
        empty.hidden = true;
        list.hidden = false;
        list.innerHTML = '';
        campaigns.reverse().forEach((c, i) => {
            const card = document.createElement('div');
            card.className = 'library-card';
            card.style.border = "1px solid var(--gray-7)";
            card.style.padding = "1rem";
            card.style.borderRadius = "var(--radius-md)";
            card.style.marginBottom = "1rem";
            card.style.background = "var(--surface)";
            
            const title = c.product || c.description ? (c.product || "Campaign Brief") : "Untitled";
            const date = new Date(c.date).toLocaleDateString();
            
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                    <h3 style="margin: 0; font-size: 1rem;">${title}</h3>
                    <span class="muted" style="font-size: 0.875rem;">${date}</span>
                </div>
                <div class="muted" style="font-size: 0.875rem; margin-bottom: 1rem;">
                    ${c.audience ? `Targeting: ${c.audience}` : (c.description ? c.description.substring(0, 100) + '...' : '')}
                </div>
                <button class="ghost-btn" onclick="javascript:toast('Viewing from library feature not fully implemented', 'ok')">View Campaign</button>
            `;
            list.appendChild(card);
        });
    }
}

/* ================================
   INIT
================================ */
function init() {
  initNavigation();
  initUI();
  updateBadges();
  loadHistory();
  initLibrary();

  // Campaign Studio
  const btnGen = $("btnGenerate");
  if(btnGen) btnGen.addEventListener("click", generateCampaign);
  
  const btnDl = $("btnDownload");
  if(btnDl) btnDl.addEventListener("click", downloadPdf);
  
  const btnCp = $("btnCopy");
  if(btnCp) btnCp.addEventListener("click", () => copyToClipboard('campaignOutput'));
  
  // Lead Scoring
  const btnScore = $("btnScoreLead");
  if(btnScore) btnScore.addEventListener("click", scoreLead);
  
  // Competitor Analysis
  const btnRunComp = $("btnRunCompAnalysis");
  if(btnRunComp) btnRunComp.addEventListener("click", runCompAnalysis);
  
  const btnCpComp = $("btnCopyCompAnalysis");
  if(btnCpComp) btnCpComp.addEventListener("click", () => copyToClipboard('compAnalysisOutput'));
  
  // Assistant
  const btnSend = $("chatSend");
  if(btnSend) btnSend.addEventListener("click", sendChat);
  
  const chatInput = $("chatInput");
  if(chatInput) {
      chatInput.addEventListener("keypress", (e) => {
          if(e.key === 'Enter') sendChat();
      });
  }
  
  // Quick Pills
  document.querySelectorAll('.assistant-quick .chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
          const q = e.currentTarget.dataset.quick;
          if(q && $("chatInput")) {
              $("chatInput").value = q;
              sendChat();
          }
      });
  });
}

document.addEventListener("DOMContentLoaded", init);