// Converts an icon animation into a Lottie (Bodymovin) JSON animation.
// Each part becomes a shape layer whose transform carries the part's keyframes; "draw" becomes trim paths.
// Lottie needs a real colour (no currentColor); players such as lottie-web, lottie-ios, lottie-android
// and dotLottie can recolour at runtime.
import { parse, arcToCubics, dist } from "./path.js";
import { variantParts } from "./variants.js";
import { easingFn, totalDuration } from "./animate.js";

const EASE = { linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1], "ease-in": [0.42, 0, 1, 1], "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1] };
const DEF = { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1, draw: 1 };
const r4 = (n) => Math.round(n * 10000) / 10000;
const staticProp = (k) => ({ a: 0, k });

function bezierOf(e) {
  if (EASE[e]) return EASE[e];
  const m = String(e || "").match(/cubic-bezier\(([^)]+)\)/);
  const v = m ? m[1].split(",").map(Number) : null;
  return v && v.length === 4 && v.every((n) => !isNaN(n)) ? v : EASE["ease-in-out"];
}

export function hexToRgb(hex) {
  const m = String(hex).replace("#", "").match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return [0, 0, 0];
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

// Path data → Lottie shape items (one "sh" per subpath).
function shapesOf(d) {
  return parse(d).map((sp) => {
    const v = [sp.start], ins = [[0, 0]], outs = [];
    let p = sp.start;
    const push = (c1, c2, to) => {
      outs.push([c1[0] - p[0], c1[1] - p[1]]);
      v.push(to);
      ins.push([c2[0] - to[0], c2[1] - to[1]]);
      p = to;
    };
    for (const g of sp.segs) {
      if (g.t === "L") push(p, g.to, g.to);
      else if (g.t === "C") push(g.c1, g.c2, g.to);
      else if (g.t === "Q") push([p[0] + (2 / 3) * (g.c[0] - p[0]), p[1] + (2 / 3) * (g.c[1] - p[1])], [g.to[0] + (2 / 3) * (g.c[0] - g.to[0]), g.to[1] + (2 / 3) * (g.c[1] - g.to[1])], g.to);
      else if (g.t === "A") for (const [c1, c2, to] of arcToCubics(p, g)) push(c1, c2, to);
    }
    outs.push([0, 0]);
    // A closed path that ends on its start: merge the last vertex into the first.
    if (sp.closed && v.length > 1 && dist(v[v.length - 1], v[0]) < 1e-3) {
      ins[0] = ins[ins.length - 1];
      v.pop(); ins.pop(); outs.pop();
    }
    const fx = (a) => a.map(([x, y]) => [r4(x), r4(y)]);
    return { ty: "sh", ks: staticProp({ i: fx(ins), o: fx(outs), v: fx(v), c: !!sp.closed }) };
  });
}

const tr = () => ({ ty: "tr", p: staticProp([0, 0]), a: staticProp([0, 0]), s: staticProp([100, 100]), r: staticProp(0), o: staticProp(100), sk: staticProp(0), sa: staticProp(0) });

// Keyframe track for one property: [{frame, value}] following CSS semantics (missing 0%/100% use the default).
function track(anim, part, prop, fps) {
  const ks = [...(part.keyframes || [])].filter((k) => k[prop] !== undefined).sort((a, b) => a.t - b.t);
  if (!ks.length) return null;
  const list = [...(ks[0].t > 0 ? [{ t: 0, [prop]: DEF[prop] }] : []), ...ks, ...(ks[ks.length - 1].t < 1 ? [{ t: 1, [prop]: DEF[prop] }] : [])];
  const dur = part.duration ?? anim.duration ?? 600, delay = part.delay || 0;
  const iters = anim.iterations === "infinite" ? 1 : Math.max(1, Math.floor(anim.iterations ?? 1));
  const out = [];
  for (let n = 0; n < iters; n++)
    for (const k of list) {
      const frame = ((delay + (n + k.t) * dur) / 1000) * fps;
      if (out.length && Math.abs(out[out.length - 1].frame - frame) < 1e-6) out[out.length - 1].value = k[prop];
      else out.push({ frame, value: k[prop] });
    }
  return out;
}
function animated(trk, map, ease) {
  const [x1, y1, x2, y2] = ease;
  return {
    a: 1,
    k: trk.map((k, i) => {
      const o = { t: r4(k.frame), s: map(k.value) };
      if (i < trk.length - 1) { o.o = { x: [x1], y: [y1] }; o.i = { x: [x2], y: [y2] }; }
      return o;
    }),
  };
}

export function toLottie(icon, config, variant, animName, { size = 96, fps = 60, color = "#000000" } = {}) {
  const anim = icon.animations?.[animName];
  if (!anim) throw new Error(`${icon.name} has no animation "${animName}"`);
  const g = config.grid;
  const rgb = [...hexToRgb(color), 1];
  const ease = bezierOf(anim.easing);
  const op = Math.max(1, Math.ceil((totalDuration(anim) * (anim.iterations === "infinite" ? 1 : Math.max(1, anim.iterations ?? 1))) / 1000 * fps));
  const parts = variantParts(icon, config, variant);
  const ROOT = 1;
  const layers = [{ ddd: 0, ind: ROOT, ty: 3, nm: "icon", sr: 1, ks: { o: staticProp(0), r: staticProp(0), p: staticProp([0, 0, 0]), a: staticProp([0, 0, 0]), s: staticProp([(size / g) * 100, (size / g) * 100, 100]) }, ao: 0, ip: 0, op, st: 0, bm: 0 }];
  // Lottie draws the first layer on top; SVG draws the last part on top.
  [...parts].reverse().forEach((part, i) => {
    const a = anim.parts?.[part.name];
    const [ox, oy] = a?.origin || [g / 2, g / 2];
    const base = part.opacity ?? 1;
    const t = (prop) => (a ? track(anim, a, prop, fps) : null);
    const tx = t("x"), ty = t("y"), rot = t("rotate"), sc = t("scale"), opa = t("opacity"), draw = t("draw");
    let p;
    if (tx || ty) {
      const frames = [...new Set([...(tx || []), ...(ty || [])].map((k) => k.frame))].sort((m, n) => m - n);
      const valAt = (trk, f) => {
        if (!trk) return 0;
        if (f <= trk[0].frame) return trk[0].value;
        for (let j = 0; j < trk.length - 1; j++) if (f <= trk[j + 1].frame) {
          const u = (f - trk[j].frame) / (trk[j + 1].frame - trk[j].frame || 1);
          return trk[j].value + (trk[j + 1].value - trk[j].value) * easingFn(anim.easing)(u);
        }
        return trk[trk.length - 1].value;
      };
      p = animated(frames.map((f) => ({ frame: f, value: [valAt(tx, f), valAt(ty, f)] })), ([x, y]) => [r4(ox + x), r4(oy + y), 0], ease);
    } else p = staticProp([ox, oy, 0]);
    const ks = {
      o: opa ? animated(opa, (v) => [r4(v * base * 100)], ease) : staticProp(base * 100),
      r: rot ? animated(rot, (v) => [r4(v)], ease) : staticProp(0),
      p,
      a: staticProp([ox, oy, 0]),
      s: sc ? animated(sc, (v) => [r4(v * 100), r4(v * 100), 100], ease) : staticProp([100, 100, 100]),
    };
    const shapes = [];
    for (const path of part.paths) {
      const geo = shapesOf(path.d);
      // Separate groups for stroke and fill so trimming ("draw") only affects the stroke, like the SVG version.
      if (path.stroke) {
        const items = [...geo];
        if (draw) items.push({ ty: "tm", s: staticProp(0), e: animated(draw, (v) => [r4(v * 100)], ease), o: staticProp(0), m: 1 });
        items.push({ ty: "st", c: staticProp(rgb), o: staticProp(100), w: staticProp(path.strokeWidth), lc: path.cap === "square" ? 3 : path.cap === "round" ? 2 : 1, lj: path.join === "miter" ? 1 : 2, ml: 4 });
        items.push(tr());
        shapes.push({ ty: "gr", nm: "stroke", it: items });
      }
      if (path.fill) shapes.push({ ty: "gr", nm: "fill", it: [...geo, { ty: "fl", c: staticProp(rgb), o: staticProp(100), r: path.fillRule === "evenodd" ? 2 : 1 }, tr()] });
    }
    // Within a group Lottie also draws the first item on top: put strokes above fills.
    shapes.sort((m, n) => (m.nm === "stroke" ? 0 : 1) - (n.nm === "stroke" ? 0 : 1));
    layers.push({ ddd: 0, ind: ROOT + 1 + i, ty: 4, nm: part.name, parent: ROOT, sr: 1, ks, ao: 0, shapes, ip: 0, op, st: 0, bm: 0 });
  });
  return { v: "5.7.4", fr: fps, ip: 0, op, w: size, h: size, nm: `${icon.name}-${animName}`, ddd: 0, assets: [], layers, markers: [] };
}
