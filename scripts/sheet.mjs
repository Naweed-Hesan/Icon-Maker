// Writes sheet.html: the given icons in every variant at 24px and 96px, on light and dark,
// for a quick visual check (open it in a browser or screenshot it).
//   npm run sheet -- bell home        (no names = every icon, default variant only)
//   npm run sheet -- bell --anim ring (filmstrip of 12 frames + the live animation; --anim all for every animation)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { variantParts, partsToSvgInner } from "../lib/variants.js";
import { frameInner, totalDuration, animatedSvg } from "../lib/animate.js";
import { ROOT, config as loadConfig, loadIcons } from "./load.mjs";

const config = loadConfig();
const argv = process.argv.slice(2);
const animName = argv.includes("--anim") ? argv[argv.indexOf("--anim") + 1] : null;
const names = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--anim");
const icons = loadIcons().filter((i) => !names.length || names.includes(i.name));
const svg = (icon, o, size) => `<svg width="${size}" height="${size}" viewBox="0 0 ${config.grid} ${config.grid}" fill="none">${partsToSvgInner(variantParts(icon, config, o))}</svg>`;
let body = "";
if (animName) {
  for (const icon of icons) for (const [thisName, anim] of Object.entries(icon.animations || {})) {
    if (animName !== "all" && thisName !== animName) continue;
    const name = thisName;
    const total = totalDuration(anim), n = 12;
    const v = { style: "outline", corner: config.defaults.corner, weight: "regular" };
    body += `<h2>${icon.name} · ${name} · ${total}ms${anim.iterations === "infinite" ? " · loops" : ""}</h2><div class="light strip">`;
    for (let i = 0; i < n; i++) {
      const ms = Math.round((total * i) / (n - 1));
      body += `<figure><svg width="72" height="72" viewBox="0 0 ${config.grid} ${config.grid}" fill="none" style="outline:1px solid #eee">${frameInner(icon, config, v, name, ms)}</svg><figcaption>${ms}ms</figcaption></figure>`;
    }
    body += `<figure><div style="width:72px;height:72px;display:flex;align-items:center;justify-content:center">${animatedSvg(icon, config, v, name).replace('width="24" height="24"', 'width="48" height="48"')}</div><figcaption>live</figcaption></figure></div>`;
  }
} else if (names.length) {
  for (const icon of icons) {
    body += `<h2>${icon.name}</h2>`;
    for (const theme of ["light", "dark"]) {
      body += `<div class="${theme}"><table><tr><th></th>${Object.keys(config.corners).map((c) => `<th>${c}</th>`).join("")}</tr>`;
      for (const style of config.styles)
        body += `<tr><th>${style}</th>${Object.keys(config.corners).map((corner) => `<td>${svg(icon, { style, corner }, 96)}${svg(icon, { style, corner }, 24)}</td>`).join("")}</tr>`;
      body += `<tr><th>weights</th>${Object.keys(config.weights).map((weight) => `<td>${svg(icon, { weight }, 96)}${svg(icon, { weight }, 24)}</td>`).join("")}</tr></table></div>`;
    }
  }
} else {
  body = `<div class="light grid">${icons.map((i) => `<figure>${svg(i, {}, 32)}<figcaption>${i.name}</figcaption></figure>`).join("")}</div>`;
}
writeFileSync(
  join(ROOT, "sheet.html"),
  `<!doctype html><meta charset="utf-8"><title>Sheet</title><style>
body{font:12px system-ui,sans-serif;margin:16px}h2{margin:16px 0 6px}.light{background:#fff;color:#141417}.dark{background:#111114;color:#eee}
.light,.dark{padding:10px;border-radius:8px;margin-bottom:6px}td{padding:6px 10px;text-align:center}td svg{margin:0 4px;vertical-align:bottom}th{font-weight:500;color:#888;text-align:left}
.strip{display:flex;gap:8px;flex-wrap:wrap}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px}figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:4px}figcaption{font-size:10px;color:#777}
</style>${body}`
);
console.log(`Wrote sheet.html (${icons.length} icon${icons.length === 1 ? "" : "s"}).`);
