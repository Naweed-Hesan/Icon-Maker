// One-off migration: turns the old pen.dev-generated package JSON (all variants pre-baked)
// into one master file per icon in icons/. Keeps the sharp drawing as the master and works out
// how much each corner was rounded so the generated round set matches the original.
//
//   node scripts/import-legacy.mjs reference/dope-icons-0.1.0.json [--force]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parse, serialize, clean, corners, nodes, dist, deviation, roundCorners, round, fixStarts } from "../lib/path.js";

const ROOT = new URL("..", import.meta.url).pathname;
const src = process.argv.slice(2).find((a) => !a.startsWith("--")) || join(ROOT, "reference", "dope-icons-0.1.0.json");
const force = process.argv.includes("--force");
const config = JSON.parse(readFileSync(join(ROOT, "config.json"), "utf8"));
const legacy = JSON.parse(readFileSync(src, "utf8"));
const OLD_ROUND = legacy.corners ? 2 : 2; // the legacy "round" set used a base radius of 2

const near = (a, b, e = 0.02) => dist(a, b) < e;
const onLine = (p, v, dir) => Math.abs((p[0] - v[0]) * dir[1] - (p[1] - v[1]) * dir[0]) < 0.03;

// Find the arc in the rounded drawing that replaced the corner at `c`.
function arcFor(c, roundSubs, sharpSubs) {
  const s = clean(sharpSubs);
  for (const sp of roundSubs) {
    let p = sp.start;
    for (const g of sp.segs) {
      if (g.t === "A") {
        const din = c.din, dout = c.dout;
        if (onLine(p, c.at, din) && onLine(g.to, c.at, dout) && dist(p, c.at) < 8 && dist(g.to, c.at) < 8) return g.rx;
      }
      p = g.to;
    }
  }
  return null;
}

function withDirs(subs) {
  const list = corners(subs);
  const cl = clean(subs);
  // Attach in/out directions for each corner.
  const all = [];
  let base = 0;
  for (const s of cl) {
    const pts = [s.start, ...s.segs.map((g) => g.to)];
    const segs = s.closed && !near(pts[pts.length - 1], s.start, 1e-3) ? [...s.segs, { t: "L", to: s.start }] : s.segs;
    const startOf = (k) => (k === 0 ? s.start : segs[k - 1].to);
    for (const c of list.filter((c) => c.node >= base && c.node <= base + s.segs.length)) {
      const k = c.seg, n = segs.length;
      const v = segs[k].to, a = startOf(k), b = segs[(k + 1) % n].to;
      const nrm = (x) => { const l = Math.hypot(x[0], x[1]); return [x[0] / l, x[1] / l]; };
      all.push({ ...c, din: nrm([v[0] - a[0], v[1] - a[1]]), dout: nrm([b[0] - v[0], b[1] - v[1]]) });
    }
    base += s.segs.length + 1;
  }
  return all;
}

const report = [];
mkdirSync(join(ROOT, "icons"), { recursive: true });
let written = 0;
for (const name of Object.keys(legacy.icons).sort()) {
  const file = join(ROOT, "icons", `${name}.json`);
  if (existsSync(file) && !force) continue;
  const old = legacy.icons[name];
  const styles = {};
  for (const style of config.styles) {
    styles[style] = old[style].sharp.map((part, pi) => ({
      name: part.name,
      ...(part.opacity !== undefined && part.opacity < 1 ? { opacity: part.opacity } : {}),
      paths: part.paths.map((p, ji) => {
        // fixStarts repairs the export bug where a closed shape starts mid-edge (spike + diagonal in the sharp set).
        const sharpSubs = clean(parse(fixStarts(p.d)));
        const d = serialize(sharpSubs);
        const roundD = old[style].round[pi].paths[ji].d;
        const roundSubs = parse(roundD);
        const cs = withDirs(sharpSubs).filter((c) => c.turn >= 12 && c.turn <= 179);
        const radii = {};
        const sharpNodes = [];
        const roundNodes = nodes(roundSubs);
        for (const c of cs) {
          const r = arcFor(c, roundSubs, sharpSubs);
          if (r) radii[c.node] = r;
          else if (roundNodes.some((q) => near(q, c.at))) sharpNodes.push(c.node);
        }
        const rs = Object.values(radii);
        let scale = rs.length ? Math.max(...rs) / OLD_ROUND : 1;
        scale = round(scale, 3);
        const out = { d };
        if (p.stroke) out.stroke = true;
        if (p.fill) out.fill = true;
        if (p.fill && p.fillRule) out.fillRule = p.fillRule;
        if (p.stroke && p.strokeWidth !== config.baseStroke) out.strokeWidth = p.strokeWidth;
        if (rs.length && scale !== 1) out.radius = scale;
        if (sharpNodes.length) out.sharpNodes = sharpNodes;
        // Per-corner overrides only where the automatic clamping does not already give the original radius.
        const base = OLD_ROUND * scale;
        const gen = (nodeRadius) =>
          roundCorners(d, (node) => (sharpNodes.includes(node) ? 0 : base * (nodeRadius[node] ?? 1)));
        const nodeRadius = {};
        let generated = gen(nodeRadius);
        const genSubs = parse(generated);
        for (const c of cs) {
          if (!(c.node in radii)) continue;
          const mine = arcFor(c, genSubs, sharpSubs);
          if (mine === null || Math.abs(mine - radii[c.node]) > 0.04) nodeRadius[c.node] = round(radii[c.node] / base, 3);
        }
        if (Object.keys(nodeRadius).length) { out.nodeRadius = nodeRadius; generated = gen(nodeRadius); }
        const dev = deviation(generated, roundD);
        if (dev > 0.08) report.push({ name, style, part: part.name, dev: round(dev, 3) });
        return out;
      }),
    }));
  }
  const icon = { name, tags: [], styles };
  writeFileSync(file, JSON.stringify(icon, null, 2) + "\n");
  written++;
}
console.log(`Wrote ${written} master files.`);
if (report.length) {
  console.log(`\n${report.length} paths where the generated round set differs from the original by more than 0.08px:`);
  for (const r of report.sort((a, b) => b.dev - a.dev)) console.log(`  ${r.name} / ${r.style} / ${r.part}: ${r.dev}px`);
}
