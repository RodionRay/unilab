import { database } from "@/lib/server-store";

export type RateLimitRule = {
  readonly name: string;
  readonly limit: number;
  readonly windowSec: number;
};

export type RateLimitResult = {
  readonly allowed: boolean;
  readonly retryAfterSec: number;
};

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Fixed-window limits, stored in D1 so they hold across Worker isolates.
 * Every attempt is counted before the work it guards (atomic per bucket, so
 * parallel requests cannot slip past); humans stay far below these.
 * Login: `loginPerEmailIp` (email + trusted IP, or email alone when no IP is
 * trusted) is the tight guess limit and is cleared by a successful login, so
 * guesses from one network do not lock the owner out elsewhere;
 * `loginPerEmail` is a high ceiling against guessing spread over many IPs.
 */
export const RATE_LIMITS = {
  loginPerIp: { name: "login-ip", limit: 20, windowSec: 15 * MINUTE },
  loginPerEmailIp: { name: "login-email-ip", limit: 10, windowSec: 15 * MINUTE },
  loginPerEmail: { name: "login-email", limit: 100, windowSec: 15 * MINUTE },
  registerPerIp: { name: "register-ip", limit: 5, windowSec: HOUR },
  contactPerIp: { name: "contact-ip", limit: 5, windowSec: HOUR },
  assistantAnonPerIp: { name: "assistant-anon-ip", limit: 30, windowSec: DAY },
  assistantAnonGlobal: { name: "assistant-anon-global", limit: 500, windowSec: DAY },
} as const satisfies Record<string, RateLimitRule>;

const DEFAULT_ASSISTANT_USER_DAILY_LIMIT = 200;

/**
 * Daily cap per signed-in user on the paid assistant key.
 * `ASSISTANT_USER_DAILY_LIMIT` overrides the default; invalid values fall back to it.
 */
export function assistantUserDailyRule(): RateLimitRule {
  const configured = Number(process.env.ASSISTANT_USER_DAILY_LIMIT);
  const limit =
    Number.isInteger(configured) && configured > 0
      ? configured
      : DEFAULT_ASSISTANT_USER_DAILY_LIMIT;
  return { name: "assistant-user", limit, windowSec: DAY };
}

let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  const db = database();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS rate_limits (
        key text PRIMARY KEY NOT NULL,
        window_start integer NOT NULL,
        count integer NOT NULL,
        expires integer NOT NULL
      )`,
    )
    .bind()
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits (expires)")
    .bind()
    .run();
  tableReady = true;
}

async function bucketKey(rule: RateLimitRule, subject: string): Promise<string> {
  // Subjects are emails/IPs: store a digest, not the PII itself.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(subject.toLowerCase()),
  );
  return `${rule.name}:${Buffer.from(digest).toString("base64url")}`;
}

/** Counts one attempt against `rule` for `subject`; atomic per bucket. */
export async function consumeRateLimit(
  rule: RateLimitRule,
  subject: string,
  nowMs = Date.now(),
): Promise<RateLimitResult> {
  await ensureTable();
  const nowSec = Math.floor(nowMs / 1000);
  const windowStart = nowSec - (nowSec % rule.windowSec);
  const expires = windowStart + rule.windowSec;
  const db = database();
  await db.prepare("DELETE FROM rate_limits WHERE expires <= ?").bind(nowSec).run();
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count, expires) VALUES (?, ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
         window_start = excluded.window_start,
         expires = excluded.expires
       RETURNING count`,
    )
    .bind(await bucketKey(rule, subject), windowStart, expires)
    .first<{ count: number }>();
  const count = Number(row?.count ?? 1);
  return { allowed: count <= rule.limit, retryAfterSec: Math.max(1, expires - nowSec) };
}

/** Forgets all counted attempts of `subject` under `rule`. */
export async function resetRateLimit(rule: RateLimitRule, subject: string): Promise<void> {
  await ensureTable();
  await database()
    .prepare("DELETE FROM rate_limits WHERE key = ?")
    .bind(await bucketKey(rule, subject))
    .run();
}

/**
 * Counts `checks` in order and stops at the first exceeded rule: later
 * (usually wider) buckets are not spent by a client that is already blocked.
 * A null subject (e.g. no trusted client IP) skips that rule: one shared
 * bucket for every unidentified client would let one abuser lock out everyone.
 */
export async function consumeRateLimits(
  checks: ReadonlyArray<readonly [RateLimitRule, string | null]>,
  nowMs = Date.now(),
): Promise<RateLimitResult> {
  for (const [rule, subject] of checks) {
    if (subject === null) continue;
    const result = await consumeRateLimit(rule, subject, nowMs);
    if (!result.allowed) return result;
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function tooManyRequests(retryAfterSec: number): Response {
  return Response.json(
    { error: "Слишком много попыток. Попробуйте позже." },
    {
      status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSec) },
    },
  );
}
