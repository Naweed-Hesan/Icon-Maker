// Path geometry shared by the build scripts (Node) and the studio (browser).
// Paths are parsed into absolute subpaths:
//   { start: [x, y], segs: [{ t: "L", to }, { t: "A", rx, ry, rot, large, sweep, to }, { t: "C", c1, c2, to }, { t: "Q", c, to }], closed }
// Every segment end is a "node". Node 0 is the subpath start; nodes are numbered across subpaths in order.

const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const EPS = 1e-6;

export const round = (n, p = 3) => {
  const v = Math.round(n * 10 ** p) / 10 ** p;
  return Object.is(v, -0) ? 0 : v;
};
const fmt = (n) => String(round(n));
const pt = (p) => `${fmt(p[0])} ${fmt(p[1])}`;
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const same = (a, b, e = 1e-3) => dist(a, b) < e;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const norm = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

export function parse(d) {
  const tokens = String(d || "").match(TOKEN) || [];
  const subpaths = [];
  let i = 0, cmd = null, cur = [0, 0], sp = null, lastCtrl = null, lastCmd = null;
  const num = () => {
    if (i >= tokens.length || /[a-z]/i.test(tokens[i])) throw new Error(`Bad path data near token ${i}`);
    return parseFloat(tokens[i++]);
  };
  const flag = () => {
    // Arc flags may be packed ("0 01 5 5"), so read a single digit when needed.
    const t = tokens[i];
    if (t === undefined) throw new Error("Bad arc flag");
    if (t.length > 1 && (t[0] === "0" || t[0] === "1") && !t.includes(".")) { tokens[i] = t.slice(1); return +t[0]; }
    i++;
    return +t;
  };
  const ensure = () => { if (!sp) { sp = { start: [...cur], segs: [], closed: false }; subpaths.push(sp); } };
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) throw new Error("Path must start with a command");
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const o = rel ? cur : [0, 0];
    if (C === "Z") {
      if (sp) { sp.closed = true; cur = [...sp.start]; sp = null; }
      lastCtrl = null; lastCmd = "Z";
      continue;
    }
    if (C === "M") {
      cur = [num() + o[0], num() + o[1]];
      sp = { start: [...cur], segs: [], closed: false };
      subpaths.push(sp);
      cmd = rel ? "l" : "L";
      lastCtrl = null; lastCmd = "M";
      continue;
    }
    ensure();
    let seg;
    if (C === "L") seg = { t: "L", to: [num() + o[0], num() + o[1]] };
    else if (C === "H") seg = { t: "L", to: [num() + (rel ? cur[0] : 0), cur[1]] };
    else if (C === "V") seg = { t: "L", to: [cur[0], num() + (rel ? cur[1] : 0)] };
    else if (C === "C") seg = { t: "C", c1: [num() + o[0], num() + o[1]], c2: [num() + o[0], num() + o[1]], to: [num() + o[0], num() + o[1]] };
    else if (C === "S") {
      const c1 = lastCmd === "C" && lastCtrl ? sub(mul(cur, 2), lastCtrl) : [...cur];
      seg = { t: "C", c1, c2: [num() + o[0], num() + o[1]], to: [num() + o[0], num() + o[1]] };
    } else if (C === "Q") seg = { t: "Q", c: [num() + o[0], num() + o[1]], to: [num() + o[0], num() + o[1]] };
    else if (C === "T") {
      const c = lastCmd === "Q" && lastCtrl ? sub(mul(cur, 2), lastCtrl) : [...cur];
      seg = { t: "Q", c, to: [num() + o[0], num() + o[1]] };
    } else if (C === "A") {
      const rx = Math.abs(num()), ry = Math.abs(num()), rot = num(), large = flag(), sweep = flag();
      seg = { t: "A", rx, ry, rot, large, sweep, to: [num() + o[0], num() + o[1]] };
    } else throw new Error(`Unsupported command ${cmd}`);
    sp.segs.push(seg);
    lastCtrl = seg.t === "C" ? seg.c2 : seg.t === "Q" ? seg.c : null;
    lastCmd = seg.t;
    cur = [...seg.to];
  }
  return subpaths;
}

export function serialize(subpaths) {
  return subpaths
    .map((s) => {
      let out = `M${pt(s.start)}`;
      for (const g of s.segs) {
        if (g.t === "L") out += `L${pt(g.to)}`;
        else if (g.t === "C") out += `C${pt(g.c1)} ${pt(g.c2)} ${pt(g.to)}`;
        else if (g.t === "Q") out += `Q${pt(g.c)} ${pt(g.to)}`;
        else if (g.t === "A") out += `A${fmt(g.rx)} ${fmt(g.ry)} ${fmt(g.rot)} ${g.large ? 1 : 0} ${g.sweep ? 1 : 0} ${pt(g.to)}`;
      }
      return out + (s.closed ? "Z" : "");
    })
    .join(" ");
}

export const normalize = (d) => serialize(parse(d));

// All node positions in order (start of each subpath, then each segment end).
export function nodes(subpaths) {
  const out = [];
  for (const s of subpaths) { out.push(s.start); for (const g of s.segs) out.push(g.to); }
  return out;
}

// ---------- Sampling, bounds ----------

function arcCenter(p0, g) {
  let { rx, ry } = g;
  const p1 = g.to;
  if (rx < EPS || ry < EPS || same(p0, p1, EPS)) return null;
  const phi = (g.rot * Math.PI) / 180, c = Math.cos(phi), s = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = c * dx + s * dy, y1 = -s * dx + c * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = Math.sqrt(Math.max(0, num / den)) * (g.large === g.sweep ? -1 : 1);
  const cx1 = (co * rx * y1) / ry, cy1 = (-co * ry * x1) / rx;
  const cx = c * cx1 - s * cy1 + (p0[0] + p1[0]) / 2, cy = s * cx1 + c * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!g.sweep && dt > 0) dt -= 2 * Math.PI;
  if (g.sweep && dt < 0) dt += 2 * Math.PI;
  return { cx, cy, rx, ry, c, s, t1, dt };
}

export function sampleSeg(p0, g, step = 0.25) {
  if (g.t === "L") {
    const n = Math.max(1, Math.ceil(dist(p0, g.to) / step));
    return Array.from({ length: n + 1 }, (_, k) => [p0[0] + ((g.to[0] - p0[0]) * k) / n, p0[1] + ((g.to[1] - p0[1]) * k) / n]);
  }
  if (g.t === "A") {
    const a = arcCenter(p0, g);
    if (!a) return [p0, g.to];
    const n = Math.max(4, Math.ceil((Math.abs(a.dt) * Math.max(a.rx, a.ry)) / step));
    return Array.from({ length: n + 1 }, (_, k) => {
      const t = a.t1 + (a.dt * k) / n;
      return [a.cx + a.rx * Math.cos(t) * a.c - a.ry * Math.sin(t) * a.s, a.cy + a.rx * Math.cos(t) * a.s + a.ry * Math.sin(t) * a.c];
    });
  }
  const ctrl = g.t === "C" ? [p0, g.c1, g.c2, g.to] : [p0, g.c, g.to];
  let len = 0;
  for (let k = 1; k < ctrl.length; k++) len += dist(ctrl[k - 1], ctrl[k]);
  const n = Math.max(4, Math.ceil(len / step));
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n, u = 1 - t;
    if (g.t === "Q") return [u * u * p0[0] + 2 * u * t * g.c[0] + t * t * g.to[0], u * u * p0[1] + 2 * u * t * g.c[1] + t * t * g.to[1]];
    return [
      u ** 3 * p0[0] + 3 * u * u * t * g.c1[0] + 3 * u * t * t * g.c2[0] + t ** 3 * g.to[0],
      u ** 3 * p0[1] + 3 * u * u * t * g.c1[1] + 3 * u * t * t * g.c2[1] + t ** 3 * g.to[1],
    ];
  });
}

export function sample(subpaths, step = 0.25) {
  const out = [];
  for (const s of subpaths) {
    let p = s.start;
    out.push(p);
    for (const g of s.segs) { out.push(...sampleSeg(p, g, step).slice(1)); p = g.to; }
    if (s.closed && !same(p, s.start)) out.push(...sampleSeg(p, { t: "L", to: s.start }, step).slice(1));
  }
  return out;
}

// Ink bounds: geometry bounds grown by half the stroke (caps/joins approximated as round).
export function inkBounds(paths) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of paths) {
    const h = p.stroke ? (p.strokeWidth || 0) / 2 : 0;
    for (const [x, y] of sample(parse(p.d), 0.2)) {
      x0 = Math.min(x0, x - h); y0 = Math.min(y0, y - h); x1 = Math.max(x1, x + h); y1 = Math.max(y1, y + h);
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

// Max distance between two shapes (symmetric, sampled). Used to compare a generated variant with a reference.
export function deviation(dA, dB) {
  const a = sample(parse(dA), 0.15), b = sample(parse(dB), 0.15);
  const one = (P, Q) => Math.max(0, ...P.map((p) => Math.min(...Q.map((q) => dist(p, q)))));
  return Math.max(one(a, b), one(b, a));
}

// ---------- Corner rounding ----------

// Remove zero-length segments and an explicit line back to the start of a closed subpath.
export function clean(subpaths) {
  return subpaths.map((s) => {
    const segs = [];
    let p = s.start;
    for (const g of s.segs) {
      if (g.t === "L" && same(p, g.to)) continue;
      if (g.t === "A" && same(p, g.to)) continue;
      segs.push(g);
      p = g.to;
    }
    if (s.closed && segs.length > 1) {
      const last = segs[segs.length - 1];
      if (last.t === "L" && same(last.to, s.start)) segs.pop();
    }
    return { ...s, segs };
  });
}

// Corners that can be rounded: node indices whose two neighbouring segments are straight lines.
// Returns [{ node, at, prev, next, turn }] where turn is the change of direction in degrees.
export function corners(subpaths) {
  const out = [];
  let base = 0;
  for (const s of clean(subpaths)) {
    const pts = [s.start, ...s.segs.map((g) => g.to)];
    const segs = s.closed && !same(pts[pts.length - 1], s.start) ? [...s.segs, { t: "L", to: s.start, implicit: true }] : s.segs;
    const count = segs.length;
    const startOf = (k) => (k === 0 ? s.start : segs[k - 1].to);
    for (let k = 0; k < count; k++) {
      const isLast = k === count - 1;
      if (isLast && !s.closed) break;
      const a = segs[k], b = segs[(k + 1) % count];
      if (a.t !== "L" || b.t !== "L") continue;
      const v = a.to, din = norm(sub(v, startOf(k))), dout = norm(sub(b.to, v));
      const turn = (Math.acos(Math.max(-1, Math.min(1, dot(din, dout)))) * 180) / Math.PI;
      const node = isLast ? base : base + k + 1;
      out.push({ node, at: v, seg: k, turn, cw: cross(din, dout) > 0 });
    }
    base += s.segs.length + 1;
  }
  return out;
}

// Round every line–line corner. radiusFor(node, turn) returns the wanted radius (0 keeps it sharp).
// Radii shrink automatically so neighbouring roundings never overlap.
export function roundCorners(d, radiusFor, minTurn = 12) {
  const subpaths = clean(parse(d));
  let base = 0;
  const result = subpaths.map((s) => {
    const pts = [s.start, ...s.segs.map((g) => g.to)];
    const closedImplicit = s.closed && !same(pts[pts.length - 1], s.start);
    const segs = closedImplicit ? [...s.segs, { t: "L", to: s.start }] : [...s.segs];
    const n = segs.length;
    const startOf = (k) => (k === 0 ? s.start : segs[k - 1].to);
    // Corner k sits at the end of segment k.
    const cs = new Array(n).fill(null);
    for (let k = 0; k < n; k++) {
      if (k === n - 1 && !s.closed) break;
      const a = segs[k], b = segs[(k + 1) % n];
      if (a.t !== "L" || b.t !== "L") continue;
      const v = a.to, din = norm(sub(v, startOf(k))), dout = norm(sub(b.to, v));
      const turnRad = Math.acos(Math.max(-1, Math.min(1, dot(din, dout))));
      const turn = (turnRad * 180) / Math.PI;
      if (turn < minTurn || turn > 179) continue;
      const node = k === n - 1 ? base : base + k + 1;
      const r = radiusFor(node, turn);
      if (!(r > 0)) continue;
      const half = Math.tan((Math.PI - turnRad) / 2); // tan of half the inside angle
      cs[k] = { v, din, dout, half, want: r / half };
    }
    // Clamp tangent lengths so two roundings on one segment never overlap.
    const segLen = (k) => dist(startOf(k), segs[k].to);
    for (let k = 0; k < n; k++) {
      const c = cs[k];
      if (!c) continue;
      const kNext = (k + 1) % n;
      const prevShared = cs[(k - 1 + n) % n] && (s.closed || k > 0);
      const nextShared = cs[kNext] && (s.closed || kNext < n - 1);
      const availIn = segLen(k) * (prevShared ? 0.5 : 1);
      const availOut = segLen(kNext) * (nextShared ? 0.5 : 1);
      c.t = Math.min(c.want, availIn, availOut);
      c.r = c.t * c.half;
    }
    const out = { start: s.start, segs: [], closed: s.closed };
    const last = cs[n - 1];
    if (s.closed && last) out.start = add(last.v, mul(last.dout, last.t));
    for (let k = 0; k < n; k++) {
      const c = cs[k], g = segs[k];
      if (c) {
        out.segs.push({ t: "L", to: add(c.v, mul(c.din, -c.t)) });
        if (k === n - 1) out.segs.push({ t: "A", rx: c.r, ry: c.r, rot: 0, large: 0, sweep: cross(c.din, c.dout) > 0 ? 1 : 0, to: out.start });
        else out.segs.push({ t: "A", rx: c.r, ry: c.r, rot: 0, large: 0, sweep: cross(c.din, c.dout) > 0 ? 1 : 0, to: add(c.v, mul(c.dout, c.t)) });
      } else if (!(k === n - 1 && closedImplicit)) {
        out.segs.push(g);
      }
    }
    base += s.segs.length + 1;
    return out;
  });
  return serialize(clean(result));
}

// ---------- Curve repair ----------

// Runs of short, gently turning line segments: a curve that was exported as a polyline.
export function flattenedRuns(subpaths, { maxLen = 1.6, maxTurn = 30, minSegs = 6 } = {}) {
  const runs = [];
  subpaths.forEach((s, si) => {
    let p = s.start, run = [], prevDir = null, sign = 0;
    const flush = () => { if (run.length >= minSegs) runs.push({ subpath: si, from: run[0], to: run[run.length - 1] + 1 }); run = []; sign = 0; };
    s.segs.forEach((g, k) => {
      if (g.t !== "L" || dist(p, g.to) > maxLen) { flush(); prevDir = null; p = g.to; return; }
      const dir = norm(sub(g.to, p));
      if (prevDir) {
        const turn = (Math.acos(Math.max(-1, Math.min(1, dot(prevDir, dir)))) * 180) / Math.PI;
        const sg = Math.sign(cross(prevDir, dir));
        if (turn > maxTurn || (sign && sg && sg !== sign && turn > 2)) { flush(); }
        if (sg) sign = sign || sg;
      }
      run.push(k);
      prevDir = dir;
      p = g.to;
    });
    flush();
  });
  return runs;
}

function circle3(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const s = (p) => p[0] * p[0] + p[1] * p[1];
  const cx = (s(a) * (b[1] - c[1]) + s(b) * (c[1] - a[1]) + s(c) * (a[1] - b[1])) / d;
  const cy = (s(a) * (c[0] - b[0]) + s(b) * (a[0] - c[0]) + s(c) * (b[0] - a[0])) / d;
  return { c: [cx, cy], r: dist([cx, cy], a) };
}

function arcThrough(points, tol) {
  const a = points[0], m = points[Math.floor(points.length / 2)], b = points[points.length - 1];
  const circ = circle3(a, m, b);
  if (!circ || circ.r > 60) return null;
  if (Math.max(...points.map((p) => Math.abs(dist(p, circ.c) - circ.r))) > tol) return null;
  const sweep = cross(sub(m, a), sub(b, m)) > 0 ? 1 : 0;
  const ang = (p) => Math.atan2(p[1] - circ.c[1], p[0] - circ.c[0]);
  let span = ang(b) - ang(a);
  if (sweep && span < 0) span += 2 * Math.PI;
  if (!sweep && span > 0) span -= 2 * Math.PI;
  return { t: "A", rx: circ.r, ry: circ.r, rot: 0, large: Math.abs(span) > Math.PI ? 1 : 0, sweep, to: b };
}

// Replace polyline runs with as few circular arcs as fit within `tol` px.
export function refitCurves(d, tol = 0.06) {
  const subpaths = parse(d);
  const runs = flattenedRuns(subpaths);
  if (!runs.length) return d;
  for (const run of [...runs].reverse()) {
    const s = subpaths[run.subpath];
    const startPt = run.from === 0 ? s.start : s.segs[run.from - 1].to;
    const pts = [startPt, ...s.segs.slice(run.from, run.to).map((g) => g.to)];
    const out = [];
    let i = 0;
    while (i < pts.length - 1) {
      let best = null, bestJ = i + 1;
      for (let j = i + 2; j < pts.length; j++) {
        const arc = arcThrough(pts.slice(i, j + 1), tol);
        if (arc) { best = arc; bestJ = j; }
        else if (j - i > 3) break;
      }
      if (best) { out.push(best); i = bestJ; }
      else { out.push({ t: "L", to: pts[i + 1] }); i++; }
    }
    s.segs.splice(run.from, run.to - run.from, ...out);
  }
  return serialize(subpaths);
}

// A small arc tangent to straight lines on both sides is a rounded corner baked into the master drawing.
export function bakedFillets(subpaths, maxR = 2.6) {
  const found = [];
  subpaths.forEach((s, si) => {
    s.segs.forEach((g, k) => {
      if (g.t !== "A" || g.rx > maxR || Math.abs(g.rx - g.ry) > 1e-3 || g.large) return;
      const p0a = k > 0 ? s.segs[k - 1].to : s.start;
      // Half circles (capsule ends, rounded tails) are deliberate shapes, not rounded corners.
      if (dist(p0a, g.to) > 2 * g.rx * 0.98) return;
      const prev = k > 0 ? s.segs[k - 1] : null;
      const next = s.segs[k + 1] || (s.closed ? s.segs[0] : null);
      if (!prev || prev.t !== "L" || !next || next.t !== "L") return;
      const p0 = k > 1 ? s.segs[k - 2].to : s.start;
      const a0 = prev.to, a1 = g.to;
      const din = norm(sub(a0, p0)), dout = norm(sub(next.to, a1));
      const arc = arcCenter(a0, g);
      if (!arc) return;
      const rIn = norm(sub(a0, [arc.cx, arc.cy])), rOut = norm(sub(a1, [arc.cx, arc.cy]));
      if (Math.abs(dot(din, rIn)) < 0.03 && Math.abs(dot(dout, rOut)) < 0.03) found.push({ subpath: si, seg: k, r: g.rx });
    });
  });
  return found;
}

// Turn baked fillets back into sharp corners (intersection of the two lines).
export function unbakeFillets(d) {
  const subpaths = parse(d);
  const found = bakedFillets(subpaths);
  for (const f of [...found].reverse()) {
    const s = subpaths[f.subpath];
    const k = f.seg;
    const p0 = k > 1 ? s.segs[k - 2].to : s.start;
    const a0 = s.segs[k - 1].to, a1 = s.segs[k].to;
    const next = s.segs[k + 1] || s.segs[0];
    const d1 = sub(a0, p0), d2 = sub(next.to, a1);
    const den = cross(d1, d2);
    if (Math.abs(den) < 1e-9) continue;
    const t = cross(sub(a1, a0), d2) / den;
    const v = add(a0, mul(d1, t));
    // Replace "line to a0, arc to a1" with "line to the corner"; the following line continues from there.
    s.segs.splice(k - 1, 2, { t: "L", to: v });
  }
  return serialize(clean(subpaths));
}

// Closed subpaths whose start point sits in the middle of the closing edge (a pen.dev export bug):
// the path runs to the real corner, doubles back to the start, then cuts diagonally to the next corner.
export function misplacedStarts(subpaths) {
  const found = [];
  subpaths.forEach((s, si) => {
    if (!s.closed || s.segs.length < 3) return;
    const segs = clean([s])[0].segs;
    const last = segs[segs.length - 1];
    const prevPt = segs.length > 1 ? segs[segs.length - 2].to : s.start;
    if (last.t !== "L") return;
    const a = prevPt, b = last.to, p = s.start;
    const ab = sub(b, a), ap = sub(p, a);
    const len = Math.hypot(ab[0], ab[1]);
    if (len < EPS) return;
    const off = Math.abs(cross(ab, ap)) / len;
    const t = dot(ab, ap) / (len * len);
    if (off < 0.01 && t > 0.001 && t < 0.999) found.push({ subpath: si, at: p, corner: b });
  });
  return found;
}

// Restart such subpaths at the real corner, which removes the spike and the diagonal.
export function fixStarts(d) {
  const subpaths = clean(parse(d));
  for (const f of misplacedStarts(subpaths)) {
    const s = subpaths[f.subpath];
    s.start = s.segs[s.segs.length - 1].to;
    s.segs.pop();
  }
  return serialize(clean(subpaths));
}

// Uniform scale around `center` by `s`, then move by (dx, dy). Arcs keep their shape.
export function transformD(d, { s = 1, dx = 0, dy = 0, center = [12, 12] } = {}) {
  const f = (p) => [(p[0] - center[0]) * s + center[0] + dx, (p[1] - center[1]) * s + center[1] + dy];
  const subs = parse(d).map((sp) => ({
    ...sp,
    start: f(sp.start),
    segs: sp.segs.map((g) => {
      const o = { ...g, to: f(g.to) };
      if (g.c1) o.c1 = f(g.c1);
      if (g.c2) o.c2 = f(g.c2);
      if (g.c) o.c = f(g.c);
      if (g.t === "A") { o.rx = g.rx * s; o.ry = g.ry * s; }
      return o;
    }),
  }));
  return serialize(subs);
}

// Cubic Bézier segments [c1, c2, to] approximating an arc segment that starts at p0.
export function arcToCubics(p0, g) {
  const a = arcCenter(p0, g);
  if (!a) return [[p0, g.to, g.to]];
  const n = Math.max(1, Math.ceil(Math.abs(a.dt) / (Math.PI / 2) - 1e-9));
  const step = a.dt / n, k = (4 / 3) * Math.tan(step / 4);
  const at = (t) => [a.cx + a.rx * Math.cos(t) * a.c - a.ry * Math.sin(t) * a.s, a.cy + a.rx * Math.cos(t) * a.s + a.ry * Math.sin(t) * a.c];
  const dAt = (t) => [-a.rx * Math.sin(t) * a.c - a.ry * Math.cos(t) * a.s, -a.rx * Math.sin(t) * a.s + a.ry * Math.cos(t) * a.c];
  const out = [];
  for (let i = 0; i < n; i++) {
    const t1 = a.t1 + step * i, t2 = t1 + step;
    const P1 = at(t1), P2 = i === n - 1 ? g.to : at(t2), D1 = dAt(t1), D2 = dAt(t2);
    out.push([[P1[0] + k * D1[0], P1[1] + k * D1[1]], [P2[0] - k * D2[0], P2[1] - k * D2[1]], P2]);
  }
  return out;
}
