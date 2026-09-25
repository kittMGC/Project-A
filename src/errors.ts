/**
 * An error whose message is safe to show to the user. Anything else that
 * escapes a handler is logged and reported as a generic 500.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: Record<string, string>) =>
  new HttpError(400, message, details);
export const notFound = (what: string) => new HttpError(404, `ไม่พบ${what}`);
export const conflict = (message: string) => new HttpError(409, message);
