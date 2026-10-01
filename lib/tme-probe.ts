/**
 * Server-side check of a public @username via its t.me preview page — no Telegram account is spent.
 *
 * Rule (from real pages, 2026-10-01):
 * - live: a `tgme_page_extra` line with «N members» / «N subscribers» (chat, channel);
 * - dead: no such line and the action button is a DM — «Send Message» (missing username: «Contact @x»
 *   page without title/extra; or a user) or «Start Bot» (bot). Nothing there to join;
 * - unknown: everything else — no tgme_page markup (og:title alone is not enough), another button
 *   («View Chats» on addlist, «View in Telegram» on a restricted/scam channel without a count),
 *   non-200, redirects, network errors. Unknown never drops a group.
 */

import { extractTelegramUsername } from "@/lib/group-catalog";

export type TmeProbeResult = "live" | "dead" | "unknown";

const TME_MARKUP_RE = /class="(?:tgme_page_title|tgme_action_button[\w-]*|tgme_page_extra)[\s"]/i;
const AUDIENCE_LINE_RE = /class="tgme_page_extra"[^>]*>[^<]*\b(?:members?|subscribers?)\b/i;
const DM_BUTTON_RE = /class="tgme_action_button[^"]*"[^>]*>\s*(?:Send Message|Start Bot)\s*</i;

/** First path segments of t.me that are not usernames (folders, share, proxy, stickers, …). */
const RESERVED_SEGMENTS = new Set([
  "addlist",
  "share",
  "iv",
  "proxy",
  "socks",
  "addstickers",
  "addemoji",
  "joinchat",
  "c",
  "s",
  "contact",
  "login",
  "setlanguage",
]);

export function classifyTmePage(html: string): TmeProbeResult {
  const page = String(html || "");
  if (!TME_MARKUP_RE.test(page)) return "unknown";
  if (AUDIENCE_LINE_RE.test(page)) return "live";
  return DM_BUTTON_RE.test(page) ? "dead" : "unknown";
}

/** True only for a t.me page that positively shows nothing joinable (see the rule above). */
export function isDeadTmePage(html: string): boolean {
  return classifyTmePage(html) === "dead";
}

/** Copy for a username that t.me confirms does not exist (replaces the worker's «Слот не видит …»). */
export function tmeMissingMessage(username: string): string {
  return `Чат @${username} не существует в Telegram`;
}

/** Public @username of a group link; null for invite links, reserved t.me paths and anything else. */
export function probeableUsername(url: string): string | null {
  const u = String(url || "").trim();
  const first = /(?:^|\/\/|^)(?:www\.)?(?:t\.me|telegram\.me)\/([^/?#]+)/i.exec(u)?.[1]?.toLowerCase();
  if (first && RESERVED_SEGMENTS.has(first)) return null;
  const username = extractTelegramUsername(u);
  return username && !RESERVED_SEGMENTS.has(username) ? username : null;
}

/** An «unknown» probe (network, rate limit) is retried no sooner than this. */
export const TME_UNKNOWN_RETRY_MS = 30 * 60_000;

export type TmeProbeState = { tmeProbe?: unknown; tmeProbeAt?: unknown };

/** Probe needed: never probed, or the last answer was «unknown» long enough ago. Live/dead are final. */
export function tmeProbeDue(group: TmeProbeState, now = Date.now()): boolean {
  if (group.tmeProbe === "live" || group.tmeProbe === "dead") return false;
  const at = Date.parse(String(group.tmeProbeAt || ""));
  return !Number.isFinite(at) || now - at >= TME_UNKNOWN_RETRY_MS;
}

export type TmeFetch = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string>; redirect: "manual" },
) => Promise<Response>;

export const TME_PROBE_TIMEOUT_MS = 8000;
export const TME_PROBE_MAX_BYTES = 256 * 1024;

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, maxBytes - bytes);
      bytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}

/**
 * Probe one username. Redirects are not followed (3xx → unknown); only network errors are retried
 * (`attempts`, default 2). The body is read up to TME_PROBE_MAX_BYTES.
 */
export async function probeTmeUsername(
  username: string,
  opts: { fetchImpl?: TmeFetch; timeoutMs?: number; attempts?: number } = {},
): Promise<TmeProbeResult> {
  const fetchImpl: TmeFetch = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const attempts = Math.max(1, opts.attempts ?? 2);
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchImpl(`https://t.me/${encodeURIComponent(username)}`, {
        signal: AbortSignal.timeout(opts.timeoutMs ?? TME_PROBE_TIMEOUT_MS),
        headers: { "Accept-Language": "en", "User-Agent": "Mozilla/5.0 (compatible; UniLabProbe/1.0)" },
        redirect: "manual",
      });
      if (res.status !== 200) {
        void res.body?.cancel().catch(() => undefined);
        return "unknown";
      }
      return classifyTmePage(await readCapped(res, TME_PROBE_MAX_BYTES));
    } catch {
      // network/timeout: retry, then «unknown»
    }
  }
  return "unknown";
}
