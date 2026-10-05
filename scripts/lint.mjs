// Checks every master icon. Exit code 1 when there are unignored errors.
//   npm run lint                 summary + every issue
//   npm run lint -- home bell    only these icons
//   npm run lint -- --rule padding
//   npm run lint -- --json       machine-readable output
import { lintAll, RULES } from "../lib/lint.js";
import { config, loadIcons } from "./load.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const showInfo = args.includes("--all");
const ruleArg = args.includes("--rule") ? args[args.indexOf("--rule") + 1] : null;
const only = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--rule");

const icons = loadIcons();
const results = lintAll(icons, config());
const rows = [];
for (const [name, issues] of Object.entries(results)) {
  if (only.length && !only.includes(name)) continue;
  for (const i of issues) if (!ruleArg || i.rule === ruleArg) rows.push({ name, ...i });
}
if (json) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }

const active = rows.filter((r) => !r.ignored);
const by = (sev) => active.filter((r) => r.severity === sev);
const C = { error: "\x1b[31m", warn: "\x1b[33m", info: "\x1b[36m", dim: "\x1b[2m", off: "\x1b[0m" };
console.log(`${icons.length} icons checked\n`);
console.log("Rule".padEnd(22), "Severity".padEnd(9), "Icons");
for (const [id, r] of Object.entries(RULES)) {
  const n = new Set(active.filter((x) => x.rule === id).map((x) => x.name)).size;
  if (n) console.log(id.padEnd(22), (C[r.severity] + r.severity.padEnd(9) + C.off), n, C.dim + "— " + r.title + C.off);
}
const ignored = rows.length - active.length;
const list = active.filter((r) => showInfo || r.severity !== "info" || only.length || ruleArg);
if (list.length) {
  console.log("");
  let last = null;
  for (const r of list) {
    if (r.name !== last) { console.log(`\n${r.name}`); last = r.name; }
    console.log(`  ${C[r.severity]}${r.severity}${C.off} ${r.rule}${r.where ? ` (${r.where})` : ""}${r.message ? `: ${r.message}` : ""}`);
  }
}
console.log(`\n${by("error").length} errors, ${by("warn").length} warnings, ${by("info").length} info${ignored ? `, ${ignored} ignored` : ""}.` + (showInfo || only.length || ruleArg ? "" : " (info hidden; add --all)"));
process.exit(by("error").length ? 1 : 0);
