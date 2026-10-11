import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".css": "text/css", ".otf": "font/otf", ".md": "text/plain" };

export async function startServer({ source = false, isolation = true, port = 0, basePath = "/" } = {}) {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(basePath)) throw Error("basePath must be a directory path such as /rex/");
  const root = path.join(project, source ? "public" : "dist");
  try { await stat(path.join(root, "index.html")); }
  catch { throw Error("Missing dist/index.html. Run npm run build before previewing or browser testing."); }
  const server = http.createServer(async (req, res) => {
    if (isolation) {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    }
    try {
      const requested = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      if (basePath !== "/" && requested === basePath.slice(0, -1)) {
        res.writeHead(301, {Location: basePath}); res.end(); return;
      }
      if (!requested.startsWith(basePath)) throw Error("Outside site path");
      const pathname = "/" + requested.slice(basePath.length);
      let base = root, relative = pathname;
      if (source && pathname.startsWith("/assets/")) { base = path.join(project, "src"); relative = pathname.slice(7); }
      if (source && pathname.startsWith("/vendor/")) { base = path.join(project, "vendor"); relative = pathname.slice(7); }
      let file = path.resolve(base, "." + relative);
      if (file !== base && !file.startsWith(base + path.sep)) throw Error("Invalid path");
      if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
      res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
      res.end(await readFile(file));
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    url: "http://127.0.0.1:" + server.address().port + basePath,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startServer({ source: process.argv.includes("--source"), isolation: !process.env.REX_NO_ISOLATION, port: Number(process.env.PORT || 8080) });
  console.log(server.url);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await server.close(); });
}
