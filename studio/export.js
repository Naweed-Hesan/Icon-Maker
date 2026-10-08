// Batch export of animated icons: every chosen icon × animation × variant × format, into one ZIP.
import { animatedSvg, frameInner, animationCss } from "/lib/animate.js";
import { toLottie } from "/lib/lottie.js";
import { zip, encodeGif, encodeApng, encodeWebp } from "/lib/encode.js";

export const FORMATS = {
  svg: { label: "Animated SVG", ext: "svg", note: "Plays by itself in browsers, <img> and inline." },
  react: { label: "React component (.jsx)", ext: "jsx", note: "Standalone component, no package needed." },
  css: { label: "CSS", ext: "css", note: "Keyframes + classes for the inline icons." },
  lottie: { label: "Lottie (.json)", ext: "json", note: "iOS, Android, React Native, Flutter, web players." },
  gif: { label: "GIF", ext: "gif", note: "Works everywhere; 1-bit transparency (edges blend into the matte colour)." },
  apng: { label: "APNG (.png)", ext: "png", note: "Animated PNG with smooth transparency." },
  webp: { label: "Animated WebP", ext: "webp", note: "Small, smooth transparency." },
};

const pascal = (s) => s.split(/[^a-z0-9]+/i).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");
const vName = (v) => `${v.style}-${v.corner}-${v.weight}`;

// One play of the animation, in ms (all iterations unless it loops forever).
function playLength(anim) {
  const iter = anim.iterations === "infinite" ? 1 : Math.max(1, anim.iterations ?? 1);
  return Math.max(...Object.values(anim.parts || {}).map((p) => (p.delay || 0) + (p.duration ?? anim.duration ?? 600) * iter), anim.duration || 0);
}

function frameTimes(anim, fps, pauseMs) {
  const len = playLength(anim), step = 1000 / fps;
  if (anim.iterations === "infinite") {
    const n = Math.max(1, Math.round(len / step));
    return Array.from({ length: n }, (_, k) => ({ ms: k * step, delayMs: step }));
  }
  const n = Math.max(1, Math.ceil(len / step));
  return Array.from({ length: n + 1 }, (_, k) => ({ ms: Math.min(len, k * step), delayMs: k === n ? step + pauseMs : step }));
}

// SVG markup → JSX (attributes camelCased, class → className, <style> kept as a template literal).
function svgToJsx(svg) {
  return svg
    .replace(/<style>([\s\S]*?)<\/style>/, (_, css) => `<style>{\`${css.replace(/`/g, "\\`")}\`}</style>`)
    .replace(/\sclass="/g, ' className="')
    .replace(/\s([a-z]+(?:-[a-z]+)+)=/g, (_, a) => " " + (a.startsWith("data-") ? a : a.replace(/-([a-z])/g, (__, c) => c.toUpperCase())) + "=")
    .replace(/\s(width|height)="\d+"/g, "");
}

let canvas, ctx;
async function rasterize(svgText, size, background) {
  canvas ||= document.createElement("canvas");
  canvas.width = canvas.height = size;
  ctx ||= canvas.getContext("2d", { willReadFrequently: true });
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
  await img.decode();
  ctx.clearRect(0, 0, size, size);
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, size, size); }
  ctx.drawImage(img, 0, 0, size, size);
}
const blobBytes = (type, q) => new Promise((ok) => canvas.toBlob(async (b) => ok(new Uint8Array(await b.arrayBuffer())), type, q));

// jobs: [{ icon, anim }]; opts: { variants, formats:Set, size, fps, color, background, currentColor, loop, pauseMs }
export async function buildExport(jobs, config, opts, onProgress = () => {}) {
  const files = [];
  const { variants, formats, size, fps, color, background, loop, pauseMs } = opts;
  const svgColor = opts.currentColor ? "currentColor" : color;
  const total = jobs.length * variants.length;
  let done = 0;
  for (const { icon, anim: name } of jobs) {
    const anim = icon.animations[name];
    for (const v of variants) {
      const base = `${icon.name}-${name}`, dir = vName(v);
      onProgress(done / total, `${icon.name} · ${name} · ${dir}`);
      if (formats.has("svg")) files.push({ name: `svg/${dir}/${base}.svg`, data: animatedSvg(icon, config, v, name, { color: svgColor, size }) });
      if (formats.has("react")) {
        const C = `Icon${pascal(icon.name)}${pascal(name)}`;
        const jsx = svgToJsx(animatedSvg(icon, config, v, name, { color: "currentColor" }).trim()).replace("<svg ", "<svg width={size} height={size} {...props} ");
        files.push({ name: `react/${dir}/${C}.jsx`, data: `// ${icon.name} · "${name}" animation · ${dir}. Plays when mounted; remount (change key) to replay.\nexport default function ${C}({ size = 24, ...props }) {\n  return (\n    ${jsx}\n  );\n}\n` });
      }
      if (formats.has("lottie")) files.push({ name: `lottie/${dir}/${base}.json`, data: JSON.stringify(toLottie(icon, config, v, name, { size, fps: Math.max(fps, 30), color })) });
      const raster = ["gif", "apng", "webp"].filter((f) => formats.has(f));
      if (raster.length) {
        const times = frameTimes(anim, fps, pauseMs);
        const gifFrames = [], pngs = [], webps = [];
        for (const t of times) {
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${config.grid} ${config.grid}" fill="none">${frameInner(icon, config, v, name, t.ms, { color })}</svg>`;
          if (formats.has("gif")) { await rasterize(svg, size, null); gifFrames.push({ rgba: ctx.getImageData(0, 0, size, size).data, delayMs: t.delayMs }); }
          if (formats.has("apng") || formats.has("webp")) {
            await rasterize(svg, size, background);
            if (formats.has("apng")) pngs.push({ bytes: await blobBytes("image/png"), delayMs: t.delayMs });
            if (formats.has("webp")) webps.push({ bytes: await blobBytes("image/webp", 1), delayMs: t.delayMs });
          }
        }
        if (gifFrames.length) files.push({ name: `gif/${dir}/${base}.gif`, data: encodeGif(gifFrames, size, size, { color, background, loop }) });
        if (pngs.length) files.push({ name: `apng/${dir}/${base}.png`, data: encodeApng(pngs, { loop }) });
        if (webps.length) files.push({ name: `webp/${dir}/${base}.webp`, data: encodeWebp(webps, size, size, { loop }) });
      }
      done++;
    }
  }
  if (formats.has("css")) {
    const css = ["/* Add class dope-play-<animation> (plays when shown) or dope-hover-<animation> (on hover) next to dope-icon-<name> on the inline <svg>. Paths that \"draw\" need pathLength=\"1\". */"];
    for (const { icon, anim: name } of jobs) {
      css.push(animationCss(icon.name, name, icon.animations[name], `.dope-icon-${icon.name}.dope-play-${name}`));
      css.push(animationCss(icon.name, name, icon.animations[name], `.dope-icon-${icon.name}.dope-hover-${name}:hover`));
    }
    files.push({ name: "css/dope-animations.css", data: css.join("\n") + "\n" });
  }
  files.push({
    name: "README.txt",
    data: `Dope Icons animated export\n\n${jobs.length} animation(s) × ${variants.length} variant(s): ${variants.map(vName).join(", ")}\nFormats: ${[...formats].map((f) => FORMATS[f].label).join(", ")}\nRaster/Lottie size ${size}px, ${fps} fps, colour ${color}, background ${background || "transparent"}, ${loop ? "looping" : "plays once"}${pauseMs ? `, ${pauseMs}ms pause between loops` : ""}.\n\nFolders are named style-corner-weight. SVG and React use ${svgColor === "currentColor" ? "currentColor (they take your text colour)" : svgColor}.\nAll SVG/CSS/React animations switch off when the viewer has "reduce motion" turned on.\n`,
  });
  onProgress(1, "Packing ZIP");
  return zip(files);
}
