import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { greet } from "./greet.js";

/**
 * Handle a single HTTP request.
 *
 * Routes:
 *   GET /            -> plain-text greeting (optional ?name= query)
 *   GET /health      -> JSON health check
 */
export function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    const name = url.searchParams.get("name") ?? "world";
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(greet(name));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
}

/**
 * Create an HTTP server bound to the given request handler.
 */
export function createApp() {
  return createServer(handleRequest);
}
