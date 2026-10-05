// Creates a blank master icon to draw into.
//   npm run new -- rocket
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ICON_DIR, config, saveIcon } from "./load.mjs";

const name = process.argv[2];
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name || "")) { console.error("Usage: npm run new -- <kebab-case-name>"); process.exit(1); }
if (existsSync(join(ICON_DIR, `${name}.json`))) { console.error(`${name} already exists.`); process.exit(1); }
const box = "M6 6L18 6L18 18L6 18Z";
saveIcon({
  name,
  tags: [],
  styles: {
    outline: [{ name: "body", paths: [{ d: box, stroke: true }] }],
    solid: [{ name: "body", paths: [{ d: box, stroke: true, fill: true }] }],
    duotone: [{ name: "tint", opacity: config().duotoneOpacity, paths: [{ d: box, fill: true }] }, { name: "body", paths: [{ d: box, stroke: true }] }],
  },
});
console.log(`Created icons/${name}.json`);
