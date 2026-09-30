import { constantTimeEqual } from "@/lib/security/secret-compare";

const encoder = new TextEncoder();

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Buffer.from(mac).toString("base64url");
}

/**
 * Short-lived nonce for binding a login round-trip to the browser that started
 * it: `nonce` goes into the URL, `token` into an httpOnly cookie.
 */
export async function createSignedNonce(
  secret: string,
  ttlSec: number,
  nowMs = Date.now(),
): Promise<{ nonce: string; token: string }> {
  const nonce = crypto.randomUUID();
  const exp = Math.floor(nowMs / 1000) + ttlSec;
  const payload = `${nonce}.${exp}`;
  return { nonce, token: `${payload}.${await hmac(secret, payload)}` };
}

export async function verifySignedNonce(
  token: string | undefined,
  nonce: string | null | undefined,
  secret: string,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!token || !nonce) return false;
  const [tokenNonce, expRaw, sig] = token.split(".");
  if (!tokenNonce || !expRaw || !sig) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 < nowMs) return false;
  const sigOk = await constantTimeEqual(sig, await hmac(secret, `${tokenNonce}.${expRaw}`));
  const nonceOk = await constantTimeEqual(tokenNonce, nonce);
  return sigOk && nonceOk;
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}
