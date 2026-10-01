/**
 * Server-side check of a public @username via its t.me preview page — no Telegram account is spent.
 * A joinable chat/channel shows «N members» / «N subscribers»; a missing username (and a user or bot,
 * which we cannot join either) shows a «Contact @x» / «Send Message» page without that line.
 */

import { extractTelegramUsername } from "@/lib/group-catalog";

export type TmeProbeResult = "live" | "dead" | "unknown";

const TME_PAGE_RE = /class="tgme_page[\s"_]|property="og:title"/i;
const AUDIENCE_LINE_RE = /class="tgme_page_extra"[^>]*>[^<]*\b(?:members?|subscribers?)\b/i;

/** True only for a recognisable t.me preview page without a members/subscribers line. */
export function isDeadTmePage(html: string): boolean {
  const page = String(html || "");
  if (!TME_PAGE_RE.test(page)) return false;
  return !AUDIENCE_LINE_RE.test(page);
}

/** Copy for a username that t.me confirms does not exist (replaces the worker's «Слот не видит …»). */
export function tmeMissingMessage(username: string): string {
  return `Чат @${username} не существует в Telegram`;
}

/** Public @username of a group link; null for invite links and anything else t.me cannot preview. */
export function probeableUsername(url: string): string | null {
  return extractTelegramUsername(String(url || ""));
}

export type TmeFetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

export const TME_PROBE_TIMEOUT_MS = 8000;

/**
 * Probe one username: «dead» only on a parsed t.me page that says so; network errors, non-200 and
 * unrecognisable pages are «unknown» (never a reason to drop a group). One retry on failure.
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
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (!TME_PAGE_RE.test(html)) continue;
      return isDeadTmePage(html) ? "dead" : "live";
    } catch {
      // network/timeout: retry once, then «unknown»
    }
  }
  return "unknown";
}
