// Operations that apply to one icon at a time; the studio and `npm run batch` run them over many.
// Every operation returns a new icon object and leaves the input untouched.
import { transformD, inkBounds } from "./path.js";
import { variantParts } from "./variants.js";
import { presetAnimation } from "./animate.js";

const clone = (o) => JSON.parse(JSON.stringify(o));
const snap = (n, step = 0.25) => Math.round(n / step) * step;
const eachPath = (icon, fn) => { for (const parts of Object.values(icon.styles)) for (const part of parts) for (const p of part.paths) fn(p, part); };

function bounds(icon, config, style = "outline") {
  return inkBounds(variantParts(icon, config, { style, corner: "round", weight: "regular" }).flatMap((p) => p.paths));
}

function transformIcon(icon, t) {
  const out = clone(icon);
  eachPath(out, (p) => { p.d = transformD(p.d, t); });
  // Keep animations attached to the same spots.
  const s = t.s ?? 1, c = t.center || [12, 12];
  for (const anim of Object.values(out.animations || {}))
    for (const a of Object.values(anim.parts || {})) {
      if (a.origin) a.origin = [(a.origin[0] - c[0]) * s + c[0] + (t.dx || 0), (a.origin[1] - c[1]) * s + c[1] + (t.dy || 0)].map((n) => Math.round(n * 1000) / 1000);
      for (const k of a.keyframes || []) { if (k.x !== undefined) k.x *= s; if (k.y !== undefined) k.y *= s; }
    }
  return out;
}

export const OPS = {
  move: {
    label: "Move", args: { x: 0, y: 0 },
    run: (icon, config, { x = 0, y = 0 }) => transformIcon(icon, { dx: +x, dy: +y }),
  },
  scale: {
    label: "Scale (around centre)", args: { by: 1 },
    run: (icon, config, { by = 1 }) => transformIcon(icon, { s: +by }),
  },
  recenter: {
    label: "Re-centre on the canvas", args: {},
    run: (icon, config) => {
      const b = bounds(icon, config);
      if (!b) return icon;
      return transformIcon(icon, { dx: snap(config.grid / 2 - b.cx), dy: snap(config.grid / 2 - b.cy) });
    },
  },
  fit: {
    label: "Fit inside the padding", args: {},
    run: (icon, config) => {
      const g = config.grid, target = g - 2 * config.padding;
      let out = OPS.recenter.run(icon, config);
      for (let i = 0; i < 3; i++) {
        let s = 1;
        for (const style of config.styles) {
          const b = bounds(out, config, style);
          if (!b) continue;
          // Strokes keep their width, so only the geometry shrinks.
          const sw = Math.max(0, ...variantParts(out, config, { style }).flatMap((p) => p.paths).map((p) => (p.stroke ? p.strokeWidth : 0)));
          const need = Math.max(b.w, b.h);
          if (need > target + 0.01) s = Math.min(s, (target - sw) / (need - sw));
        }
        if (s >= 0.999) break;
        out = transformIcon(out, { s: Math.floor(s * 1000) / 1000 });
        const b = bounds(out, config);
        out = transformIcon(out, { dx: g / 2 - b.cx, dy: g / 2 - b.cy });
      }
      return out;
    },
  },
  radius: {
    label: "Corner rounding multiplier", args: { set: 1 },
    run: (icon, config, { set = 1 }) => {
      const out = clone(icon);
      eachPath(out, (p) => { if (+set === 1) delete p.radius; else p.radius = +set; });
      return out;
    },
  },
  tag: {
    label: "Add / remove tags", args: { add: "", remove: "" },
    run: (icon, config, { add = "", remove = "" }) => {
      const out = clone(icon);
      const list = (s) => String(s).split(",").map((t) => t.trim()).filter(Boolean);
      const tags = new Set(out.tags || []);
      list(add).forEach((t) => tags.add(t));
      list(remove).forEach((t) => tags.delete(t));
      out.tags = [...tags];
      return out;
    },
  },
  ignore: {
    label: "Mark a check as intentional", args: { rule: "", reason: "" },
    run: (icon, config, { rule, reason }) => {
      if (!rule || !reason) throw new Error("ignore needs a rule and a reason");
      return { ...clone(icon), lintIgnore: { ...(icon.lintIgnore || {}), [rule]: reason } };
    },
  },
  animate: {
    label: "Add animation preset", args: { preset: "draw", name: "", parts: "", direction: "" },
    run: (icon, config, { preset = "draw", name = "", parts = "", direction = "" }) => {
      const out = clone(icon);
      const list = String(parts).split(",").map((s) => s.trim()).filter(Boolean);
      const known = (out.styles.outline || []).map((p) => p.name);
      const missing = list.filter((p) => !known.includes(p));
      if (missing.length) throw new Error(`${icon.name} has no part ${missing.join(", ")} (parts: ${known.join(", ")})`);
      // "auto" picks a different motion per icon but keeps one shared name, so animate="default" works on every icon.
      const key = name || (preset === "auto" ? "default" : preset);
      out.animations = { ...(out.animations || {}), [key]: presetAnimation(out, config, preset, { parts: list, direction: direction || undefined }) };
      return out;
    },
  },
  unanimate: {
    label: "Remove an animation", args: { name: "" },
    run: (icon, config, { name }) => {
      const out = clone(icon);
      if (out.animations) { delete out.animations[name]; if (!Object.keys(out.animations).length) delete out.animations; }
      return out;
    },
  },
};

export function runOp(op, icon, config, args = {}) {
  if (!OPS[op]) throw new Error(`Unknown operation "${op}". Use: ${Object.keys(OPS).join(", ")}`);
  return OPS[op].run(icon, config, args);
}
