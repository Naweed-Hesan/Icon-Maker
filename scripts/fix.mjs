// Applies the safe, mechanical fixes to master icons:
//   misplaced-start, flattened-curve (refit as arcs), baked-fillet (back to sharp), zero-length.
//   npm run fix                  fix everything
//   npm run fix -- home bell     only these icons
//   npm run fix -- --dry         show what would change
import { fixStarts, refitCurves, unbakeFillets, normalize, deviation, round } from "../lib/path.js";
import { loadIcons, saveIcon } from "./load.mjs";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const only = args.filter((a) => !a.startsWith("--"));
let changed = 0;
for (const icon of loadIcons()) {
  if (only.length && !only.includes(icon.name)) continue;
  const notes = [];
  for (const [style, parts] of Object.entries(icon.styles)) {
    for (const part of parts) {
      for (const p of part.paths) {
        const before = p.d;
        let d = normalize(fixStarts(before));
        d = unbakeFillets(d);
        d = refitCurves(d);
        d = normalize(d);
        if (d !== normalize(before)) {
          const moved = round(deviation(before, d), 3);
          notes.push(`${style} › ${part.name}: ${before.length} → ${d.length} chars, max shift ${moved}px`);
          p.d = d;
          // Corner numbering may have changed; drop per-corner data that no longer applies.
          if (p.nodeRadius || p.sharpNodes) { delete p.nodeRadius; delete p.sharpNodes; notes.push(`  (reset per-corner radius overrides — re-check corners)`); }
        }
      }
    }
  }
  if (notes.length) {
    changed++;
    console.log(`${icon.name}\n  ${notes.join("\n  ")}`);
    if (!dry) saveIcon(icon);
  }
}
console.log(`\n${changed} icon${changed === 1 ? "" : "s"} ${dry ? "would change" : "changed"}.`);
