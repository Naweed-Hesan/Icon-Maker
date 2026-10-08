import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const ICON_DIR = join(ROOT, "icons");
export const config = () => JSON.parse(readFileSync(join(ROOT, "config.json"), "utf8"));
export const iconNames = () => readdirSync(ICON_DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
export const loadIcon = (name) => JSON.parse(readFileSync(join(ICON_DIR, `${name}.json`), "utf8"));
export const loadIcons = () => iconNames().map(loadIcon);
export const saveIcon = (icon) => writeFileSync(join(ICON_DIR, `${icon.name}.json`), JSON.stringify(icon, null, 2) + "\n");
