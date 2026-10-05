// Turns a master icon into a concrete variant (style × corner × weight).
//
// Master format (icons/<name>.json):
// {
//   "name": "home", "tags": [...], "lintIgnore": { "rule-id": "reason" },
//   "styles": {
//     "outline": [ { "name": "body", "opacity": 0.2?, "paths": [
//        { "d": "<sharp geometry>", "stroke": true, "fill": false, "fillRule": "evenodd"?,
//          "strokeWidth": 1.5, "radius": 1, "sharpNodes": [3], "nodeRadius": { "5": 0.5 } } ] } ],
//     "solid": [...], "duotone": [...]
//   }
// }
// `d` is always drawn with sharp corners. Corner sets round every line–line corner with
// config.corners[corner] × path.radius (× nodeRadius[node]); nodes in sharpNodes stay sharp.
import { roundCorners } from "./path.js";

export function strokeFor(path, config, weight) {
  return +((path.strokeWidth ?? config.baseStroke) * (config.weights[weight] / config.baseStroke)).toFixed(3);
}

export function variantParts(icon, config, { style = "outline", corner = "round", weight = "regular" } = {}) {
  const base = config.corners[corner] ?? 0;
  const sharp = base === 0;
  return (icon.styles[style] || []).map((part) => ({
    name: part.name,
    opacity: part.opacity,
    paths: part.paths.map((p) => {
      const scale = p.radius ?? 1;
      const sharpNodes = new Set(p.sharpNodes || []);
      const d = sharp || scale === 0
        ? p.d
        : roundCorners(p.d, (node) => (sharpNodes.has(node) ? 0 : base * scale * (p.nodeRadius?.[node] ?? 1)));
      return {
        d,
        fill: !!p.fill,
        fillRule: p.fill ? p.fillRule : undefined,
        stroke: !!p.stroke,
        strokeWidth: p.stroke ? strokeFor(p, config, weight) : undefined,
        cap: p.stroke ? (sharp ? "square" : "round") : undefined,
        join: p.stroke ? (sharp ? "miter" : "round") : undefined,
      };
    }),
  }));
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function partsToSvgInner(parts, { color = "currentColor", pathLength = false } = {}) {
  return parts
    .map((part) => {
      const op = part.opacity !== undefined && part.opacity < 1 ? ` opacity="${part.opacity}"` : "";
      const paths = part.paths
        .map((p) => {
          const a = [`d="${esc(p.d)}"`, p.fill ? `fill="${color}"` : `fill="none"`];
          if (pathLength && p.stroke) a.push(`pathLength="1"`);
          if (p.fill && p.fillRule) a.push(`fill-rule="${p.fillRule}"`);
          if (p.stroke) {
            a.push(`stroke="${color}"`, `stroke-width="${p.strokeWidth}"`);
            if (p.cap) a.push(`stroke-linecap="${p.cap}"`);
            if (p.join) a.push(`stroke-linejoin="${p.join}"`);
          }
          return `<path ${a.join(" ")}/>`;
        })
        .join("");
      return `<g data-part="${esc(part.name)}"${op}>${paths}</g>`;
    })
    .join("");
}

export function toSvg(icon, config, opts = {}) {
  const g = config.grid;
  const size = opts.size ?? g;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${g} ${g}" fill="none">${partsToSvgInner(variantParts(icon, config, opts), opts)}</svg>`;
}
