// Local server for the studio: serves the app, reads/writes master icons, config and the
// Claude request queue, and pushes a live-reload event whenever those files change on disk.
//   npm run studio            → http://localhost:4321
//   PORT=5000 npm run studio
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, watch, unlinkSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { ROOT, ICON_DIR, config, loadIcons } from "./load.mjs";

const PORT = +process.env.PORT || 4321;
const REQUESTS = join(ROOT, "requests.json");
const PUBLIC = ["studio", "lib", "reference"];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const readRequests = () => (existsSync(REQUESTS) ? JSON.parse(readFileSync(REQUESTS, "utf8")) : []);
const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const body = (req) =>
  new Promise((ok, fail) => {
    let s = "";
    req.on("data", (c) => { s += c; if (s.length > 5e6) req.destroy(); });
    req.on("end", () => { try { ok(JSON.parse(s)); } catch (e) { fail(e); } });
  });

function validIcon(icon) {
  if (!icon || typeof icon !== "object" || !NAME.test(icon.name || "")) return "Icon needs a kebab-case name.";
  if (!icon.styles || typeof icon.styles !== "object") return "Icon needs styles.";
  for (const [style, parts] of Object.entries(icon.styles)) {
    if (!Array.isArray(parts)) return `${style} must be a list of parts.`;
    for (const p of parts) if (!p.name || !Array.isArray(p.paths)) return `${style}: every part needs a name and paths.`;
  }
  return null;
}

// Live reload over server-sent events.
const clients = new Set();
let timer;
const notify = (what) => {
  clearTimeout(timer);
  timer = setTimeout(() => { for (const c of clients) c.write(`data: ${JSON.stringify({ what })}\n\n`); }, 120);
};
watch(ICON_DIR, () => notify("icons"));
watch(ROOT, (_, f) => { if (f === "config.json" || f === "requests.json") notify(f); });

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = decodeURIComponent(url.pathname);
  try {
    if (path === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(": hi\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (path === "/api/state" && req.method === "GET") return send(res, 200, { config: config(), icons: loadIcons(), requests: readRequests() });
    if (path === "/api/config" && req.method === "PUT") {
      const c = await body(req);
      if (!c.corners || !c.weights || !c.styles) return send(res, 400, { error: "Incomplete config." });
      writeFileSync(join(ROOT, "config.json"), JSON.stringify(c, null, 2) + "\n");
      return send(res, 200, { ok: true });
    }
    if (path === "/api/requests" && req.method === "PUT") {
      const list = await body(req);
      if (!Array.isArray(list)) return send(res, 400, { error: "Expected a list." });
      writeFileSync(REQUESTS, JSON.stringify(list, null, 2) + "\n");
      return send(res, 200, { ok: true });
    }
    const m = path.match(/^\/api\/icons\/([^/]+)$/);
    if (m) {
      const name = m[1];
      if (!NAME.test(name)) return send(res, 400, { error: "Bad icon name." });
      const file = join(ICON_DIR, `${name}.json`);
      if (req.method === "PUT") {
        const icon = await body(req);
        const err = validIcon(icon);
        if (err) return send(res, 400, { error: err });
        if (icon.name !== name && existsSync(join(ICON_DIR, `${icon.name}.json`))) return send(res, 409, { error: `${icon.name} already exists.` });
        writeFileSync(join(ICON_DIR, `${icon.name}.json`), JSON.stringify(icon, null, 2) + "\n");
        if (icon.name !== name && existsSync(file)) unlinkSync(file);
        return send(res, 200, { ok: true });
      }
      if (req.method === "DELETE") {
        if (existsSync(file)) unlinkSync(file);
        return send(res, 200, { ok: true });
      }
    }
    // Static files
    let rel = path === "/" ? "studio/index.html" : path.slice(1);
    rel = normalize(rel);
    if (!PUBLIC.some((d) => rel === d || rel.startsWith(d + "/"))) return send(res, 404, "Not found", "text/plain");
    const file = join(ROOT, rel);
    if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, "Not found", "text/plain");
    return send(res, 200, readFileSync(file), TYPES[extname(file)] || "application/octet-stream");
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Dope Icons Studio → http://localhost:${PORT}`));
