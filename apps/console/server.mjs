// TrialVigil operator console — static server + reverse proxy.
// SPDX-License-Identifier: Apache-2.0
//
// Serves the Vite build in apps/console/dist and proxies /api and /health
// to the harness service (HARNESS_URL, default http://harness:3001).
//
// Why this file exists: the console calls relative paths (/api, /health) and
// the Vite dev server proxies them, but `vite preview` does not — so a
// plain `vite preview` container would serve the UI with a dead API. This
// tiny dependency-free server makes the container behave like the dev
// setup. HARNESS_URL is honoured at run time, not build time.

import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const HARNESS_URL = process.env.HARNESS_URL ?? "http://harness:3001";
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function proxy(req, res) {
  const target = new URL(req.url, HARNESS_URL);
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `harness unreachable: ${err.message}` }));
    } else {
      res.end();
    }
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname === "/health" || url.pathname.startsWith("/api/")) {
    proxy(req, res);
    return;
  }
  const file = path.join(DIST, decodeURIComponent(url.pathname));
  const safe = file.startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile()
    ? file
    : path.join(DIST, "index.html");
  res.writeHead(200, { "Content-Type": TYPES[path.extname(safe)] ?? "application/octet-stream" });
  fs.createReadStream(safe).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`TrialVigil console listening on http://${HOST}:${PORT} (harness: ${HARNESS_URL})`);
});
