// Icon checker shared by `npm run lint` and the studio.
// Each rule returns issues: { rule, severity: "error" | "warn" | "info", message, where?, fix? }.
// An icon can silence a rule with "lintIgnore": { "rule-id": "why this is intentional" }.
import { parse, clean, inkBounds, flattenedRuns, bakedFillets, misplacedStarts, dist } from "./path.js";
import { variantParts } from "./variants.js";

export const RULES = {
  "invalid-path": { severity: "error", title: "Path data can't be read", fix: "Fix the d attribute; only M L H V C S Q T A Z are supported." },
  "misplaced-start": { severity: "error", title: "Shape starts mid-edge (spike + diagonal)", fix: "Auto-fixable: npm run fix" },
  "flattened-curve": { severity: "error", title: "Curve stored as many tiny straight lines", fix: "Auto-fixable: npm run fix (refits arcs)" },
  "baked-fillet": { severity: "error", title: "Rounded corner baked into the sharp master", fix: "Auto-fixable: npm run fix (master must be sharp; rounding is generated)" },
  "outside-viewbox": { severity: "error", title: "Ink goes outside the 24×24 canvas", fix: "Move or shrink the shape; it gets clipped." },
  "part-mismatch": { severity: "warn", title: "Duotone parts don't match outline", fix: "Duotone should be the outline parts plus a 'tint' part, with the same names, so animations work in both." },
  "open-fill": { severity: "warn", title: "Filled path is not closed", fix: "End filled subpaths with Z; the stroke skips the open edge while the fill closes it." },
  "duplicate-geometry": { severity: "error", title: "Same drawing as another icon", fix: "Delete one or make them clearly different." },
  "zero-length": { severity: "warn", title: "Zero-length segments", fix: "Auto-fixable: npm run fix" },
  "padding": { severity: "warn", title: "Ink inside the 2px safety padding", fix: "Keep ink within 2–22 so icons line up optically and don't touch their container." },
  "off-center": { severity: "warn", title: "Not centred on the canvas", fix: "Centre the ink box (±0.5px), or ignore with a reason if the asymmetry is intentional." },
  "stroke-width": { severity: "warn", title: "Outline stroke differs from the base stroke", fix: "Outline strokes should all be the base stroke (1.5); weight scaling depends on it." },
  "naming": { severity: "warn", title: "Name isn't lowercase kebab-case", fix: "Use names like arrow-up-right." },
  "small": { severity: "info", title: "Optically small (largest side < 15px)", fix: "Consider enlarging, or ignore if small by design (chevrons)." },
  "solid-parts": { severity: "info", title: "Solid merges parts (cut-outs)", fix: "Expected when details are cut out of a filled shape; those details can't be animated separately in solid." },
  "solid-no-fill": { severity: "info", title: "Solid style is only a thicker line", fix: "Normal for pure line icons (arrows, check). For shapes, fill the area." },
  "duotone-no-tint": { severity: "info", title: "Duotone has no tint layer", fix: "Normal for pure line icons. For shapes, add a 'tint' part (filled, opacity 0.2)." },
  "off-grid": { severity: "info", title: "Straight edges off the 0.25px grid", fix: "Snap horizontal/vertical edges to multiples of 0.25 for crisper rendering." },
  "synonyms": { severity: "info", title: "Inconsistent naming across the set", fix: "Pick one word for the same concept (e.g. chat vs comment)." },
};

const SYNONYMS = [["chat", "comment", "message"], ["close", "x"], ["trash", "delete", "bin"], ["settings", "gear", "cog"], ["edit", "pencil"], ["user", "person", "profile"]];

function issue(rule, extra = {}) {
  return { rule, severity: RULES[rule].severity, title: RULES[rule].title, fix: RULES[rule].fix, ...extra };
}

export function lintIcon(icon, config) {
  const out = [];
  const g = config.grid, pad = config.padding;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(icon.name)) out.push(issue("naming", { message: `"${icon.name}"` }));

  const partNames = {};
  for (const style of config.styles) {
    const parts = icon.styles?.[style];
    if (!parts?.length) { out.push(issue("part-mismatch", { message: `No ${style} style` })); continue; }
    partNames[style] = parts.map((p) => p.name).filter((n) => n !== "tint");
    for (const part of parts) {
      part.paths.forEach((p, pi) => {
        const where = `${style} › ${part.name}${part.paths.length > 1 ? ` #${pi + 1}` : ""}`;
        let subs;
        try { subs = parse(p.d); } catch (e) { out.push(issue("invalid-path", { where, message: e.message })); return; }
        if (misplacedStarts(subs).length) out.push(issue("misplaced-start", { where }));
        const runs = flattenedRuns(subs);
        if (runs.length) out.push(issue("flattened-curve", { where, message: `${runs.reduce((n, r) => n + r.to - r.from, 0)} tiny segments` }));
        const baked = bakedFillets(subs);
        if (baked.length) out.push(issue("baked-fillet", { where, message: `${baked.length} corner${baked.length > 1 ? "s" : ""}` }));
        if (p.fill && subs.some((s) => !s.closed)) out.push(issue("open-fill", { where }));
        let zero = 0;
        for (const s of subs) { let q = s.start; for (const seg of s.segs) { if (dist(q, seg.to) < 1e-3) zero++; q = seg.to; } }
        // An explicit line back to the start before Z is the common, harmless case; count the rest.
        const explicitClose = subs.filter((s) => s.closed && s.segs.length && dist(s.segs[s.segs.length - 1].to, s.start) < 1e-3).length;
        if (zero - explicitClose > 0) out.push(issue("zero-length", { where, message: `${zero - explicitClose}` }));
        if (style === "outline" && p.stroke && (p.strokeWidth ?? config.baseStroke) !== config.baseStroke)
          out.push(issue("stroke-width", { where, message: `${p.strokeWidth}px` }));
        // Off-grid straight edges.
        let off = 0;
        for (const s of clean(subs)) {
          let q = s.start;
          for (const seg of s.segs) {
            if (seg.t === "L") {
              const v = Math.abs(q[0] - seg.to[0]) < 1e-3 ? q[0] : Math.abs(q[1] - seg.to[1]) < 1e-3 ? q[1] : null;
              if (v !== null && Math.abs(v * 4 - Math.round(v * 4)) > 0.02) off++;
            }
            q = seg.to;
          }
        }
        if (off) out.push(issue("off-grid", { where, message: `${off} edge${off > 1 ? "s" : ""}` }));
      });
    }
  }
  const ref = partNames.outline?.join(",");
  for (const style of config.styles) {
    if (style === "outline" || !partNames[style] || ref === undefined || partNames[style].join(",") === ref) continue;
    out.push(issue(style === "solid" ? "solid-parts" : "part-mismatch", { where: style, message: `[${partNames[style].join(", ")}] vs outline [${partNames.outline.join(", ")}]` }));
  }

  // Geometry checks on the default variant (outline, round, regular) plus every style for bounds.
  for (const style of config.styles) {
    if (!icon.styles?.[style]) continue;
    let b;
    try { b = inkBounds(variantParts(icon, config, { style, corner: "round", weight: "regular" }).flatMap((p) => p.paths)); } catch { continue; }
    if (!b) continue;
    const r = (n) => Math.round(n * 100) / 100;
    if (b.x0 < -0.01 || b.y0 < -0.01 || b.x1 > g + 0.01 || b.y1 > g + 0.01)
      out.push(issue("outside-viewbox", { where: style, message: `ink ${r(b.x0)},${r(b.y0)} → ${r(b.x1)},${r(b.y1)}` }));
    else if (b.x0 < pad - 0.05 || b.y0 < pad - 0.05 || b.x1 > g - pad + 0.05 || b.y1 > g - pad + 0.05)
      out.push(issue("padding", { where: style, message: `ink ${r(b.x0)},${r(b.y0)} → ${r(b.x1)},${r(b.y1)}` }));
    if (style === "outline") {
      const dx = b.cx - g / 2, dy = b.cy - g / 2;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) out.push(issue("off-center", { where: style, message: `centre is ${r(dx)}, ${r(dy)} px off` }));
      if (Math.max(b.w, b.h) < 15) out.push(issue("small", { where: style, message: `${r(b.w)} × ${r(b.h)}` }));
    }
  }
  if (icon.styles?.solid && !icon.styles.solid.some((pt) => pt.paths.some((p) => p.fill))) out.push(issue("solid-no-fill"));
  if (icon.styles?.duotone && !icon.styles.duotone.some((pt) => (pt.opacity ?? 1) < 1)) out.push(issue("duotone-no-tint"));

  const ignore = icon.lintIgnore || {};
  return out.map((i) => (ignore[i.rule] ? { ...i, ignored: ignore[i.rule] } : i));
}

// Checks that need the whole set.
export function lintSet(icons, config) {
  const out = {};
  const add = (name, i) => (out[name] ||= []).push(i);
  const sig = new Map();
  for (const icon of icons) {
    const key = JSON.stringify(icon.styles?.outline?.map((pt) => pt.paths.map((p) => p.d)));
    if (sig.has(key)) { add(icon.name, issue("duplicate-geometry", { message: `same as ${sig.get(key)}` })); add(sig.get(key), issue("duplicate-geometry", { message: `same as ${icon.name}` })); }
    else sig.set(key, icon.name);
  }
  const names = new Set(icons.map((i) => i.name));
  const words = new Map();
  for (const n of names) for (const w of n.split("-")) words.set(w, [...(words.get(w) || []), n]);
  for (const group of SYNONYMS) {
    const used = group.filter((w) => words.has(w));
    if (used.length > 1) {
      const msg = used.map((w) => `${w}: ${words.get(w).join(", ")}`).join(" · ");
      for (const w of used) for (const n of words.get(w)) add(n, issue("synonyms", { message: msg }));
    }
  }
  for (const icon of icons) {
    const ignore = icon.lintIgnore || {};
    if (out[icon.name]) out[icon.name] = out[icon.name].map((i) => (ignore[i.rule] ? { ...i, ignored: ignore[i.rule] } : i));
  }
  return out;
}

export function lintAll(icons, config) {
  const set = lintSet(icons, config);
  const result = {};
  for (const icon of icons) result[icon.name] = [...lintIcon(icon, config), ...(set[icon.name] || [])];
  return result;
}
