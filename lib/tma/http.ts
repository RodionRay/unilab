import type { TmaError, TmaErrorCode } from "@/lib/tma/contract";
import { TMA_ERROR_TEXT } from "@/lib/tma/exchange";

/** JSON reply for /api/tma/*: never cached (bearer-scoped data). */
export function tmaJson(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function tmaError(
  status: number,
  code: TmaErrorCode,
  opts: { error?: string; botLink?: string; retryAfterSec?: number } = {},
): Response {
  const body: TmaError = { error: opts.error || TMA_ERROR_TEXT[code], code };
  if (opts.botLink) body.botLink = opts.botLink;
  const headers: Record<string, string> = opts.retryAfterSec ? { "Retry-After": String(opts.retryAfterSec) } : {};
  return tmaJson(body, status, headers);
}

/** Reads a JSON object body up to `maxBytes`; null when too large or not an object. */
export async function readJsonObject(req: Request, maxBytes: number): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
