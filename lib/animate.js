// Icon animation: data format, presets, CSS export, frame rendering and bounds checks.
//
// Master format (icons/<name>.json):
//   "animations": {
//     "ring": {
//       "duration": 700, "easing": "ease-in-out", "iterations": 1,      // or "infinite"
//       "parts": {
//         "body":    { "origin": [12, 3.5], "keyframes": [ { "t": 0, "rotate": 0 }, { "t": 0.25, "rotate": 12 }, { "t": 1, "rotate": 0 } ] },
//         "clapper": { "origin": [12, 3.5], "delay": 60, "keyframes": [ ... ] }
//       }
//     }
//   }
// Keyframe props: t (0–1), x / y (px), rotate (deg), scale, opacity (0–1), draw (0–1 of the stroke drawn).
// Parts are matched by name, so an animation works in every style that has those parts.
import { parse, sample, inkBounds } from "./path.js";
import { variantParts, partsToSvgInner } from "./variants.js";

export const KEYFRAME_PROPS = ["x", "y", "rotate", "scale", "opacity", "draw"];
const DEFAULTS = { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1, draw: 1 };
const r3 = (n) => Math.round(n * 1000) / 1000;

// ---------- Timing ----------

const EASINGS = { linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1], "ease-in": [0.42, 0, 1, 1], "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1] };
function bezier([x1, y1, x2, y2]) {
  const at = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x) => {
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 30; i++) { t = (lo + hi) / 2; if (at(x1, x2, t) < x) lo = t; else hi = t; }
    return at(y1, y2, t);
  };
}
export function easingFn(e = "ease-in-out") {
  if (EASINGS[e]) return bezier(EASINGS[e]);
  const m = String(e).match(/cubic-bezier\(([^)]+)\)/);
  if (m) { const v = m[1].split(",").map(Number); if (v.length === 4 && v.every((n) => !isNaN(n))) return bezier(v); }
  return bezier(EASINGS["ease-in-out"]);
}

// Total length of one play (longest part incl. its delay), in ms.
export function totalDuration(anim) {
  const parts = Object.values(anim.parts || {});
  return Math.max(anim.duration || 0, ...parts.map((p) => (p.delay || 0) + (p.duration ?? anim.duration ?? 0)));
}

// Property values for one part at time `ms` (CSS semantics: easing applies per keyframe segment).
export function propsAt(anim, part, ms) {
  const dur = part.duration ?? anim.duration ?? 600;
  const delay = part.delay || 0;
  const iter = anim.iterations ?? 1;
  let p = (ms - delay) / dur;
  if (p < 0) p = 0;
  else if (iter === "infinite") p = p % 1;
  else if (p >= iter) p = 1;
  else p = p % 1 || (p > 0 && Number.isInteger(p) ? 1 : p);
  const kfs = [...(part.keyframes || [])].sort((a, b) => a.t - b.t);
  const ease = easingFn(part.easing || anim.easing);
  const out = {};
  for (const prop of KEYFRAME_PROPS) {
    const ks = kfs.filter((k) => k[prop] !== undefined);
    if (!ks.length) continue;
    // CSS uses the element's own value at 0%/100% when a keyframe is missing.
    const list = [...(ks[0].t > 0 ? [{ t: 0, [prop]: DEFAULTS[prop] }] : []), ...ks, ...(ks[ks.length - 1].t < 1 ? [{ t: 1, [prop]: DEFAULTS[prop] }] : [])];
    let v = list[list.length - 1][prop];
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      if (p >= a.t && p <= b.t) {
        const local = b.t === a.t ? 1 : ease((p - a.t) / (b.t - a.t));
        v = a[prop] + (b[prop] - a[prop]) * local;
        break;
      }
    }
    out[prop] = v;
  }
  return out;
}

const transformOf = (v, origin = [12, 12]) => {
  const [ox, oy] = origin;
  const t = [];
  if (v.x || v.y) t.push(`translate(${r3(v.x || 0)} ${r3(v.y || 0)})`);
  if (v.rotate) t.push(`rotate(${r3(v.rotate)})`);
  if (v.scale !== undefined && v.scale !== 1) t.push(`scale(${r3(v.scale)})`);
  return t.length ? `translate(${ox} ${oy}) ${t.join(" ")} translate(${-ox} ${-oy})` : "";
};

// ---------- Rendering ----------

// Static frame of an animation as SVG inner markup (used for filmstrips and checks).
export function frameInner(icon, config, variant, animName, ms, { color = "currentColor" } = {}) {
  const anim = icon.animations?.[animName];
  const parts = variantParts(icon, config, variant);
  if (!anim) return partsToSvgInner(parts, { color });
  return parts
    .map((part) => {
      const a = anim.parts?.[part.name];
      const single = partsToSvgInner([part], { color, pathLength: !!a && usesDraw(a) });
      if (!a) return single;
      const v = propsAt(anim, a, ms);
      const attrs = [];
      const tr = transformOf(v, a.origin);
      if (tr) attrs.push(`transform="${tr}"`);
      if (v.opacity !== undefined && v.opacity < 1) attrs.push(`opacity="${r3(v.opacity)}"`);
      if (v.draw !== undefined) attrs.push(`stroke-dasharray="${DASH}" stroke-dashoffset="${r3(dashOffset(v.draw))}"${v.draw <= 0.0005 ? ' visibility="hidden"' : ""}`);
      return attrs.length ? `<g ${attrs.join(" ")}>${single}</g>` : single;
    })
    .join("");
}

// "draw": paths get pathLength="1". The dash is offset a hair past the start (and the gap is a hair longer
// than the path) so an undrawn stroke shows nothing, not even its round end-cap dot.
const DASH = "1 1.02";
const dashOffset = (draw) => 1.01 * (1 - draw);
const usesDraw = (a) => (a.keyframes || []).some((k) => k.draw !== undefined);
export const drawParts = (anim) => Object.entries(anim?.parts || {}).filter(([, a]) => usesDraw(a)).map(([n]) => n);

// CSS for one animation. `scope` is the selector of the <svg> to animate.
export function animationCss(iconName, animName, anim, scope) {
  const css = [];
  const iter = anim.iterations ?? 1;
  for (const [part, a] of Object.entries(anim.parts || {})) {
    const id = `dope-${iconName}-${animName}-${part}`.replace(/[^a-z0-9-]/gi, "-");
    const frames = [...(a.keyframes || [])].sort((x, y) => x.t - y.t).map((k) => {
      const decl = [];
      const tr = [];
      if (k.x !== undefined || k.y !== undefined) tr.push(`translate(${r3(k.x || 0)}px, ${r3(k.y || 0)}px)`);
      if (k.rotate !== undefined) tr.push(`rotate(${r3(k.rotate)}deg)`);
      if (k.scale !== undefined) tr.push(`scale(${r3(k.scale)})`);
      if (tr.length) decl.push(`transform: ${tr.join(" ")}`);
      if (k.opacity !== undefined) decl.push(`opacity: ${r3(k.opacity)}`);
      // Chrome still paints round joins of a fully dashed-away stroke, so hide it outright at draw 0.
      // visibility switches discretely (visible for any in-between value), so this doesn't fade.
      if (k.draw !== undefined) decl.push(`stroke-dashoffset: ${r3(dashOffset(k.draw))}`, `visibility: ${k.draw <= 0 ? "hidden" : "visible"}`);
      return `  ${r3(k.t * 100)}% { ${decl.join("; ")} }`;
    });
    css.push(`@keyframes ${id} {\n${frames.join("\n")}\n}`);
    const [ox, oy] = a.origin || [12, 12];
    const dash = usesDraw(a) ? ` stroke-dasharray: ${DASH};` : "";
    css.push(
      `${scope} [data-part="${part}"] { transform-box: view-box; transform-origin: ${ox}px ${oy}px;${dash} animation: ${id} ${a.duration ?? anim.duration ?? 600}ms ${a.easing || anim.easing || "ease-in-out"} ${a.delay || 0}ms ${iter} both; }`
    );
  }
  css.push(`@media (prefers-reduced-motion: reduce) { ${scope} [data-part] { animation: none !important; } }`);
  return css.join("\n");
}

// Self-contained animated SVG that plays when displayed.
export function animatedSvg(icon, config, variant, animName, { color = "currentColor", size } = {}) {
  const anim = icon.animations[animName];
  const draws = new Set(drawParts(anim));
  const parts = variantParts(icon, config, variant);
  const inner = parts.map((p) => partsToSvgInner([p], { color, pathLength: draws.has(p.name) })).join("");
  const g = config.grid, px = size || g;
  // Unique scope, so several inline animated SVGs on one page don't animate each other's parts.
  const scope = `dope-a-${icon.name}-${animName}`.replace(/[^a-z0-9-]/gi, "-");
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${scope}" width="${px}" height="${px}" viewBox="0 0 ${g} ${g}" fill="none"><style>\n${animationCss(icon.name, animName, anim, "." + scope)}\n</style>${inner}</svg>\n`;
}

// ---------- Checks ----------

// Ink bounds over the whole animation (sampled), for the default variant.
export function animationBounds(icon, config, animName, variant = { style: "outline", corner: "round", weight: "regular" }) {
  const anim = icon.animations?.[animName];
  if (!anim) return null;
  const parts = variantParts(icon, config, variant);
  const pts = parts.map((part) => ({
    name: part.name,
    pts: part.paths.flatMap((p) => {
      const h = p.stroke ? p.strokeWidth / 2 : 0;
      return sample(parse(p.d), 0.4).flatMap(([x, y]) => [[x - h, y - h], [x + h, y + h], [x - h, y + h], [x + h, y - h]]);
    }),
  }));
  const total = totalDuration(anim);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i <= 40; i++) {
    const ms = (total * i) / 40;
    for (const { name, pts: list } of pts) {
      const a = anim.parts?.[name];
      const v = a ? propsAt(anim, a, ms) : {};
      if (v.opacity === 0) continue;
      const [ox, oy] = a?.origin || [12, 12];
      const rad = ((v.rotate || 0) * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad), k = v.scale ?? 1;
      for (const [px, py] of list) {
        const dx = (px - ox) * k, dy = (py - oy) * k;
        const x = ox + dx * c - dy * s + (v.x || 0), y = oy + dx * s + dy * c + (v.y || 0);
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1 };
}

// ---------- Presets ----------

function partBounds(icon, config, names) {
  const parts = variantParts(icon, config, { style: "outline", corner: "round", weight: "regular" }).filter((p) => !names || names.includes(p.name));
  return inkBounds(parts.flatMap((p) => p.paths)) || { x0: 2, y0: 2, x1: 22, y1: 22, cx: 12, cy: 12, w: 20, h: 20 };
}
function maxReach(icon, config, names, [cx, cy]) {
  let m = 0;
  for (const part of variantParts(icon, config, { style: "outline", corner: "round", weight: "regular" }))
    if (names.includes(part.name))
      for (const p of part.paths) {
        const h = p.stroke ? p.strokeWidth / 2 : 0;
        for (const [x, y] of sample(parse(p.d), 0.3)) m = Math.max(m, Math.hypot(x - cx, y - cy) + h);
      }
  return m;
}
const outlineParts = (icon) => (icon.styles.outline || []).map((p) => p.name);
const all = (names, make) => Object.fromEntries(names.map((n, i) => [n, make(n, i)]));

export const PRESETS = {
  auto: { label: "Auto (pick per icon)", hint: "Chooses a fitting motion from the icon's name: bells ring, arrows nudge their way, loaders spin, likes pop, checks draw, live/audio icons pulse. Everything else draws in." },
  draw: { label: "Draw", hint: "Strokes draw themselves in, part by part; tints fade in." },
  pop: { label: "Pop", hint: "Quick squash and overshoot, e.g. like/favourite." },
  wiggle: { label: "Wiggle / ring", hint: "Swings from the top, e.g. bell, notification." },
  bounce: { label: "Bounce", hint: "Hops up and settles, e.g. download done." },
  spin: { label: "Spin (loop)", hint: "Continuous rotation, e.g. loader, refresh, settings." },
  pulse: { label: "Pulse (loop)", hint: "Gentle breathing scale, e.g. live, recording." },
  nudge: { label: "Nudge", hint: "Small push in a direction, e.g. arrows, send." },
  fade: { label: "Fade in", hint: "Parts fade in one after another." },
};

// Builds an animation from a preset. opts: { parts?: [names], direction?: "up"|"down"|"left"|"right" }
// Picks a preset (and direction) that suits the icon's meaning, from its name.
export function autoPreset(name) {
  const has = (...w) => w.some((x) => name === x || name.startsWith(x + "-") || name.endsWith("-" + x) || name.includes("-" + x + "-"));
  const dirOf = (fallback) => ["up-right", "up-left", "down-right", "down-left", "right", "left", "up", "down"].find((d) => name.includes(d)) || fallback;
  if (has("loader", "refresh", "settings", "sync", "spinner")) return { preset: "spin" };
  if (has("bell", "alarm", "notification")) return { preset: "wiggle" };
  if (has("heart", "star", "thumbs", "like", "bookmark", "crown", "trophy", "award", "gift", "smile") || name === "share") return { preset: "pop" };
  if (name === "trending-up") return { preset: "nudge", direction: "up-right" };
  if (name === "trending-down") return { preset: "nudge", direction: "down-right" };
  if (has("download")) return { preset: "nudge", direction: "down" };
  if (has("upload") || name === "share-up") return { preset: "nudge", direction: "up" };
  if (has("send", "plane", "rocket", "external", "navigation")) return { preset: "nudge", direction: "up-right" };
  if (has("undo", "reply", "rewind", "skip-back")) return { preset: "nudge", direction: "left" };
  if (has("redo", "forward", "fast-forward", "skip-forward", "log-in", "log-out")) return { preset: "nudge", direction: "right" };
  if (name.includes("selector") || name.endsWith("-up-down") || name.endsWith("-left-right")) return { preset: "pop" };
  if (has("arrow", "arrows", "chevron", "chevrons", "corner", "navigation")) return { preset: "nudge", direction: dirOf("right") };
  if (has("microphone", "broadcast", "wifi", "rss", "volume", "speaker", "record", "live", "cast", "voicemail", "phone-call")) return { preset: "pulse" };
  if (has("bounce", "inbox", "package", "archive")) return { preset: "bounce" };
  return { preset: "draw" };
}

export function presetAnimation(icon, config, preset, opts = {}) {
  if (preset === "auto") {
    const pick = autoPreset(icon.name);
    return presetAnimation(icon, config, pick.preset, { ...opts, direction: opts.direction || pick.direction });
  }
  const names = opts.parts?.length ? opts.parts : outlineParts(icon);
  const b = partBounds(icon, config, names);
  const g = config.grid;
  const center = [r3(b.cx), r3(b.cy)];
  const room = { up: b.y0 - 0.25, down: g - 0.25 - b.y1, left: b.x0 - 0.25, right: g - 0.25 - b.x1 };
  switch (preset) {
    case "draw": {
      const outline = icon.styles.outline || [];
      const strokeParts = names.filter((n) => outline.find((p) => p.name === n)?.paths.some((p) => p.stroke));
      const fillParts = names.filter((n) => !strokeParts.includes(n));
      return {
        duration: 600, easing: "ease-out", iterations: 1,
        parts: {
          ...all(strokeParts, (n, i) => ({ delay: i * 120, keyframes: [{ t: 0, draw: 0 }, { t: 1, draw: 1 }] })),
          ...all(fillParts, () => ({ delay: strokeParts.length * 120, keyframes: [{ t: 0, opacity: 0 }, { t: 1, opacity: 1 }] })),
        },
      };
    }
    case "pop": {
      const max = Math.min(1.1, (g - 0.5) / Math.max(b.w, b.h));
      return { duration: 450, easing: "ease-out", iterations: 1, parts: all(names, () => ({ origin: [12, 12], keyframes: [{ t: 0, scale: 1 }, { t: 0.35, scale: 0.82 }, { t: 0.7, scale: r3(max) }, { t: 1, scale: 1 }] })) };
    }
    case "wiggle": {
      const origin = [r3(b.cx), r3(b.y0 + 0.5)];
      return { duration: 700, easing: "ease-in-out", iterations: 1, parts: all(names, () => ({ origin, keyframes: [{ t: 0, rotate: 0 }, { t: 0.2, rotate: 12 }, { t: 0.4, rotate: -10 }, { t: 0.6, rotate: 6 }, { t: 0.8, rotate: -3 }, { t: 1, rotate: 0 }] })) };
    }
    case "bounce": {
      const h = r3(Math.max(0.5, Math.min(2.5, room.up)));
      return { duration: 600, easing: "ease-in-out", iterations: 1, parts: all(names, () => ({ keyframes: [{ t: 0, y: 0 }, { t: 0.3, y: -h }, { t: 0.55, y: 0 }, { t: 0.75, y: r3(-h * 0.35) }, { t: 1, y: 0 }] })) };
    }
    case "spin": {
      // Shrink just enough that no corner leaves the canvas at any angle.
      const reach = maxReach(icon, config, names, center);
      const room = Math.min(center[0], center[1], g - center[0], g - center[1]) - 0.25;
      const k = reach > room ? r3(Math.floor((room / reach) * 1000) / 1000) : 1;
      const kf = (rot) => (k < 1 ? { rotate: rot, scale: k } : { rotate: rot });
      return { duration: 1000, easing: "linear", iterations: "infinite", parts: all(names, () => ({ origin: center, keyframes: [{ t: 0, ...kf(0) }, { t: 1, ...kf(360) }] })) };
    }
    case "pulse": {
      const max = Math.min(1.12, (g - 0.5) / Math.max(b.w, b.h));
      return { duration: 1200, easing: "ease-in-out", iterations: "infinite", parts: all(names, () => ({ origin: center, keyframes: [{ t: 0, scale: 1 }, { t: 0.5, scale: r3(max) }, { t: 1, scale: 1 }] })) };
    }
    case "nudge": {
      // direction: up, down, left, right, or a diagonal like "up-right".
      const dir = opts.direction || ["up-right", "up-left", "down-right", "down-left", "right", "left", "up", "down"].find((d) => icon.name.includes(d)) || "right";
      const dx = dir.includes("right") ? 1 : dir.includes("left") ? -1 : 0;
      const dy = dir.includes("down") ? 1 : dir.includes("up") ? -1 : 0;
      const lim = Math.min(2.5, ...(dx ? [room[dx > 0 ? "right" : "left"]] : []), ...(dy ? [room[dy > 0 ? "down" : "up"]] : []));
      const amt = r3(Math.max(0.5, dx && dy ? lim * 0.8 : lim));
      const at = (k) => ({ ...(dx ? { x: r3(dx * amt * k) } : {}), ...(dy ? { y: r3(dy * amt * k) } : {}) });
      return { duration: 500, easing: "ease-in-out", iterations: 1, parts: all(names, () => ({ keyframes: [{ t: 0, ...at(0) }, { t: 0.45, ...at(1) }, { t: 1, ...at(0) }] })) };
    }
    case "fade":
      return { duration: 300, easing: "ease-out", iterations: 1, parts: all(names, (n, i) => ({ delay: i * 100, keyframes: [{ t: 0, opacity: 0 }, { t: 1, opacity: 1 }] })) };
    default:
      throw new Error(`Unknown preset "${preset}". Use one of: ${Object.keys(PRESETS).join(", ")}`);
  }
}
