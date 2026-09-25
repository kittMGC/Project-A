import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "./errors.js";

const MAX_BODY_BYTES = 100 * 1024;

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

export function send(res: ServerResponse, status: number, body: string | Buffer, type: string): void {
  res.writeHead(status, { "Content-Type": type, ...SECURITY_HEADERS });
  res.end(body);
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  if (status === 204) {
    res.writeHead(204, SECURITY_HEADERS);
    res.end();
    return;
  }
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8");
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof HttpError) {
    sendJson(res, err.status, { error: err.message, ...(err.details && { details: err.details }) });
    return;
  }
  // Never leak internals (SQL, stack traces) to the client.
  console.error(err);
  sendJson(res, 500, { error: "เกิดข้อผิดพลาดภายในระบบ" });
}

/**
 * Read a JSON request body. Requiring the JSON content type also blocks
 * cross-site HTML form posts, which cannot send it.
 */
export async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new HttpError(415, "ต้องส่งข้อมูลเป็น JSON");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "ข้อมูลมีขนาดใหญ่เกินไป");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "รูปแบบ JSON ไม่ถูกต้อง");
  }
}

/** Parse a positive integer query/path value, or undefined. */
export function toId(value: string | null | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return n > 0 && Number.isSafeInteger(n) ? n : undefined;
}
