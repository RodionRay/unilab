import { readEnv } from "@/lib/auth";

/**
 * Telegram Mini App initData verification (core.telegram.org/bots/webapps, «Validating data received
 * via the Mini App»). WebCrypto only, so it runs on Workers. initData is a bearer-like secret: never log it.
 */

export type TmaTelegramUser = {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
};

export type InitDataResult =
  | { ok: true; user: TmaTelegramUser; authDate: number }
  | { ok: false; code: "invalid_init_data" | "init_data_expired" };

/**
 * 10 min: initData is replayable until it ages out (security L4); the client exchanges it once on launch and
 * reopening from the bot brings a fresh one, so a short window costs members nothing.
 */
const DEFAULT_MAX_AGE_SEC = 600;
/** Clock skew tolerated for an auth_date in the future. */
const MAX_FUTURE_SKEW_SEC = 60;
const HASH_RE = /^[0-9a-f]{64}$/;
const BOT_ID_RE = /^(\d{1,20}):/;

const INVALID: InitDataResult = { ok: false, code: "invalid_init_data" };
const EXPIRED: InitDataResult = { ok: false, code: "init_data_expired" };

/** `TMA_INITDATA_MAX_AGE` (seconds, positive integer), default 600. */
export function initDataMaxAgeSec(): number {
  const configured = Number(readEnv("TMA_INITDATA_MAX_AGE"));
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_AGE_SEC;
}

/** Bot id = numeric prefix of the token (`<id>:<secret>`); '' when the token is malformed. */
export function botIdFromToken(token: string): string {
  return BOT_ID_RE.exec(token.trim())?.[1] ?? "";
}

async function hmacSha256(key: Uint8Array<ArrayBuffer>, message: string): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message)));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Fields without `hash`; null when a key repeats (the data_check_string would be ambiguous). */
function parseFields(initData: string): { fields: Map<string, string>; hash: string } | null {
  const fields = new Map<string, string>();
  let hash = "";
  for (const [key, value] of new URLSearchParams(initData)) {
    if (key === "hash") {
      if (hash) return null;
      hash = value;
      continue;
    }
    if (fields.has(key)) return null;
    fields.set(key, value);
  }
  return { fields, hash };
}

function dataCheckString(fields: Map<string, string>): string {
  return [...fields.keys()]
    .sort()
    .map((k) => `${k}=${fields.get(k)}`)
    .join("\n");
}

function parseUser(raw: string | undefined): TmaTelegramUser | null {
  if (!raw) return null;
  try {
    const u = JSON.parse(raw) as Record<string, unknown>;
    if (typeof u.id !== "number" || !Number.isSafeInteger(u.id) || u.id <= 0) return null;
    const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
    return {
      id: u.id,
      username: text(u.username, 64),
      firstName: text(u.first_name, 128),
      lastName: text(u.last_name, 128),
    };
  } catch {
    return null;
  }
}

/**
 * Verifies the HMAC first (constant-time), then freshness: a forged payload is always
 * `invalid_init_data`, only an authentic one can be `init_data_expired`.
 */
export async function verifyInitData(
  initData: string,
  botToken: string,
  opts: { nowSec?: number; maxAgeSec?: number } = {},
): Promise<InitDataResult> {
  if (!botToken.trim()) return INVALID;
  const parsed = parseFields(initData);
  if (!parsed || !HASH_RE.test(parsed.hash)) return INVALID;
  const secret = await hmacSha256(new TextEncoder().encode("WebAppData"), botToken);
  const expected = toHex(await hmacSha256(secret, dataCheckString(parsed.fields)));
  if (!constantTimeEqual(expected, parsed.hash)) return INVALID;

  const authDate = Number(parsed.fields.get("auth_date"));
  if (!Number.isSafeInteger(authDate) || authDate <= 0) return INVALID;
  const user = parseUser(parsed.fields.get("user"));
  if (!user) return INVALID;

  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const maxAge = opts.maxAgeSec ?? initDataMaxAgeSec();
  if (now - authDate > maxAge || authDate - now > MAX_FUTURE_SKEW_SEC) return EXPIRED;
  return { ok: true, user, authDate };
}
