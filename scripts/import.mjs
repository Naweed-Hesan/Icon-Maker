// Turns a my-icons.json export from the website into real SVG files under icons/,
// then rebuilds. Usage: npm run import -- path/to/my-icons.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run import -- path/to/my-icons.json");
  process.exit(1);
}

const icons = JSON.parse(readFileSync(file, "utf8"));
const tagsPath = join(ROOT, "icons", "tags.json");
const tags = existsSync(tagsPath) ? JSON.parse(readFileSync(tagsPath, "utf8")) : {};
const safe = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");

for (const icon of icons) {
  const category = safe(icon.category) || "my-icons";
  const name = safe(icon.name);
  if (!name) continue;
  const paint = icon.mode === "stroke"
    ? 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    : 'fill="currentColor"';
  mkdirSync(join(ROOT, "icons", category), { recursive: true });
  const out = join(ROOT, "icons", category, `${name}.svg`);
  writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}" ${paint}>${icon.body}</svg>\n`);
  if (icon.tags?.length) tags[name] = icon.tags;
  console.log(`+ icons/${category}/${name}.svg`);
}

writeFileSync(tagsPath, JSON.stringify(tags, null, 2) + "\n");
execFileSync(process.execPath, [join(ROOT, "scripts", "build.mjs")], { stdio: "inherit" });
