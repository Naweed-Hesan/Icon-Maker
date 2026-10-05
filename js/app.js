(() => {
  const STORE_KEY = "iconmaker.custom";
  const PREFS_KEY = "iconmaker.prefs";
  const $ = (s) => document.querySelector(s);

  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    },
  };

  const builtIn = (window.ICONS || []).map((i) => ({ ...i, custom: false }));
  let custom = store.get(STORE_KEY, []).map((i) => ({ ...i, custom: true }));

  const prefs = Object.assign(
    { size: 32, stroke: 1.75, corners: "round", color: null, theme: null, category: "all" },
    store.get(PREFS_KEY, {})
  );
  let query = "";
  let selected = null;

  const allIcons = () => [...custom, ...builtIn];
  const savePrefs = () => store.set(PREFS_KEY, prefs);
  const saveCustom = () => store.set(STORE_KEY, custom.map(({ custom: _, ...i }) => i));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const slug = (s) => String(s).toLowerCase().trim().replace(/\.svg$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  // ---------- SVG rendering ----------
  function svg(icon, opts = {}) {
    const o = { size: prefs.size, stroke: prefs.stroke, corners: prefs.corners, color: prefs.color || "currentColor", ...opts };
    const paint = icon.mode === "stroke"
      ? `fill="none" stroke="${o.color}" stroke-width="${o.stroke}" stroke-linecap="${o.corners === "round" ? "round" : "square"}" stroke-linejoin="${o.corners === "round" ? "round" : "miter"}"`
      : `fill="${o.color}"`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${o.size}" height="${o.size}" viewBox="${icon.viewBox}" ${paint}>${icon.body}</svg>`;
  }
  const uiIcon = (name) => {
    const icon = builtIn.find((i) => i.name === name);
    return icon ? svg(icon, { size: 18, stroke: 2, corners: "round", color: "currentColor" }) : "";
  };
  const paintUiIcons = (root = document) =>
    root.querySelectorAll("[data-icon]").forEach((el) => (el.innerHTML = uiIcon(el.dataset.icon)));

  function toJsx(icon) {
    const comp = slug(icon.name).split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("").replace(/^(\d)/, "Icon$1") + "Icon";
    const camel = (s) => s
      .replace(/\sclass=/g, " className=")
      .replace(/\s([a-z]+(?:-[a-z]+)+)=/g, (_, a) => " " + a.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + "=");
    const markup = camel(svg(icon)).replace(/^<svg ([^>]*)>/, "<svg $1 {...props}>");
    return `export function ${comp}(props) {\n  return (\n    ${markup}\n  );\n}\n`;
  }

  // ---------- Filtering ----------
  function visible() {
    const q = query.toLowerCase().trim();
    return allIcons().filter((i) => {
      if (prefs.category !== "all" && i.category !== prefs.category) return false;
      if (!q) return true;
      return [i.name, i.category, ...(i.tags || [])].some((t) => t.toLowerCase().includes(q));
    });
  }

  // ---------- Render ----------
  function renderCategories() {
    const counts = {};
    allIcons().forEach((i) => (counts[i.category] = (counts[i.category] || 0) + 1));
    const cats = Object.keys(counts).sort();
    if (prefs.category !== "all" && !counts[prefs.category]) prefs.category = "all";
    const item = (key, label, n) =>
      `<li><button data-cat="${esc(key)}" class="${prefs.category === key ? "on" : ""}">${esc(label)} <small>${n}</small></button></li>`;
    $("#categories").innerHTML =
      item("all", "All icons", allIcons().length) + cats.map((c) => item(c, c.replace(/-/g, " "), counts[c])).join("");
    $("#catList").innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join("");
  }

  function renderGrid() {
    const list = visible();
    $("#count").textContent = `${list.length} icon${list.length === 1 ? "" : "s"}`;
    $("#empty").hidden = list.length > 0;
    $("#grid").innerHTML = list
      .map((i) => {
        const id = `${i.category}/${i.name}`;
        const on = selected && `${selected.category}/${selected.name}` === id ? " on" : "";
        return `<button class="tile${on}" role="listitem" data-id="${esc(id)}" title="${esc(i.name)}">
          <span class="glyph">${svg(i)}</span><span class="label">${esc(i.name)}</span></button>`;
      })
      .join("");
  }

  function renderPanel() {
    const panel = $("#panel");
    if (!selected) { panel.hidden = true; return; }
    panel.hidden = false;
    $("#preview").innerHTML = svg(selected, { size: 96 });
    $("#pName").textContent = selected.name;
    $("#pMeta").textContent = `${selected.category.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())} · ${selected.mode === "stroke" ? "outline" : "filled"}${selected.custom ? " · saved in this browser" : ""}`;
    $("#pTags").innerHTML = (selected.tags || []).map((t) => `<span>${esc(t)}</span>`).join("");
    $("#pCode").textContent = svg(selected);
    panel.querySelector('[data-act="delete"]').hidden = !selected.custom;
  }

  const render = () => { renderCategories(); renderGrid(); renderPanel(); };

  // ---------- Actions ----------
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement("textarea"), { value: text });
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    toast(`${label} copied`);
  }

  function download(blob, filename) {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function downloadPng(icon, px = 512) {
    const color = prefs.color || getComputedStyle(document.body).color;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg(icon, { size: px, color })], { type: "image/svg+xml" }));
    img.onload = () => {
      const c = Object.assign(document.createElement("canvas"), { width: px, height: px });
      c.getContext("2d").drawImage(img, 0, 0, px, px);
      URL.revokeObjectURL(url);
      c.toBlob((b) => download(b, `${icon.name}.png`), "image/png");
    };
    img.src = url;
  }

  const actions = {
    svg: (i) => copy(svg(i), "SVG"),
    jsx: (i) => copy(toJsx(i), "JSX"),
    name: (i) => copy(i.name, "Name"),
    "dl-svg": (i) => download(new Blob([svg(i)], { type: "image/svg+xml" }), `${i.name}.svg`),
    "dl-png": (i) => downloadPng(i),
    delete: (i) => {
      if (!confirm(`Delete "${i.name}" from My icons?`)) return;
      custom = custom.filter((c) => !(c.name === i.name && c.category === i.category));
      saveCustom();
      selected = null;
      render();
      toast("Icon deleted");
    },
  };

  // ---------- Importing SVGs ----------
  function parseSvg(text) {
    const doc = new DOMParser().parseFromString(text.trim(), "image/svg+xml");
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) throw new Error("That doesn't look like valid SVG.");
    root.querySelectorAll("script, foreignObject").forEach((n) => n.remove());
    root.querySelectorAll("*").forEach((el) => {
      [...el.attributes].forEach((a) => {
        if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
      });
    });
    const w = parseFloat(root.getAttribute("width")), h = parseFloat(root.getAttribute("height"));
    const viewBox = root.getAttribute("viewBox") || (w && h ? `0 0 ${w} ${h}` : "0 0 24 24");
    const fill = root.getAttribute("fill"), stroke = root.getAttribute("stroke");
    const mode = fill === "none" || (stroke && stroke !== "none") ? "stroke" : "fill";
    const body = [...root.childNodes]
      .map((n) => new XMLSerializer().serializeToString(n))
      .join("")
      .replace(/\s+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!body) throw new Error("The SVG is empty.");
    return { viewBox, mode, body };
  }

  function addIcon({ name, category, tags, text }) {
    const icon = { name: slug(name), category: slug(category) || "my-icons", tags, ...parseSvg(text), custom: true };
    if (!icon.name) throw new Error("Give the icon a name.");
    if (allIcons().some((i) => i.name === icon.name && i.category === icon.category))
      icon.name = `${icon.name}-${Date.now().toString(36).slice(-4)}`;
    custom.unshift(icon);
    return icon;
  }

  async function handleFiles(files) {
    const form = $("#addForm");
    const category = form.category.value;
    const tags = form.tags.value.split(",").map((t) => t.trim()).filter(Boolean);
    let added = 0, failed = [];
    for (const f of files) {
      try { addIcon({ name: f.name, category, tags, text: await f.text() }); added++; }
      catch { failed.push(f.name); }
    }
    saveCustom();
    if (added) {
      prefs.category = slug(category) || "my-icons";
      savePrefs();
      render();
      $("#addDialog").close();
      toast(`Added ${added} icon${added === 1 ? "" : "s"}`);
    }
    $("#addError").textContent = failed.length ? `Couldn't read: ${failed.join(", ")}` : "";
  }

  // ---------- Events ----------
  function bind() {
    $("#search").addEventListener("input", (e) => { query = e.target.value; renderGrid(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); $("#search").focus(); }
      if (e.key === "Escape" && !$("#addDialog").open) { selected = null; renderGrid(); renderPanel(); $("#sidebar").classList.remove("open"); }
    });

    $("#categories").addEventListener("click", (e) => {
      const b = e.target.closest("[data-cat]");
      if (!b) return;
      prefs.category = b.dataset.cat;
      savePrefs();
      $("#sidebar").classList.remove("open");
      render();
    });

    $("#grid").addEventListener("click", (e) => {
      const t = e.target.closest(".tile");
      if (!t) return;
      selected = allIcons().find((i) => `${i.category}/${i.name}` === t.dataset.id);
      renderGrid();
      renderPanel();
    });

    $("#panel").addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (b && selected) actions[b.dataset.act](selected);
    });
    $("#panelClose").addEventListener("click", () => { selected = null; renderGrid(); renderPanel(); });

    const range = (id, key, fmt) => {
      const el = $(`#${id}`), out = $(`#${id}Out`);
      el.value = prefs[key];
      out.textContent = fmt(prefs[key]);
      el.addEventListener("input", () => {
        prefs[key] = parseFloat(el.value);
        out.textContent = fmt(prefs[key]);
        savePrefs();
        renderGrid();
        renderPanel();
      });
    };
    range("size", "size", (v) => `${v}px`);
    range("stroke", "stroke", (v) => String(v));

    const corners = $("#corners");
    const syncCorners = () => corners.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === prefs.corners));
    syncCorners();
    corners.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      prefs.corners = b.dataset.v;
      savePrefs(); syncCorners(); renderGrid(); renderPanel();
    });

    const color = $("#color"), reset = $("#colorReset");
    const syncColor = () => { if (prefs.color) color.value = prefs.color; reset.classList.toggle("on", !prefs.color); };
    syncColor();
    color.addEventListener("input", () => { prefs.color = color.value; savePrefs(); syncColor(); renderGrid(); renderPanel(); });
    reset.addEventListener("click", () => { prefs.color = null; savePrefs(); syncColor(); renderGrid(); renderPanel(); });

    const applyTheme = () => {
      const dark = prefs.theme ? prefs.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      $("#themeBtn").innerHTML = uiIcon(dark ? "sun" : "moon");
    };
    applyTheme();
    $("#themeBtn").addEventListener("click", () => {
      prefs.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      savePrefs(); applyTheme();
    });

    $("#navToggle").innerHTML = uiIcon("menu");
    $("#panelClose").innerHTML = uiIcon("close");
    $("#navToggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

    // Add dialog
    const dialog = $("#addDialog"), form = $("#addForm");
    const openAdd = () => {
      $("#addError").textContent = "";
      if (prefs.category !== "all") form.category.value = prefs.category;
      dialog.showModal();
    };
    $("#addBtn").addEventListener("click", openAdd);
    $("#emptyAdd").addEventListener("click", openAdd);

    form.addEventListener("submit", (e) => {
      if (e.submitter?.value !== "add") return;
      e.preventDefault();
      try {
        const icon = addIcon({
          name: form.name.value,
          category: form.category.value,
          tags: form.tags.value.split(",").map((t) => t.trim()).filter(Boolean),
          text: form.svg.value,
        });
        saveCustom();
        prefs.category = icon.category;
        savePrefs();
        selected = icon;
        form.name.value = form.svg.value = form.tags.value = "";
        dialog.close();
        render();
        toast(`Added "${icon.name}"`);
      } catch (err) {
        $("#addError").textContent = err.message;
      }
    });

    const drop = $("#drop");
    $("#files").addEventListener("change", (e) => { handleFiles([...e.target.files]); e.target.value = ""; });
    ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("over")));
    drop.addEventListener("drop", (e) => { e.preventDefault(); handleFiles([...e.dataTransfer.files].filter((f) => /\.svg$/i.test(f.name))); });

    $("#exportBtn").addEventListener("click", () => {
      if (!custom.length) return toast("No custom icons yet — add some first");
      const data = custom.map(({ custom: _, ...i }) => i);
      download(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "my-icons.json");
      toast(`Exported ${data.length} icon${data.length === 1 ? "" : "s"}`);
    });
  }

  paintUiIcons();
  bind();
  render();
})();
