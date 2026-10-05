// Runs one operation over many icons.
//   npm run batch -- <op> [--arg value …] <names… | --all | --where rule:padding | --where warn>  [--dry]
// Examples:
//   npm run batch -- recenter --where rule:off-center --dry
//   npm run batch -- fit laptop tv banknote
//   npm run batch -- animate --preset draw --name draw --all
//   npm run batch -- animate --preset wiggle --name ring --parts body,clapper bell
//   npm run batch -- tag --add weather cloud cloud-rain cloud-snow
import { OPS, runOp } from "../lib/batch.js";
import { lintAll, lintIcon } from "../lib/lint.js";
import { config as loadConfig, loadIcons, saveIcon } from "./load.mjs";

const [op, ...rest] = process.argv.slice(2);
if (!op || !OPS[op]) {
  console.log("Operations:\n" + Object.entries(OPS).map(([k, o]) => `  ${k.padEnd(10)} ${o.label}${Object.keys(o.args).length ? `  (--${Object.keys(o.args).join(" --")})` : ""}`).join("\n"));
  process.exit(op ? 1 : 0);
}
const args = {}, names = [];
let all = false, dry = false, where = null;
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === "--all") all = true;
  else if (a === "--dry") dry = true;
  else if (a === "--where") where = rest[++i];
  else if (a.startsWith("--")) args[a.slice(2)] = rest[++i];
  else names.push(a);
}
const config = loadConfig();
const icons = loadIcons();
const before = lintAll(icons, config);
const active = (list) => list.filter((i) => !i.ignored);
let targets = icons;
if (where) {
  targets = icons.filter((icon) => {
    const l = active(before[icon.name] || []);
    if (where.startsWith("rule:")) return l.some((i) => i.rule === where.slice(5));
    if (where === "error") return l.some((i) => i.severity === "error");
    if (where === "warn") return l.some((i) => i.severity !== "info");
    throw new Error(`--where takes rule:<id>, error or warn`);
  });
}
if (names.length) {
  const unknown = names.filter((n) => !icons.some((i) => i.name === n));
  if (unknown.length) { console.error(`Unknown icons: ${unknown.join(", ")}`); process.exit(1); }
  targets = targets.filter((i) => names.includes(i.name));
} else if (!all && !where) {
  console.error("Name some icons, or use --all / --where."); process.exit(1);
}

const count = (l) => { const a = active(l); return { e: a.filter((i) => i.severity === "error").length, w: a.filter((i) => i.severity === "warn").length }; };
let changed = 0, failed = 0;
for (const icon of targets) {
  let next;
  try { next = runOp(op, icon, config, args); } catch (e) { console.log(`✗ ${icon.name}: ${e.message}`); failed++; continue; }
  if (JSON.stringify(next) === JSON.stringify(icon)) continue;
  const b = count(before[icon.name] || []), a = count(lintIcon(next, config));
  const fixed = active(before[icon.name] || []).filter((i) => i.severity !== "info" && !active(lintIcon(next, config)).some((j) => j.rule === i.rule)).map((i) => i.rule);
  const added = active(lintIcon(next, config)).filter((i) => i.severity !== "info" && !active(before[icon.name] || []).some((j) => j.rule === i.rule)).map((i) => i.rule);
  console.log(`${dry ? "~" : "✓"} ${icon.name.padEnd(20)} errors ${b.e}→${a.e}  warnings ${b.w}→${a.w}${fixed.length ? `  fixed: ${[...new Set(fixed)].join(", ")}` : ""}${added.length ? `  NEW: ${[...new Set(added)].join(", ")}` : ""}`);
  if (!dry) saveIcon(next);
  changed++;
}
console.log(`\n${changed} icon${changed === 1 ? "" : "s"} ${dry ? "would change" : "changed"}${failed ? `, ${failed} failed` : ""}.`);
