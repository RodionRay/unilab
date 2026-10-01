/**
 * Cheap filters before the judge (REQ-6). Only provably useless messages are dropped, in this order:
 * empty `tgMsgId` → older than `scanDepthDays` → text < 12 chars → duplicate → stop word. Each drop is
 * counted and keeps ≤3 samples. No product/intent heuristics here (REQ-7).
 */

import { leadMessageFingerprint, normalizeLeadMessage } from "@/lib/lead-filter";
import { addSample } from "@/lib/leads/funnel";
import { MESSAGE_KINDS, type FunnelSamples, type MessageKind, type ScanMessage } from "@/lib/leads/types";

export const MIN_TEXT_LENGTH = 12;
export const MIN_STOP_WORD_LENGTH = 3;
export const MAX_STOP_WORD_LENGTH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const SAME_TEXT_KEY_LENGTH = 500;

export type FilterContext = {
  now: number;
  scanDepthDays: number;
  /** Fingerprint scope (`leadMessageFingerprint` group id); "" for DMs. */
  groupId: string;
  knownFingerprints: ReadonlySet<string>;
  /** Senders that already are leads (DM pass): their messages are duplicates. */
  knownSenderIds?: ReadonlySet<string>;
  /** `tgMsgId`s of leads the user deleted (REQ-L6). */
  tombstones: Iterable<string>;
  /** Active AI-reject memory keyed by `tgMsgId`. */
  aiRejects: Readonly<Record<string, string>>;
  stopWords: readonly string[];
};

export type FilterCounts = {
  skippedErrorApp: number;
  old: number;
  short: number;
  duplicate: number;
  stopword: number;
};

export type FilterResult = { passed: ScanMessage[]; counts: FilterCounts; samples: FunnelSamples };

type Drop = { step: keyof FilterCounts; term?: string; reason?: string };

function str(v: unknown, max = 8000): string {
  return v === null || v === undefined ? "" : String(v).slice(0, max);
}

/** Coerces one worker message; unknown `messageKind` becomes "". */
export function normalizeScanMessage(raw: unknown): ScanMessage {
  const m = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kind = str(m.messageKind);
  return {
    tgMsgId: str(m.tgMsgId, 40).trim(),
    message: str(m.message),
    name: str(m.name, 200),
    date: str(m.date, 40),
    senderId: str(m.senderId, 40),
    senderUsername: str(m.senderUsername, 64),
    senderAccessHash: str(m.senderAccessHash, 40),
    messageKind: (MESSAGE_KINDS as readonly string[]).includes(kind) ? (kind as MessageKind) : "",
    peerId: str(m.peerId, 40),
    replyToMsgId: str(m.replyToMsgId, 40),
  };
}

function normalizeYo(text: string): string {
  return text.replace(/ё/g, "е").replace(/Ё/g, "Е");
}

const patternCache = new Map<string, RegExp>();

function stopWordPattern(term: string): RegExp {
  const cached = patternCache.get(term);
  if (cached) return cached;
  const phrase = term
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  // Word-start match: "нал" must not hit "канал", "bot" must not hit "robot".
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${phrase}`, "iu");
  if (patternCache.size > 2000) patternCache.clear();
  patternCache.set(term, re);
  return re;
}

/** First stop word found at a word start (phrases as phrases, ё = е, case-insensitive), else "". */
export function findStopWord(text: string, stopWords: readonly string[]): string {
  const body = normalizeYo(text || "");
  for (const raw of stopWords) {
    const term = normalizeYo(String(raw || "").trim().toLowerCase());
    if (term.length < MIN_STOP_WORD_LENGTH || term.length > MAX_STOP_WORD_LENGTH) continue;
    if (stopWordPattern(term).test(body)) return term;
  }
  return "";
}

function isOld(date: string, cutoff: number): boolean {
  if (!date) return false;
  const t = Date.parse(date);
  return Number.isFinite(t) && t < cutoff;
}

/** Applies REQ-6 in order; `seen` collects fingerprints and sender+text keys of this run. */
function dropOf(m: ScanMessage, ctx: FilterContext, cutoff: number, tombstones: Set<string>, seen: Set<string>): Drop | null {
  if (!m.tgMsgId) return { step: "skippedErrorApp", reason: "empty_id" };
  if (isOld(m.date, cutoff)) return { step: "old" };
  if (m.message.trim().length < MIN_TEXT_LENGTH) return { step: "short" };
  const fp = leadMessageFingerprint(m.message, ctx.groupId, m.tgMsgId);
  if (ctx.knownFingerprints.has(fp)) return { step: "duplicate", reason: "known" };
  if (m.senderId && ctx.knownSenderIds?.has(m.senderId)) return { step: "duplicate", reason: "known_sender" };
  if (tombstones.has(m.tgMsgId)) return { step: "duplicate", reason: "tombstone" };
  if (ctx.aiRejects[m.tgMsgId]) return { step: "duplicate", reason: "ai_reject" };
  const sameText = `${m.senderId || m.name}\u0001${normalizeLeadMessage(m.message, SAME_TEXT_KEY_LENGTH)}`;
  if (seen.has(fp) || seen.has(sameText)) return { step: "duplicate", reason: "repeat" };
  seen.add(fp);
  seen.add(sameText);
  const term = findStopWord(m.message, ctx.stopWords);
  if (term) return { step: "stopword", term };
  return null;
}

export function filterMessages(messages: readonly ScanMessage[], ctx: FilterContext): FilterResult {
  const cutoff = ctx.now - ctx.scanDepthDays * DAY_MS;
  const tombstones = new Set(Array.from(ctx.tombstones, String));
  const seen = new Set<string>();
  const counts: FilterCounts = { skippedErrorApp: 0, old: 0, short: 0, duplicate: 0, stopword: 0 };
  const samples: FunnelSamples = {};
  const passed: ScanMessage[] = [];
  for (const m of messages) {
    const drop = dropOf(m, ctx, cutoff, tombstones, seen);
    if (!drop) {
      passed.push(m);
      continue;
    }
    counts[drop.step]++;
    addSample(samples, drop.step, { text: m.message, ...(drop.term ? { term: drop.term } : {}), ...(drop.reason ? { reason: drop.reason } : {}) });
  }
  return { passed, counts, samples };
}
