import { variantParts, partsToSvgInner, toSvg } from "/lib/variants.js";
import { lintAll, lintIcon, RULES } from "/lib/lint.js";
import { parse, nodes, inkBounds, normalize } from "/lib/path.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const SEV = { error: 3, warn: 2, info: 1 };
const CONTEXT = ["home", "search", "bell", "user", "settings", "heart", "calendar"];

const prefs = (() => { try { return JSON.parse(localStorage.getItem("studio.prefs")) || {}; } catch { return {}; } })();
const view = Object.assign(
  { style: "outline", corner: "round", weight: "regular", filter: "all", query: "", selected: null, tab: "inspect", editStyle: "outline", theme: null,
    overlays: { grid: true, padding: true, keylines: false, bounds: true, nodes: false, original: false } },
  prefs
);
const savePrefs = () => { try { localStorage.setItem("studio.prefs", JSON.stringify({ ...view, query: "" })); } catch {} };

let config, icons = [], requests = [], lint = {}, legacy = null;
let draft = null, dirty = false, pendingReload = false;

// ---------- Data ----------
async function load() {
  const res = await fetch("/api/state");
  const s = await res.json();
  config = s.config; icons = s.icons; requests = s.requests;
  lint = lintAll(icons, config);
  if (view.selected && !icons.some((i) => i.name === view.selected)) { view.selected = null; draft = null; }
  if (view.selected && !dirty) draft = clone(icons.find((i) => i.name === view.selected));
}
async function api(path, method, body) {
  const r = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const current = () => (view.selected && draft) || null;
const worst = (list) => list.filter((i) => !i.ignored).reduce((m, i) => Math.max(m, SEV[i.severity]), 0);
const openReq = (name) => requests.some((r) => r.status !== "done" && r.icon === name);

// ---------- Rendering helpers ----------
const svgCache = new Map();
function iconSvg(icon, opts = {}, attrs = "") {
  const o = { style: view.style, corner: view.corner, weight: view.weight, ...opts };
  const key = `${icon.name}|${o.style}|${o.corner}|${o.weight}|${JSON.stringify(icon.styles)}|${JSON.stringify(config.corners)}`;
  let inner = svgCache.get(key);
  if (inner === undefined) {
    try { inner = partsToSvgInner(variantParts(icon, config, o)); } catch { inner = ""; }
    if (svgCache.size > 4000) svgCache.clear();
    svgCache.set(key, inner);
  }
  return `<svg viewBox="0 0 ${config.grid} ${config.grid}" fill="none" ${attrs}>${inner}</svg>`;
}
function seg(el, values, key) {
  el.innerHTML = values.map((v) => `<button data-v="${v}" class="${view[key] === v ? "on" : ""}">${v}</button>`).join("");
  el.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    view[key] = b.dataset.v; savePrefs(); renderAll();
  };
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2000);
}

// ---------- Header / list ----------
function renderHeader() {
  seg($("#segStyle"), config.styles, "style");
  seg($("#segCorner"), Object.keys(config.corners), "corner");
  seg($("#segWeight"), Object.keys(config.weights), "weight");
  const ruleIcons = {};
  for (const [name, list] of Object.entries(lint)) for (const i of list) if (!i.ignored) (ruleIcons[i.rule] ||= new Set()).add(name);
  const opts = [["all", "All icons"], ["error", "Has errors"], ["warn", "Has warnings or worse"], ["requests", "Has open requests"]];
  for (const [id, r] of Object.entries(RULES)) if (ruleIcons[id]) opts.push([`rule:${id}`, `${r.severity === "error" ? "● " : r.severity === "warn" ? "▲ " : "· "}${r.title} (${ruleIcons[id].size})`]);
  $("#filter").innerHTML = opts.map(([v, l]) => `<option value="${v}" ${view.filter === v ? "selected" : ""}>${esc(l)}</option>`).join("");
  $("#reqCount").textContent = requests.filter((r) => r.status !== "done").length;
  $("#iconNames").innerHTML = icons.map((i) => `<option value="${i.name}">`).join("");
}

function visibleIcons() {
  const q = view.query.trim().toLowerCase();
  return icons.filter((icon) => {
    const list = lint[icon.name] || [];
    if (q && !icon.name.includes(q) && !(icon.tags || []).some((t) => t.includes(q))) return false;
    if (view.filter === "error") return worst(list) >= 3;
    if (view.filter === "warn") return worst(list) >= 2;
    if (view.filter === "requests") return openReq(icon.name);
    if (view.filter.startsWith("rule:")) return list.some((i) => !i.ignored && i.rule === view.filter.slice(5));
    return true;
  });
}

function renderList() {
  const all = Object.values(lint).flat().filter((i) => !i.ignored);
  const n = (s) => all.filter((i) => i.severity === s).length;
  const iconsWith = (s) => Object.values(lint).filter((l) => worst(l) === SEV[s]).length;
  const vis = visibleIcons();
  $("#summary").innerHTML = `<span><b>${icons.length}</b> icons</span><span style="color:var(--error)"><b>${n("error")}</b> errors</span><span style="color:var(--warn)"><b>${n("warn")}</b> warnings (${iconsWith("warn")} icons)</span><span><b>${n("info")}</b> info</span>${vis.length !== icons.length ? `<span>showing <b>${vis.length}</b></span>` : ""}`;
  $("#tiles").innerHTML = vis
    .map((icon) => {
      const w = worst(lint[icon.name] || []);
      const sev = w === 3 ? "error" : w === 2 ? "warn" : w === 1 ? "info" : "";
      const shown = icon.name === view.selected && draft ? draft : icon;
      return `<button class="tile ${icon.name === view.selected ? "on" : ""}" data-name="${icon.name}" title="${esc(icon.name)}">
        ${sev ? `<i class="dot ${sev}"></i>` : ""}${openReq(icon.name) ? `<i class="dot req" title="Open Claude request"></i>` : ""}
        ${iconSvg(shown)}<span>${esc(icon.name)}</span></button>`;
    })
    .join("");
}

// ---------- Detail ----------
function canvasSvg(icon) {
  const g = config.grid, pad = config.padding;
  const o = view.overlays;
  const parts = variantParts(icon, config, { style: view.style, corner: view.corner, weight: view.weight });
  const ns = 'vector-effect="non-scaling-stroke"';
  let under = "", over = "";
  if (o.padding) under += `<path d="M0 0H${g}V${g}H0Z M${pad} ${pad}V${g - pad}H${g - pad}V${pad}Z" fill="var(--pad)" fill-rule="evenodd"/>`;
  if (o.grid) {
    let lines = "";
    for (let i = 1; i < g; i++) lines += `M${i} 0V${g}M0 ${i}H${g}`;
    under += `<path d="${lines}" stroke="var(--grid)" stroke-width="1" ${ns}/><path d="M${g / 2} 0V${g}M0 ${g / 2}H${g}" stroke="var(--grid-strong)" stroke-width="1" ${ns}/>`;
  }
  if (o.keylines) {
    const c = g / 2;
    under += `<g stroke="var(--key)" stroke-width="1" fill="none" ${ns}><circle cx="${c}" cy="${c}" r="${c - pad}" ${ns}/><rect x="3" y="3" width="${g - 6}" height="${g - 6}" ${ns}/><rect x="4" y="${pad}" width="${g - 8}" height="${g - 2 * pad}" ${ns}/><rect x="${pad}" y="4" width="${g - 2 * pad}" height="${g - 8}" ${ns}/></g>`;
  }
  if (o.original && legacy?.icons?.[icon.name]?.[view.style]?.[view.corner]) {
    const old = legacy.icons[icon.name][view.style][view.corner];
    over += `<g fill="none" stroke="var(--ghost)" stroke-width="1.2" ${ns} opacity=".9">${old.flatMap((p) => p.paths).map((p) => `<path d="${p.d}" ${ns}/>`).join("")}</g>`;
  }
  if (o.bounds) {
    const b = inkBounds(parts.flatMap((p) => p.paths));
    if (b) over += `<rect x="${b.x0}" y="${b.y0}" width="${b.w}" height="${b.h}" fill="none" stroke="var(--accent)" stroke-dasharray="4 3" stroke-width="1" ${ns}/>`;
  }
  if (o.nodes) {
    const master = icon.styles[view.style] || [];
    for (const part of master)
      for (const p of part.paths) {
        let pts = [];
        try { pts = nodes(parse(p.d)); } catch {}
        pts.forEach(([x, y], i) => {
          over += `<circle cx="${x}" cy="${y}" r=".28" fill="var(--node)"/><text x="${x + 0.35}" y="${y - 0.3}" font-size=".6" fill="var(--node)" font-family="ui-monospace,monospace">${i}</text>`;
        });
      }
  }
  return `<svg class="canvas" viewBox="-0.5 -0.5 ${g + 1} ${g + 1}" fill="none">${under}<g>${partsToSvgInner(parts)}</g>${over}</svg>`;
}

function issueList(icon) {
  const own = lintIcon(icon, config);
  const setLevel = (lint[view.selected] || []).filter((i) => i.rule === "duplicate-geometry" || i.rule === "synonyms");
  const list = [...own, ...setLevel].sort((a, b) => !!a.ignored - !!b.ignored || SEV[b.severity] - SEV[a.severity]);
  if (!list.length) return `<div class="ok-line">✓ No issues.</div>`;
  return list
    .map((i) => `<div class="issue ${i.ignored ? "ignored" : ""}">
      <span class="sev ${i.severity}"></span>
      <div><div class="t">${esc(i.title)}${i.where ? ` <span class="m">· ${esc(i.where)}</span>` : ""}</div>
      ${i.message ? `<div class="m">${esc(i.message)}</div>` : ""}
      <div class="m">${i.ignored ? `Ignored: ${esc(i.ignored)}` : esc(i.fix)}</div></div>
      <div>${i.ignored ? `<button class="btn small" data-unignore="${i.rule}">Un-ignore</button>` : `<button class="btn small" data-ignore="${i.rule}" title="Mark as intentional">Ignore…</button>`}</div>
    </div>`)
    .join("");
}

function renderInspect(icon) {
  const st = view.style, co = view.corner, we = view.weight;
  const b = inkBounds(variantParts(icon, config, { style: st, corner: co, weight: we }).flatMap((p) => p.paths));
  const r = (n) => Math.round(n * 100) / 100;
  const ov = Object.entries({ grid: "Pixel grid", padding: "2px padding", keylines: "Keylines", bounds: "Ink box", nodes: "Master nodes", original: "Original (v0.1) overlay" })
    .map(([k, l]) => `<label><input type="checkbox" data-ov="${k}" ${view.overlays[k] ? "checked" : ""}/> ${l}</label>`).join("");
  const sizes = [16, 20, 24, 32, 48];
  const ladder = ["light", "dark"].map((t) => `<div class="${t}">${sizes.map((s) => `<figure>${iconSvg(icon, {}, `width="${s}" height="${s}"`)}<figcaption>${s}</figcaption></figure>`).join("")}</div>`).join("");
  const corners = Object.keys(config.corners);
  const matrix = `<table class="matrix"><tr><th></th>${corners.map((c) => `<th>${c}</th>`).join("")}</tr>${config.styles
    .map((s) => `<tr><th>${s}</th>${corners.map((c) => `<td data-style="${s}" data-corner="${c}" class="${s === st && c === co ? "on" : ""}">${iconSvg(icon, { style: s, corner: c })}</td>`).join("")}</tr>`)
    .join("")}<tr><th>weight</th>${Object.keys(config.weights).map((w) => `<td data-weight="${w}" class="${w === we ? "on" : ""}" title="${w}">${iconSvg(icon, { weight: w })}</td>`).join("")}<td></td></tr></table>`;
  const ctx = CONTEXT.filter((n) => n !== icon.name).map((n) => icons.find((i) => i.name === n)).filter(Boolean);
  const mid = Math.floor(ctx.length / 2);
  const row = (size) => [...ctx.slice(0, mid), icon, ...ctx.slice(mid)].map((i) => iconSvg(i, {}, `width="${size}" height="${size}" ${i === icon ? 'class="me"' : ""}`)).join("");
  return `<div class="d-grid">
    <div>
      <div class="card">${canvasSvg(icon)}
        <div class="overlays">${ov}</div>
        ${b ? `<div class="metrics">Ink box ${r(b.x0)},${r(b.y0)} → ${r(b.x1)},${r(b.y1)} · ${r(b.w)} × ${r(b.h)} px · centre offset ${r(b.cx - config.grid / 2)}, ${r(b.cy - config.grid / 2)}</div>` : ""}
      </div>
      <div class="card"><h3>Actual size (1×)</h3><div class="ladder">${ladder}</div></div>
    </div>
    <div>
      <div class="card"><h3>Issues</h3>${issueList(icon)}</div>
      <div class="card"><h3>Variants</h3>${matrix}</div>
      <div class="card"><h3>Next to other icons</h3><div class="context">${row(24)}</div><div class="context">${row(40)}</div></div>
    </div>
  </div>`;
}

function renderEdit(icon) {
  const style = view.editStyle;
  const parts = icon.styles[style] || [];
  const pathBox = (p, pi, ji) => `<div class="pathbox" data-part="${pi}" data-path="${ji}">
      <textarea class="code" rows="3" data-k="d" spellcheck="false">${esc(p.d)}</textarea>
      <div class="props">
        <label><input type="checkbox" data-k="stroke" ${p.stroke ? "checked" : ""}/> stroke</label>
        <label><input type="checkbox" data-k="fill" ${p.fill ? "checked" : ""}/> fill</label>
        <label>rule <select data-k="fillRule"><option value="">nonzero</option><option value="evenodd" ${p.fillRule === "evenodd" ? "selected" : ""}>evenodd</option></select></label>
        <label title="Stroke width at regular weight">stroke px <input type="number" step="0.25" min="0" data-k="strokeWidth" value="${p.strokeWidth ?? ""}" placeholder="${config.baseStroke}"/></label>
        <label title="Multiplies the corner radius for this path (0 = never round)">radius × <input type="number" step="0.125" min="0" data-k="radius" value="${p.radius ?? ""}" placeholder="1"/></label>
        <label title="Node numbers that stay sharp in every corner set (see Master nodes overlay)">sharp nodes <input class="wide" data-k="sharpNodes" value="${(p.sharpNodes || []).join(", ")}" placeholder="e.g. 0, 3"/></label>
        <label title='Per-node radius multipliers, e.g. {"2": 0.5}'>node radius <input class="wide mono" data-k="nodeRadius" value="${p.nodeRadius ? esc(JSON.stringify(p.nodeRadius)) : ""}" placeholder='{"2":0.5}'/></label>
        <button class="btn small danger" data-act="del-path">Remove path</button>
      </div>
      <div class="err" data-err></div>
    </div>`;
  return `<div class="d-grid">
    <div>
      <div class="card">${canvasSvg(icon)}
        <div class="overlays">${Object.entries({ grid: "Grid", padding: "Padding", keylines: "Keylines", bounds: "Ink box", nodes: "Nodes", original: "Original" }).map(([k, l]) => `<label><input type="checkbox" data-ov="${k}" ${view.overlays[k] ? "checked" : ""}/> ${l}</label>`).join("")}</div>
        <div class="metrics">Preview shows ${view.style} / ${view.corner} / ${view.weight}. Change it in the top bar.</div>
      </div>
      <div class="card"><h3>Issues (live)</h3>${issueList(icon)}</div>
    </div>
    <div>
      <div class="card">
        <label class="field">Name <input id="eName" value="${esc(icon.name)}"/></label>
        <label class="field">Tags <input id="eTags" value="${esc((icon.tags || []).join(", "))}" placeholder="comma, separated"/></label>
        <div class="tabs style-tabs" id="eStyles">${config.styles.map((s) => `<button data-s="${s}" class="${s === style ? "on" : ""}">${s}</button>`).join("")}</div>
        <p class="hint">Draw every corner <b>sharp</b>. Rounded sets are generated. Coordinates are on the ${config.grid}px grid; keep ink within ${config.padding}–${config.grid - config.padding}.</p>
        ${parts.map((part, pi) => `<div class="part" data-part="${pi}">
          <div class="part-head">
            <input name="name" value="${esc(part.name)}" data-pk="name" title="Part name (used for animation)"/>
            <label>opacity <input name="opacity" type="number" step="0.05" min="0" max="1" data-pk="opacity" value="${part.opacity ?? ""}" placeholder="1"/></label>
            <button class="btn small" data-act="add-path">+ Path</button>
            <button class="btn small" data-act="up">↑</button>
            <button class="btn small danger" data-act="del-part">Remove part</button>
          </div>
          ${part.paths.map((p, ji) => pathBox(p, pi, ji)).join("")}
        </div>`).join("")}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn small" data-act="add-part">+ Part</button>
          ${style !== "outline" ? `<button class="btn small" data-act="copy-outline">Replace with a copy of outline</button>` : ""}
        </div>
      </div>
      <div class="edit-foot">
        <button class="btn primary" id="eSave" ${dirty ? "" : "disabled"}>Save</button>
        <button class="btn" id="eRevert" ${dirty ? "" : "disabled"}>Revert</button>
        <button class="btn" id="eFormat">Tidy path data</button>
        <span class="spacer"></span>
        <button class="btn danger" id="eDelete">Delete icon</button>
      </div>
    </div>
  </div>`;
}

function renderDetail() {
  const el = $("#detail");
  const icon = current();
  if (!icon) { el.innerHTML = `<div class="empty">Select an icon on the left, or create a new one.</div>`; return; }
  el.innerHTML = `<div class="d-head">
      <h1>${esc(icon.name)}${dirty ? " •" : ""}</h1>
      <div class="tabs" id="tabs"><button data-t="inspect" class="${view.tab === "inspect" ? "on" : ""}">Inspect</button><button data-t="edit" class="${view.tab === "edit" ? "on" : ""}">Edit</button></div>
      <span class="spacer"></span>
      <button class="btn" id="dAsk">Ask Claude about this icon</button>
      <button class="btn" id="dCopy">Copy SVG</button>
      <button class="btn" id="dDownload">Download SVG</button>
    </div>
    ${view.tab === "edit" ? renderEdit(icon) : renderInspect(icon)}`;
}

function renderAll() { renderHeader(); renderList(); renderDetail(); }

// ---------- Editing ----------
function markDirty() {
  dirty = true;
  const h = $(".d-head h1");
  if (h && !h.textContent.endsWith("•")) h.textContent += " •";
  $("#eSave") && ($("#eSave").disabled = false);
  $("#eRevert") && ($("#eRevert").disabled = false);
}
function refreshPreview() {
  // Re-render only the canvas, issues and the tile, so typing isn't interrupted.
  const icon = current();
  const card = $("#detail .card");
  if (card) card.querySelector(".canvas").outerHTML = canvasSvg(icon);
  const issues = [...document.querySelectorAll("#detail .card h3")].find((h) => h.textContent.startsWith("Issues"));
  if (issues) issues.parentElement.innerHTML = `<h3>${issues.textContent}</h3>${issueList(icon)}`;
  const tile = document.querySelector(`.tile[data-name="${CSS.escape(view.selected)}"] svg`);
  if (tile) tile.outerHTML = iconSvg(icon);
}

function onEditInput(e) {
  const icon = current();
  const t = e.target;
  const partEl = t.closest("[data-part]");
  const parts = icon.styles[view.editStyle];
  if (t.id === "eName") { icon.name = t.value.trim(); markDirty(); return; }
  if (t.id === "eTags") { icon.tags = t.value.split(",").map((s) => s.trim()).filter(Boolean); markDirty(); return; }
  if (!partEl) return;
  const part = parts[+partEl.dataset.part];
  if (t.dataset.pk) {
    if (t.dataset.pk === "opacity") { if (t.value === "") delete part.opacity; else part.opacity = +t.value; }
    else part.name = t.value.trim();
    markDirty(); refreshPreview(); return;
  }
  const box = t.closest(".pathbox");
  if (!box || !t.dataset.k) return;
  const p = part.paths[+box.dataset.path];
  const k = t.dataset.k;
  const errEl = box.querySelector("[data-err]");
  errEl.textContent = "";
  try {
    if (k === "d") { parse(t.value); p.d = t.value.trim(); }
    else if (k === "stroke" || k === "fill") { if (t.checked) p[k] = true; else delete p[k]; }
    else if (k === "fillRule") { if (t.value) p.fillRule = t.value; else delete p.fillRule; }
    else if (k === "strokeWidth" || k === "radius") { if (t.value === "") delete p[k]; else p[k] = +t.value; }
    else if (k === "sharpNodes") { const v = t.value.split(/[\s,]+/).filter(Boolean).map(Number); if (v.some(isNaN)) throw new Error("Use numbers, e.g. 0, 3"); if (v.length) p.sharpNodes = v; else delete p.sharpNodes; }
    else if (k === "nodeRadius") { if (!t.value.trim()) delete p.nodeRadius; else p.nodeRadius = JSON.parse(t.value); }
  } catch (err) { errEl.textContent = err.message; return; }
  markDirty(); refreshPreview();
}

function onEditClick(e) {
  const icon = current();
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.s) { view.editStyle = b.dataset.s; view.style = b.dataset.s; savePrefs(); renderAll(); return; }
  const act = b.dataset.act;
  if (!act) return;
  const parts = (icon.styles[view.editStyle] ||= []);
  const pi = +b.closest("[data-part]")?.dataset.part;
  const ji = +b.closest(".pathbox")?.dataset.path;
  if (act === "add-part") parts.push({ name: `part-${parts.length + 1}`, paths: [{ d: "M8 12L16 12", stroke: true }] });
  if (act === "del-part" && confirm(`Remove part "${parts[pi].name}"?`)) parts.splice(pi, 1);
  if (act === "up" && pi > 0) [parts[pi - 1], parts[pi]] = [parts[pi], parts[pi - 1]];
  if (act === "add-path") parts[pi].paths.push({ d: "M8 12L16 12", stroke: true });
  if (act === "del-path") parts[pi].paths.splice(ji, 1);
  if (act === "copy-outline" && confirm(`Replace ${view.editStyle} with a copy of outline?`)) icon.styles[view.editStyle] = clone(icon.styles.outline);
  markDirty(); renderAll();
}

async function save() {
  const icon = current();
  const oldName = view.selected;
  try {
    await api(`/api/icons/${encodeURIComponent(oldName)}`, "PUT", icon);
    dirty = false;
    view.selected = icon.name;
    savePrefs();
    await load(); renderAll();
    toast("Saved");
  } catch (err) { toast(`Not saved: ${err.message}`); }
}

// ---------- Requests ----------
function renderRequests() {
  const list = [...requests].sort((a, b) => (a.status === "done") - (b.status === "done") || b.created.localeCompare(a.created));
  $("#reqList").innerHTML = list.length
    ? list.map((r) => `<div class="req ${r.status === "done" ? "done" : ""}" data-id="${r.id}">
        <div class="meta"><span class="tag">${esc(r.type)}</span>${r.icon ? `<a href="#" data-goto="${esc(r.icon)}">${esc(r.icon)}</a>` : ""}<span>${new Date(r.created).toLocaleString()}</span><span>${r.status === "done" ? "✓ done" : r.status === "question" ? "❓ needs your answer" : "open"}</span></div>
        <div>${esc(r.text)}</div>
        ${r.note ? `<div class="note"><b>Claude:</b> ${esc(r.note)}</div>` : ""}
        <div class="actions">${r.status === "done" ? `<button class="btn small" data-reopen>Reopen</button>` : `<button class="btn small" data-done>Mark done</button>`}<button class="btn small danger" data-del>Delete</button></div>
      </div>`).join("")
    : `<p class="hint">No requests yet.</p>`;
}
async function saveRequests() { await api("/api/requests", "PUT", requests); renderRequests(); renderHeader(); renderList(); }
async function addRequest(icon, type, text) {
  requests.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), icon: icon || null, type, text, status: "open", created: new Date().toISOString() });
  await saveRequests();
  toast("Request added for Claude");
}

// ---------- Corners dialog ----------
function renderCornerPreview(values) {
  const tmp = { ...config, corners: values };
  const sample = ["home", "chat", "folder", "star", "bell", "credit-card"].map((n) => icons.find((i) => i.name === n)).filter(Boolean);
  $("#cornerPreview").innerHTML =
    `<div></div>${Object.keys(values).map((c) => `<div class="lbl">${c} · ${values[c]}px</div>`).join("")}` +
    sample.map((icon) => `<div class="lbl">${icon.name}</div>${Object.keys(values).map((c) => `<div><svg viewBox="0 0 24 24" fill="none">${partsToSvgInner(variantParts(icon, tmp, { style: view.style, corner: c, weight: view.weight }))}</svg></div>`).join("")}`).join("");
}

// ---------- Events ----------
function bind() {
  $("#q").addEventListener("input", (e) => { view.query = e.target.value; renderList(); });
  $("#filter").addEventListener("change", (e) => { view.filter = e.target.value; savePrefs(); renderList(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); $("#q").focus(); }
    if ((e.metaKey || e.ctrlKey) && e.key === "s" && dirty) { e.preventDefault(); save(); }
  });
  $("#tiles").addEventListener("click", (e) => {
    const t = e.target.closest(".tile");
    if (!t) return;
    if (dirty && !confirm("Discard unsaved changes?")) return;
    dirty = false;
    view.selected = t.dataset.name;
    draft = clone(icons.find((i) => i.name === view.selected));
    savePrefs(); renderAll();
  });
  const detail = $("#detail");
  detail.addEventListener("input", (e) => { if (view.tab === "edit") onEditInput(e); });
  detail.addEventListener("change", (e) => {
    const ov = e.target.dataset.ov;
    if (ov) {
      view.overlays[ov] = e.target.checked; savePrefs();
      if (ov === "original" && e.target.checked && !legacy) {
        fetch("/reference/dope-icons-0.1.0.json").then((r) => r.json()).then((j) => { legacy = j; renderDetail(); });
      }
      renderDetail();
    }
  });
  detail.addEventListener("click", async (e) => {
    const b = e.target.closest("button, td");
    if (!b) return;
    if (b.closest("#tabs") && b.dataset.t) { view.tab = b.dataset.t; if (b.dataset.t === "edit") view.editStyle = view.style; savePrefs(); renderDetail(); return; }
    if (b.tagName === "TD") {
      if (b.dataset.style) { view.style = b.dataset.style; view.corner = b.dataset.corner; }
      if (b.dataset.weight) view.weight = b.dataset.weight;
      savePrefs(); renderAll(); return;
    }
    const icon = current();
    if (b.id === "dCopy") { await navigator.clipboard.writeText(toSvg(icon, config, view)); toast("SVG copied"); return; }
    if (b.id === "dDownload") {
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([toSvg(icon, config, view)], { type: "image/svg+xml" })), download: `${icon.name}-${view.style}-${view.corner}-${view.weight}.svg` });
      a.click(); return;
    }
    if (b.id === "dAsk") { $("#drawer").hidden = false; renderRequests(); $("#reqForm").icon.value = icon.name; $("#reqForm").text.focus(); return; }
    if (b.dataset.ignore) {
      const why = prompt(`Why is "${RULES[b.dataset.ignore].title}" intentional for ${icon.name}?`);
      if (!why) return;
      icon.lintIgnore = { ...(icon.lintIgnore || {}), [b.dataset.ignore]: why };
      return save();
    }
    if (b.dataset.unignore) { delete icon.lintIgnore[b.dataset.unignore]; if (!Object.keys(icon.lintIgnore).length) delete icon.lintIgnore; return save(); }
    if (view.tab !== "edit") return;
    if (b.id === "eSave") return save();
    if (b.id === "eRevert") { dirty = false; draft = clone(icons.find((i) => i.name === view.selected)); renderAll(); return; }
    if (b.id === "eFormat") {
      for (const parts of Object.values(icon.styles)) for (const part of parts) for (const p of part.paths) { try { p.d = normalize(p.d); } catch {} }
      markDirty(); renderAll(); return;
    }
    if (b.id === "eDelete") {
      if (!confirm(`Delete ${view.selected} permanently?`)) return;
      await api(`/api/icons/${encodeURIComponent(view.selected)}`, "DELETE");
      dirty = false; view.selected = null; draft = null; await load(); renderAll(); toast("Deleted"); return;
    }
    onEditClick(e);
  });

  // Requests drawer
  $("#btnRequests").onclick = () => { $("#drawer").hidden = !$("#drawer").hidden; renderRequests(); };
  $("#drawerClose").onclick = () => ($("#drawer").hidden = true);
  $("#reqForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    await addRequest(f.icon.value.trim(), f.type.value, f.text.value.trim());
    f.text.value = "";
  });
  $("#reqList").addEventListener("click", async (e) => {
    const card = e.target.closest(".req");
    if (!card) return;
    const r = requests.find((x) => x.id === card.dataset.id);
    if (e.target.dataset.goto !== undefined) {
      e.preventDefault();
      if (icons.some((i) => i.name === r.icon)) { view.selected = r.icon; draft = clone(icons.find((i) => i.name === r.icon)); dirty = false; renderAll(); }
      return;
    }
    if (e.target.hasAttribute("data-done")) r.status = "done";
    else if (e.target.hasAttribute("data-reopen")) r.status = "open";
    else if (e.target.hasAttribute("data-del")) requests = requests.filter((x) => x !== r);
    else return;
    await saveRequests();
  });

  // New icon
  $("#btnNew").onclick = () => { $("#newError").textContent = ""; $("#dlgNew").showModal(); };
  $("#newForm").addEventListener("submit", async (e) => {
    if (e.submitter?.value !== "ok") return;
    e.preventDefault();
    const f = e.target, name = f.name.value.trim();
    if (icons.some((i) => i.name === name)) { $("#newError").textContent = `${name} already exists.`; return; }
    if (f.mode.value === "claude") {
      if (!f.text.value.trim()) { $("#newError").textContent = "Describe what the icon should show."; return; }
      await addRequest(name, "new", f.text.value.trim());
      $("#dlgNew").close(); $("#drawer").hidden = false; renderRequests(); return;
    }
    const box = "M6 6L18 6L18 18L6 18Z";
    const icon = { name, tags: [], styles: {
      outline: [{ name: "body", paths: [{ d: box, stroke: true }] }],
      solid: [{ name: "body", paths: [{ d: box, stroke: true, fill: true }] }],
      duotone: [{ name: "tint", opacity: config.duotoneOpacity, paths: [{ d: box, fill: true }] }, { name: "body", paths: [{ d: box, stroke: true }] }],
    } };
    try {
      await api(`/api/icons/${name}`, "PUT", icon);
      $("#dlgNew").close();
      await load();
      view.selected = name; view.tab = "edit"; view.editStyle = "outline"; draft = clone(icon); dirty = false;
      renderAll();
    } catch (err) { $("#newError").textContent = err.message; }
  });

  // Corners
  $("#btnCorners").onclick = () => {
    $("#cornerInputs").innerHTML = Object.entries(config.corners).map(([c, v]) => `<label>${c}<input type="number" step="0.25" min="0" name="${c}" value="${v}"/></label>`).join("");
    renderCornerPreview(config.corners);
    $("#dlgCorners").showModal();
  };
  $("#cornerInputs").addEventListener("input", () => {
    const vals = Object.fromEntries([...$("#cornerInputs").querySelectorAll("input")].map((i) => [i.name, +i.value || 0]));
    renderCornerPreview(vals);
  });
  $("#cornerForm").addEventListener("submit", async (e) => {
    if (e.submitter?.value !== "ok") return;
    const vals = Object.fromEntries([...$("#cornerInputs").querySelectorAll("input")].map((i) => [i.name, +i.value || 0]));
    await api("/api/config", "PUT", { ...config, corners: vals });
    toast("Corner radii saved");
  });

  // Theme
  const applyTheme = () => {
    const dark = view.theme ? view.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  };
  applyTheme();
  $("#btnTheme").onclick = () => { view.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; savePrefs(); applyTheme(); };

  // Live reload when files change on disk (e.g. Claude edited an icon).
  const es = new EventSource("/api/events");
  es.onmessage = async () => {
    if (dirty) {
      pendingReload = true;
      const bn = $("#banner");
      bn.hidden = false;
      bn.innerHTML = `Files changed on disk while you have unsaved edits. <button class="btn small" id="bnReload">Discard my edits and reload</button>`;
      $("#bnReload").onclick = async () => { dirty = false; bn.hidden = true; await load(); renderAll(); };
      return;
    }
    await load(); renderAll(); if (!$("#drawer").hidden) renderRequests();
    toast("Updated from disk");
  };
}

await load();
bind();
renderAll();
