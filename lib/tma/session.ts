import { readEnv, timingSafeEqualBytes } from "@/lib/auth";

/**
 * Mini app bearer: `tma.<payload b64url>.<sig b64url>`, HMAC-SHA256 with SESSION_SECRET over a
 * domain-separated string, so a web cookie token can never pass as a tma token or vice versa.
 * Kept in client memory only (no cookie). Never log it.
 */

export const TMA_TOKEN_PREFIX = "tma.";
export const TMA_TOKEN_TTL_SEC = 3600;
const SIGNING_DOMAIN = "unilab-tma-v1.";
const CLOCK_SKEW_SEC = 60;
const BEARER_RE = /^Bearer\s+(tma\.\S+)\s*$/i;

export type TmaClaims = {
  /** Workspace member (user id). */
  sub: string;
  /** Workspace owner id. */
  own: string;
  /** Telegram user id. */
  tg: number;
  /** Bot id of the workspace bot token that verified initData. */
  bot: string;
  /** tma_links.id the session rests on. */
  lnk: string;
  /** Unix seconds. */
  exp: number;
};

async function signPayload(payload: string): Promise<string> {
  const secret = readEnv("SESSION_SECRET");
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET не настроен (минимум 32 символа)");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(SIGNING_DOMAIN + payload));
  return Buffer.from(mac).toString("base64url");
}

export async function issueTmaToken(
  claims: Omit<TmaClaims, "exp">,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = nowSec + TMA_TOKEN_TTL_SEC;
  const body: TmaClaims = { ...claims, exp: expiresAt };
  const payload = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  return { token: `${TMA_TOKEN_PREFIX}${payload}.${await signPayload(payload)}`, expiresAt };
}

function parseClaims(payload: string): TmaClaims | null {
  try {
    const c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const nonEmpty = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 200;
    if (!nonEmpty(c.sub) || !nonEmpty(c.own) || !nonEmpty(c.bot) || !nonEmpty(c.lnk)) return null;
    if (typeof c.tg !== "number" || !Number.isSafeInteger(c.tg) || c.tg <= 0) return null;
    if (typeof c.exp !== "number" || !Number.isSafeInteger(c.exp)) return null;
    return { sub: c.sub as string, own: c.own as string, tg: c.tg, bot: c.bot as string, lnk: c.lnk as string, exp: c.exp };
  } catch {
    return null;
  }
}

/** Signature, expiry and claim shape only; link/membership/bot re-checks live in lib/tma/actor.ts. */
export async function verifyTmaToken(token: string, nowSec = Math.floor(Date.now() / 1000)): Promise<TmaClaims | null> {
  if (!token.startsWith(TMA_TOKEN_PREFIX)) return null;
  const parts = token.slice(TMA_TOKEN_PREFIX.length).split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, sig] = parts;
  const expected = Buffer.from(await signPayload(payload), "utf8");
  const given = Buffer.from(sig, "utf8");
  if (expected.length !== given.length || !timingSafeEqualBytes(expected, given)) return null;
  const claims = parseClaims(payload);
  if (!claims) return null;
  if (claims.exp <= nowSec || claims.exp - nowSec > TMA_TOKEN_TTL_SEC + CLOCK_SKEW_SEC) return null;
  return claims;
}

/** The tma token from `Authorization: Bearer tma.…`, or null when the request carries none. */
export function readTmaBearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  return BEARER_RE.exec(header.trim())?.[1] ?? null;
}
