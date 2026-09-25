import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./db/database.js";
import { notFound } from "./errors.js";
import { send, sendError, sendJson } from "./http.js";
import { handleApi } from "./routes/api.js";

const PUBLIC_DIR = new URL("../public/", import.meta.url);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * Serve a file from public/. Only simple file names are accepted, which rules
 * out path traversal; anything unknown falls back to the single-page app.
 */
async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const name = pathname === "/" ? "index.html" : pathname.slice(1);
  const safe = /^[a-z0-9-]+\.(html|js|css|svg|ico)$/.test(name) ? name : "index.html";
  try {
    const body = await readFile(fileURLToPath(new URL(safe, PUBLIC_DIR)));
    send(res, 200, body, MIME[extname(safe)]);
  } catch {
    throw notFound("ไฟล์");
  }
}

/**
 * Routes:
 *   GET  /health  -> JSON health check
 *   /api/*        -> JSON API (see routes/api.ts)
 *   GET  anything else -> HRM web app (public/)
 */
export function createApp(db: Db) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/health") {
        return sendJson(res, 200, { status: "ok" });
      }
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        return await handleApi(db, req, res, url);
      }
      if (req.method !== "GET" && req.method !== "HEAD") throw notFound("หน้าที่ต้องการ");
      return await serveStatic(res, url.pathname);
    } catch (err) {
      sendError(res, err);
    }
  });
}
