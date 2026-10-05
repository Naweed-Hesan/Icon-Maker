// Builds the publishable package into dist/ from the master icons:
//   dist/svg/{weight}/{corner}/{style}/{name}.svg
//   dist/sprite/{corner}-{style}.svg          (regular weight, <symbol id="dope-{name}">)
//   dist/json/dope-icons.json                 (every style × corner, regular weight)
//   dist/react/                               (ESM components; weight/corner/style are props)
import { writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { variantParts, partsToSvgInner } from "../lib/variants.js";
import { lintAll } from "../lib/lint.js";
import { ROOT, config as loadConfig, loadIcons } from "./load.mjs";

const config = loadConfig();
const icons = loadIcons();
const OUT = join(ROOT, "dist");
const corners = Object.keys(config.corners);
const weights = Object.keys(config.weights);
const g = config.grid;

if (!process.argv.includes("--force")) {
  const errors = Object.entries(lintAll(icons, config)).flatMap(([n, list]) => list.filter((i) => i.severity === "error" && !i.ignored).map((i) => `${n}: ${i.rule}`));
  if (errors.length) {
    console.error(`Refusing to build: ${errors.length} lint errors (run npm run lint, or build with --force).\n  ` + errors.slice(0, 20).join("\n  "));
    process.exit(1);
  }
}

rmSync(OUT, { recursive: true, force: true });
const svgFile = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${g}" height="${g}" viewBox="0 0 ${g} ${g}" fill="none">${inner}</svg>\n`;
const pascal = (s) => s.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("");

// 1. SVG files
let count = 0;
for (const weight of weights)
  for (const corner of corners)
    for (const style of config.styles) {
      const dir = join(OUT, "svg", weight, corner, style);
      mkdirSync(dir, { recursive: true });
      for (const icon of icons) {
        writeFileSync(join(dir, `${icon.name}.svg`), svgFile(partsToSvgInner(variantParts(icon, config, { style, corner, weight }))));
        count++;
      }
    }

// 2. Sprites + 3. JSON (regular weight; consumers scale strokes by weight / baseStroke)
const data = {};
for (const icon of icons) {
  data[icon.name] = {};
  for (const style of config.styles) {
    data[icon.name][style] = {};
    for (const corner of corners) data[icon.name][style][corner] = variantParts(icon, config, { style, corner, weight: "regular" });
  }
}
mkdirSync(join(OUT, "sprite"), { recursive: true });
for (const corner of corners)
  for (const style of config.styles) {
    const symbols = icons.map((i) => `<symbol id="dope-${i.name}" viewBox="0 0 ${g} ${g}" fill="none">${partsToSvgInner(data[i.name][style][corner])}</symbol>`);
    writeFileSync(join(OUT, "sprite", `${corner}-${style}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${symbols.join("\n")}\n</svg>\n`);
  }
mkdirSync(join(OUT, "json"), { recursive: true });
writeFileSync(
  join(OUT, "json", "dope-icons.json"),
  JSON.stringify({ version: 2, grid: g, baseStroke: config.baseStroke, weights: config.weights, corners, styles: config.styles, icons: data })
);

// 4. React
const reactDir = join(OUT, "react");
mkdirSync(join(reactDir, "icons"), { recursive: true });
writeFileSync(
  join(reactDir, "createIcon.js"),
  `import { createElement, forwardRef } from "react";

const WEIGHTS = ${JSON.stringify(config.weights)};
const BASE = ${config.baseStroke};

export function createIcon(displayName, data) {
  const Icon = forwardRef(function DopeIcon(
    { variant = "${config.defaults.style}", corner = "${config.defaults.corner}", weight = "${config.defaults.weight}", size = ${g}, color = "currentColor", strokeWidth, title, className, ...rest },
    ref
  ) {
    const parts = data[variant][corner];
    // Every style follows the weight, solid included. strokeWidth overrides the weight.
    const k = (strokeWidth ?? WEIGHTS[weight] ?? BASE) / BASE;
    const children = parts.map((part) =>
      createElement(
        "g",
        { key: part.name, "data-part": part.name, className: "dope-part dope-part-" + part.name, opacity: part.opacity },
        part.paths.map((p, i) =>
          createElement("path", {
            key: i,
            d: p.d,
            fill: p.fill ? "currentColor" : "none",
            fillRule: p.fill ? p.fillRule : undefined,
            stroke: p.stroke ? "currentColor" : undefined,
            strokeWidth: p.stroke ? +(p.strokeWidth * k).toFixed(3) : undefined,
            strokeLinecap: p.stroke ? p.cap : undefined,
            strokeLinejoin: p.stroke ? p.join : undefined,
          })
        )
      )
    );
    if (title) children.unshift(createElement("title", { key: "title" }, title));
    return createElement(
      "svg",
      {
        ref,
        xmlns: "http://www.w3.org/2000/svg",
        width: size,
        height: size,
        viewBox: "0 0 ${g} ${g}",
        fill: "none",
        color,
        role: title ? "img" : undefined,
        "aria-hidden": title ? undefined : true,
        className: ["dope-icon", "dope-icon-" + displayName, className].filter(Boolean).join(" "),
        ...rest,
      },
      children
    );
  });
  Icon.displayName = displayName;
  return Icon;
}
`
);
const strip = (parts) => parts.map((pt) => ({ ...pt, paths: pt.paths.map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== false))) }));
const js = [], dts = [];
for (const icon of icons) {
  const C = `Icon${pascal(icon.name)}`;
  const compact = Object.fromEntries(config.styles.map((st) => [st, Object.fromEntries(corners.map((c) => [c, strip(data[icon.name][st][c])]))]));
  writeFileSync(join(reactDir, "icons", `${C}.js`), `import { createIcon } from "../createIcon.js";\nexport const ${C} = createIcon("${icon.name}", ${JSON.stringify(compact)});\nexport default ${C};\n`);
  js.push(`export { ${C} } from "./icons/${C}.js";`);
  dts.push(`export declare const ${C}: DopeIcon;`);
}
writeFileSync(join(reactDir, "index.js"), js.join("\n") + "\n");
writeFileSync(
  join(reactDir, "index.d.ts"),
  `import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";

export type DopeVariant = ${config.styles.map((s) => `"${s}"`).join(" | ")};
export type DopeCorner = ${corners.map((s) => `"${s}"`).join(" | ")};
export type DopeWeight = ${weights.map((s) => `"${s}"`).join(" | ")};

export interface DopeIconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  variant?: DopeVariant;
  corner?: DopeCorner;
  weight?: DopeWeight;
  size?: number | string;
  color?: string;
  strokeWidth?: number;
  title?: string;
}

export type DopeIcon = ForwardRefExoticComponent<DopeIconProps & RefAttributes<SVGSVGElement>>;

${dts.join("\n")}
`
);

// Package files
for (const f of ["package.json", "README.md"]) if (existsSync(join(ROOT, "package", f))) copyFileSync(join(ROOT, "package", f), join(OUT, f));

console.log(`Built ${icons.length} icons → ${count} SVG files, ${corners.length * config.styles.length} sprites, ${icons.length} React components in dist/.`);
