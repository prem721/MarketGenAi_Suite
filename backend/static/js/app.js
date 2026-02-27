/* global window, document, navigator, fetch */

const STORAGE = {
  theme: "marketai:theme",
  draft: "marketai:draft",
  library: "marketai:library",
  chat: "marketai:chat",
};

const THEMES = [
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
  { key: "aurora", label: "Aurora" },
  { key: "sunset", label: "Sunset" },
  { key: "neon", label: "Neon" },
];

const state = {
  currentCampaign: null,
  mode: "guided", // guided | brief
  route: "studio", // studio | leads | competitors | library
  busy: false,
  compAnalysis: "",
};

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: #${id}`);
  return el;
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function wordCount(text) {
  return (text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function toast(message, type = "ok") {
  const host = $("toasts");
  const el = document.createElement("div");
  el.className = `toast ${type === "bad" ? "bad" : "ok"}`;
  el.textContent = message;
  host.appendChild(el);
  window.setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    el.style.transition = "opacity .25s ease, transform .25s ease";
    window.setTimeout(() => el.remove(), 260);
  }, 2600);
}

function readJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore (storage blocked)
  }
}

function setBusy(isBusy, label = null) {
  state.busy = isBusy;
  $("btnGenerate").disabled = isBusy;
  $("btnQuickFill").disabled = isBusy;
  $("btnClear").disabled = isBusy;
  $("btnDownload").disabled = isBusy || !state.currentCampaign?.content;
  $("btnCopy").disabled = isBusy || !state.currentCampaign?.content;
  $("btnSave").disabled = isBusy || !state.currentCampaign?.content;
  $("chatSend").disabled = isBusy;

  $("metaStatus").textContent = label || (isBusy ? "Working…" : "Ready");
}

function setOutput(text) {
  const output = $("campaignOutput");
  const empty = $("outputEmpty");
  if (!text) {
    output.hidden = true;
    empty.hidden = false;
    output.textContent = "";
    $("metaWords").textContent = "0 words";
    return;
  }
  empty.hidden = true;
  output.hidden = false;
  output.textContent = text;
  $("metaWords").textContent = `${wordCount(text)} words`;
}

function setRoute(route) {
  const allowed = new Set(["studio", "leads", "competitors", "library"]);
  const nextRoute = allowed.has(route) ? route : "studio";
  state.route = nextRoute;

  document.querySelectorAll(".route").forEach((r) => r.classList.remove("is-active"));
  const routeEl = document.getElementById(`route-${nextRoute}`);
  if (routeEl) routeEl.classList.add("is-active");

  document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("is-active"));
  document.querySelectorAll(`.nav-item[data-route="${nextRoute}"]`).forEach((b) => b.classList.add("is-active"));

  const title = document.querySelector(".topbar-title h1");
  if (title) {
    if (nextRoute === "library") title.textContent = "Library";
    else if (nextRoute === "leads") title.textContent = "Lead scoring";
    else if (nextRoute === "competitors") title.textContent = "Competitor analysis";
    else title.textContent = "Campaign Studio";
  }
}


try {
  const res = await fetch('/generate-poster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product_name: product, details })
  });
  if (!res.ok) {
    let msg;
    try { msg = await res.json(); } catch { msg = await res.text(); }
    if (res.status === 401) {
      toast('Please log in to generate posters.', 'bad');
    } else {
      toast('Poster generation failed: ' + (msg.error || msg || res.status), 'bad');
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `poster_${product.replace(/\s+/g, '_')}.png`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
  toast('Poster downloaded!', 'ok');
} catch (err) {
  console.error(err);
} finally {
  setBusy(false);
  $("posterStatus").style.display = "none";
}
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("is-active"));
  document.querySelectorAll(`.seg-btn[data-mode="${mode}"]`).forEach((b) => b.classList.add("is-active"));
  document.querySelectorAll(".mode").forEach((m) => m.classList.remove("is-active"));
  const el = document.getElementById(`mode-${mode}`);
  if (el) el.classList.add("is-active");
}

function readDraft() {
  const d = readJSON(STORAGE.draft, null);
  if (!d) return;
  if (typeof d.product === "string") $("product").value = d.product;
  if (typeof d.audience === "string") $("audience").value = d.audience;
  if (typeof d.platform === "string") $("platform").value = d.platform;
  if (typeof d.description === "string") $("description").value = d.description;
  if (d.mode === "brief" || d.mode === "guided") setMode(d.mode);
  if (d.format === "structured" || d.format === "flexible") {
    const r = document.querySelector(`input[name="campaignFormat"][value="${d.format}"]`);
    if (r) r.checked = true;
  }
}

function writeDraft() {
  const format = document.querySelector('input[name="campaignFormat"]:checked')?.value || "flexible";
  writeJSON(STORAGE.draft, {
    mode: state.mode,
    product: $("product").value,
    audience: $("audience").value,
    platform: $("platform").value,
    description: $("description").value,
    format,
    updatedAt: Date.now(),
  });
}

function getFormat() {
  return document.querySelector('input[name="campaignFormat"]:checked')?.value || "flexible";
}

function buildPayload() {
  const product = $("product").value.trim();
  const audience = $("audience").value.trim();
  const platform = $("platform").value.trim();
  const description = $("description").value.trim();
  const format = getFormat();

  // Backend currently ignores `format`, but we use it to choose the best request style.
  // - Structured: prefer guided fields when present.
  // - Flexible: prefer description/brief (or we synthesize a brief from guided inputs).
  if (format === "structured") {
    if (!product || !audience || !platform) {
      // Fall back to description with an explicit instruction.
      if (!description) throw new Error("Enter Product, Audience, Platform — or provide a campaign brief.");
      return { description: `${description}\n\nPlease follow a structured 10-section campaign format.` };
    }
    return { product, audience, platform };
  }

  // flexible
  if (description) return { description: `${description}\n\nUse smart sections. Be practical and actionable.` };
  if (!product || !audience || !platform) throw new Error("Enter Product, Audience, Platform — or provide a campaign brief.");
  return {
    description:
      `Create a flexible marketing campaign plan.\n` +
      `Product: ${product}\nAudience: ${audience}\nPlatform: ${platform}\n\n` +
      `Use smart sections (not necessarily numbered). Include messaging, content ideas, and KPIs.`,
  };
}

async function apiJson(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const msg = data?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function apiBlob(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return await res.blob();
}

async function generateCampaign() {
  if (state.busy) return;

  const payload = buildPayload();
  writeDraft();

  setBusy(true, "Generating…");
  $("btnGenerate").blur();
  setOutput("");
  state.currentCampaign = null;
  toast("Generating campaign…", "ok");

  try {
    const data = await apiJson("/generate-campaign", payload);
    const content = data?.campaign;
    if (!content) throw new Error("No campaign received from server.");

    const product = $("product").value.trim();
    const audience = $("audience").value.trim();
    const platform = $("platform").value.trim();

    state.currentCampaign = {
      id: `cmp_${Date.now()}`,
      createdAt: Date.now(),
      product,
      audience,
      platform,
      format: getFormat(),
      content,
    };

    setOutput(content);
    toast("Campaign ready.", "ok");
  } finally {
    setBusy(false);
  }
}

async function downloadPDF() {
  if (state.busy) return;
  if (!state.currentCampaign?.content) {
    toast("Generate a campaign first.", "bad");
    return;
  }

  const product = state.currentCampaign.product || "Campaign";
  const audience = state.currentCampaign.audience || "Audience";
  const platform = state.currentCampaign.platform || "Platform";

  setBusy(true, "Preparing PDF…");
  try {
    const blob = await apiBlob("/download-campaign-pdf", {
      product,
      audience,
      platform,
      campaign_content: state.currentCampaign.content,
    });

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Campaign_${(product || "MarketAI").replace(/\s+/g, "_")}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    toast("PDF downloaded.", "ok");
  } finally {
    setBusy(false);
  }
}

async function copyCampaign() {
  if (!state.currentCampaign?.content) return;
  try {
    await navigator.clipboard.writeText(state.currentCampaign.content);
    toast("Copied to clipboard.", "ok");
  } catch {
    toast("Copy failed (browser blocked clipboard).", "bad");
  }
}

function saveCampaign() {
  if (!state.currentCampaign?.content) return;
  const lib = readJSON(STORAGE.library, []);
  lib.unshift(state.currentCampaign);
  writeJSON(STORAGE.library, lib.slice(0, 50));
  toast("Saved to Library.", "ok");
  renderLibrary();
}

function renderLibrary() {
  const lib = readJSON(STORAGE.library, []);
  const empty = $("libraryEmpty");
  const list = $("libraryList");

  if (!Array.isArray(lib) || lib.length === 0) {
    empty.hidden = false;
    list.hidden = true;
    list.innerHTML = "";
    return;
  }

  empty.hidden = true;
  list.hidden = false;
  list.innerHTML = "";

  lib.forEach((item) => {
    const el = document.createElement("div");
    el.className = "lib-item";

    const title = item.product?.trim() || "Untitled campaign";
    const meta = [
      item.audience ? `Audience: ${item.audience}` : null,
      item.platform ? `Platform: ${item.platform}` : null,
      item.format ? `Format: ${item.format}` : null,
      item.createdAt ? `Saved: ${formatDate(item.createdAt)}` : null,
    ].filter(Boolean);

    el.innerHTML = `
      <div>
        <div class="lib-title"></div>
        <div class="lib-meta"></div>
      </div>
      <div class="lib-actions">
        <button class="ghost-btn" type="button" data-action="load">Open</button>
        <button class="ghost-btn" type="button" data-action="copy">Copy</button>
        <button class="ghost-btn" type="button" data-action="delete">Delete</button>
      </div>
    `;
    el.querySelector(".lib-title").textContent = title;
    el.querySelector(".lib-meta").textContent = meta.join(" • ");

    el.querySelector('[data-action="load"]').addEventListener("click", () => {
      state.currentCampaign = item;
      setOutput(item.content || "");
      if (typeof item.product === "string") $("product").value = item.product;
      if (typeof item.audience === "string") $("audience").value = item.audience;
      if (typeof item.platform === "string") $("platform").value = item.platform;
      setRoute("studio");
      toast("Loaded from Library.", "ok");
      setBusy(false);
    });

    el.querySelector('[data-action="copy"]').addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(item.content || "");
        toast("Copied.", "ok");
      } catch {
        toast("Copy failed.", "bad");
      }
    });

    el.querySelector('[data-action="delete"]').addEventListener("click", () => {
      const next = readJSON(STORAGE.library, []).filter((x) => x.id !== item.id);
      writeJSON(STORAGE.library, next);
      renderLibrary();
      toast("Deleted.", "ok");
    });

    list.appendChild(el);
  });
}

function exportLibrary() {
  const lib = readJSON(STORAGE.library, []);
  const blob = new Blob([JSON.stringify(lib, null, 2)], { type: "application/json" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "marketai_library.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
  toast("Library exported.", "ok");
}

async function scoreLead() {
  const payload = {
    name: $("leadName").value.trim(),
    email: $("leadEmail").value.trim(),
    company: $("leadCompany").value.trim(),
    demographic_score: $("scoreDemo").value,
    behavior_score: $("scoreBeh").value,
    financial_score: $("scoreFin").value,
    engagement_score: $("scoreEng").value,
    need_fit_score: $("scoreFit").value,
    save: true,
  };

  setBusy(true, "Scoring lead…");
  try {
    const data = await apiJson("/api/lead-score", payload);
    const total = data.total_score ?? 0;
    const category = data.category || "Not scored";
    const recs = data.breakdown?.recommendations || [];

    $("leadScoreValue").textContent = `${total}`;
    $("leadScoreCategory").textContent = category;

    const fill = document.querySelector("#leadScoreBar .lead-bar-fill");
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, total))}%`;

    $("leadScoreRecommendations").textContent = recs.join(" • ");
    toast("Lead scored.", "ok");
    await renderLeadHistory();
  } catch (e) {
    toast(e.message, "bad");
  } finally {
    setBusy(false);
  }
}

async function renderLeadHistory() {
  const empty = $("leadHistoryEmpty");
  const wrapper = $("leadHistoryTableWrapper");
  const body = $("leadHistoryBody");

  try {
    const res = await fetch("/api/leads?limit=20");
    if (!res.ok) throw new Error(`Failed to load leads (${res.status})`);
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];

    if (!items.length) {
      empty.hidden = false;
      wrapper.hidden = true;
      body.innerHTML = "";
      return;
    }

    empty.hidden = true;
    wrapper.hidden = false;
    body.innerHTML = "";

    items.forEach((item) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${item.name || "–"}</td>
        <td>${item.company || "–"}</td>
        <td>${item.total_score ?? "–"}</td>
        <td>${item.category || "–"}</td>
        <td>${item.created_at ? formatDate(item.created_at) : "–"}</td>
      `;
      body.appendChild(tr);
    });
  } catch (e) {
    empty.hidden = false;
    wrapper.hidden = true;
    body.innerHTML = "";
    // eslint-disable-next-line no-console
    console.error(e);
  }
}

function wireLeadSliders() {
  const pairs = [
    ["scoreDemo", "badgeDemo"],
    ["scoreBeh", "badgeBeh"],
    ["scoreFin", "badgeFin"],
    ["scoreEng", "badgeEng"],
    ["scoreFit", "badgeFit"],
  ];
  pairs.forEach(([sliderId, badgeId]) => {
    const slider = document.getElementById(sliderId);
    const badge = document.getElementById(badgeId);
    if (!slider || !badge) return;
    const sync = () => {
      badge.textContent = slider.value;
    };
    slider.addEventListener("input", sync);
    sync();
  });
}

async function runCompetitorAnalysis() {
  const payload = {
    product: $("compProduct").value.trim(),
    audience: $("compAudience").value.trim(),
    region: $("compRegion").value.trim(),
    positioning: $("compPositioning").value.trim(),
    competitors: $("compList").value.trim(),
  };

  if (!payload.product || !payload.audience) {
    toast("Enter at least Product and Target audience.", "bad");
    return;
  }

  setBusy(true, "Analysing competitors…");
  $("compAnalysisEmpty").hidden = false;
  $("compAnalysisOutput").hidden = true;

  try {
    const data = await apiJson("/api/competitor-analysis", payload);
    const text = data.analysis || "No analysis.";
    state.compAnalysis = text;
    $("compAnalysisEmpty").hidden = true;
    $("compAnalysisOutput").hidden = false;
    $("compAnalysisOutput").textContent = text;
    $("btnCopyCompAnalysis").disabled = false;
    toast("Competitor analysis ready.", "ok");
  } catch (e) {
    toast(e.message, "bad");
  } finally {
    setBusy(false);
  }
}

async function copyCompetitorAnalysis() {
  if (!state.compAnalysis) return;
  try {
    await navigator.clipboard.writeText(state.compAnalysis);
    toast("Analysis copied.", "ok");
  } catch {
    toast("Copy failed.", "bad");
  }
}

function clearLibrary() {
  writeJSON(STORAGE.library, []);
  renderLibrary();
  toast("Library cleared.", "ok");
}

function clearInputs() {
  $("product").value = "";
  $("audience").value = "";
  $("platform").value = "";
  $("description").value = "";
  setOutput("");
  state.currentCampaign = null;
  writeDraft();
  toast("Cleared.", "ok");
}

function quickFill() {
  $("product").value = "MarketAI Suite (AI marketing toolkit)";
  $("audience").value = "Small business owners & solo founders in India";
  $("platform").value = "Instagram + Email";
  $("description").value =
    "Goal: increase qualified demos.\nOffer: 14-day trial.\nTone: confident, practical.\nConstraints: budget ₹25,000/month.\nTimeline: 4 weeks.\nCompetitors: basic social media scheduling tools.";
  toast("Example filled.", "ok");
  writeDraft();
}

function applyTheme(theme) {
  const t = THEMES.some((x) => x.key === theme) ? theme : "light";
  document.documentElement.setAttribute("data-theme", t);
  const label = THEMES.find((x) => x.key === t)?.label || "Light";
  $("themeLabel").textContent = label;
  writeJSON(STORAGE.theme, t);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const idx = Math.max(
    0,
    THEMES.findIndex((x) => x.key === current),
  );
  const next = THEMES[(idx + 1) % THEMES.length]?.key || "light";
  applyTheme(next);
}

function openAssistant() {
  const host = $("assistant");
  host.classList.add("is-open");
  host.setAttribute("aria-hidden", "false");
  $("chatInput").focus();
}

function closeAssistant() {
  const host = $("assistant");
  host.classList.remove("is-open");
  host.setAttribute("aria-hidden", "true");
}

function renderChat(messages) {
  const host = $("chatMessages");
  host.innerHTML = "";
  messages.forEach((m) => {
    const el = document.createElement("div");
    el.className = `msg ${m.role === "user" ? "user" : "bot"}`;
    el.textContent = m.content;
    host.appendChild(el);
  });
  host.scrollTop = host.scrollHeight;
}

function getChat() {
  const items = readJSON(STORAGE.chat, []);
  return Array.isArray(items) ? items.slice(-40) : [];
}

function setChat(items) {
  writeJSON(STORAGE.chat, items.slice(-40));
  renderChat(items);
}

async function sendChat(message) {
  const text = (message || $("chatInput").value || "").trim();
  if (!text) return;
  $("chatInput").value = "";

  const chat = getChat();
  chat.push({ role: "user", content: text, ts: Date.now() });
  chat.push({ role: "bot", content: "Thinking…", ts: Date.now(), pending: true });
  setChat(chat);

  try {
    const data = await apiJson("/chatbot", { message: text });
    const reply = data?.response || "No response.";
    const next = getChat()
      .filter((m) => !m.pending)
      .concat([{ role: "bot", content: reply, ts: Date.now() }]);
    setChat(next);
  } catch (e) {
    const next = getChat().filter((m) => !m.pending);
    next.push({ role: "bot", content: `Error: ${e.message}`, ts: Date.now() });
    setChat(next);
  }
}

function bind() {
  // routes
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => setRoute(btn.getAttribute("data-route") || "studio"));
  });

  // mode switch
  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.getAttribute("data-mode") || "guided"));
  });

  // actions
  $("btnGenerate").addEventListener("click", () => generateCampaign().catch((e) => toast(e.message, "bad")));
  $("btnDownload").addEventListener("click", () => downloadPDF().catch((e) => toast(e.message, "bad")));
  $("btnCopy").addEventListener("click", () => copyCampaign());
  $("btnSave").addEventListener("click", () => saveCampaign());
  $("btnClear").addEventListener("click", () => clearInputs());
  $("btnQuickFill").addEventListener("click", () => quickFill());

  // library
  $("btnExportLibrary").addEventListener("click", () => exportLibrary());
  $("btnClearLibrary").addEventListener("click", () => clearLibrary());

  // lead scoring
  if (document.getElementById("btnScoreLead")) {
    $("btnScoreLead").addEventListener("click", () => {
      scoreLead();
    });
    wireLeadSliders();
  }

  // competitor analysis
  if (document.getElementById("btnRunCompAnalysis")) {
    $("btnRunCompAnalysis").addEventListener("click", () => {
      runCompetitorAnalysis();
    });
    $("btnCopyCompAnalysis").addEventListener("click", () => {
      copyCompetitorAnalysis();
    });
  }

  // theme
  $("themeToggle").addEventListener("click", () => toggleTheme());

  // assistant
  $("openAssistant").addEventListener("click", () => openAssistant());
  $("assistantClose").addEventListener("click", () => closeAssistant());
  $("assistant").addEventListener("click", (e) => {
    if (e.target === $("assistant")) closeAssistant();
  });
  $("chatSend").addEventListener("click", () => sendChat());
  $("chatInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendChat();
  });
  document.querySelectorAll("[data-quick]").forEach((btn) => {
    btn.addEventListener("click", () => sendChat(btn.getAttribute("data-quick")));
  });

  // autosave draft
  ["product", "audience", "platform", "description"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => writeDraft());
  });
  document.querySelectorAll('input[name="campaignFormat"]').forEach((r) => {
    r.addEventListener("change", () => writeDraft());
  });
}

function init() {
  bind();
  readDraft();

  const theme = readJSON(STORAGE.theme, "light");
  applyTheme(theme);

  renderLibrary();
  renderLeadHistory();

  const chat = getChat();
  if (chat.length === 0) {
    setChat([{ role: "bot", content: "Hi — ask me anything about campaigns, targeting, content ideas, or budget.", ts: Date.now() }]);
  } else {
    renderChat(chat);
  }

  setOutput("");
  setRoute("studio");
  setBusy(false);
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    init();
  } catch (e) {
    // last-resort: show something actionable
    // eslint-disable-next-line no-console
    console.error(e);
    window.alert(`UI init error: ${e.message}`);
  }
});

