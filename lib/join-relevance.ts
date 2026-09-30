/**
 * Relevance gate before joining a Telegram group (docs/join-pipeline.md).
 *
 * A group is scored 0–100 against the product settings from what we know without joining it:
 * title, @username, catalog niches/description/audience/subscribers, source (TGStat = broadcast channel).
 * Bands: auto (join by itself) · review (owner approves in UI) · skip (not joined, reversible).
 * Joined groups are never touched by the gate.
 */

import {
  GROUP_CATALOG,
  GROUP_NICHE_LABELS,
  NICHE_ALIASES,
  extractTelegramUsername,
  type CatalogGroup,
  type GroupNiche,
} from "@/lib/group-catalog";
import { hasAssistantFitConfig, workerKeywordsFromSettings, type LeadCoreSettings } from "@/lib/lead-core";
import { findMinusHit, splitTerms } from "@/lib/lead-filter";
import { scanStopTerms } from "@/lib/lead-stopwords";

/** Bump when the formula changes: stored scores with another version are recomputed. */
export const JOIN_RELEVANCE_VERSION = 2;
export const RELEVANCE_AUTO_MIN = 60;
export const RELEVANCE_REVIEW_MIN = 35;

export type RelevanceBand = "auto" | "review" | "skip";

export type GroupRelevance = {
  v: number;
  /** Settings signature the score was computed for. */
  sig: string;
  score: number;
  band: RelevanceBand;
  reasons: string[];
  members: number;
  at: string;
};

export type RelevanceSettings = LeadCoreSettings & { audience?: string };

export type RelevanceGroup = {
  name?: string;
  url?: string;
  source?: string;
  about?: string;
  description?: string;
  /** Leads already collected from this group (a scan before, or a previous membership). */
  leadsTotal?: number;
};

/** Niches too wide to prove a topic match (every blog is «business/marketing»). */
const BROAD_NICHES = new Set<GroupNiche>([
  "blogs",
  "business",
  "marketing",
  "smm",
  "content",
  "leadgen",
  "startup",
  "networking",
  "freelance",
  "education",
  "b2b",
  "design",
  "hr",
]);

const BASE_SCORE = 25;
const NICHE_POINTS = 12;
const NICHE_MAX = 36;
const STRONG_POINTS = 14;
const STRONG_MAX = 42;
const WEAK_POINTS = 6;
const WEAK_MAX = 12;
const CHAT_POINTS = 12;
const CHANNEL_PENALTY = 15;
const BLOG_PENALTY = 10;
const OFF_NICHE_PENALTY = 20;
const STOP_PENALTY = 30;
const TINY_PENALTY = 5;
const LEADS_POINTS = 20;
const LEADS_MANY_POINTS = 30;
const LEADS_MANY = 5;
const TINY_MEMBERS = 300;
/** Without any topical evidence a group never reaches the review band by format alone. */
const NO_TOPIC_CAP = 30;

const CHAT_RE = /(^|[^\p{L}])(чат|chat|группа|сообществ|форум|community|взаимопомощ)/iu;
const CHAT_USERNAME_RE = /(chat|group|talk|forum|community)/i;
const BLOG_RE = /(^|[^\p{L}])(блог|blog|подкаст|podcast|медиа|media|новости|news|журнал)/iu;
const TGSTAT_CHANNEL_RE = /канал из tgstat/i;
const MEMBERS_RE = /\(([\d\s ]+)\s*(subscribers|подписчик|участник)/i;

function norm(s: string): string {
  return String(s || "").toLowerCase().replace(/ё/g, "е");
}

function words(s: string): string[] {
  return norm(s)
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
}

/** Stem = word prefix, so «остатки» matches «остатков»; short tokens (wb, 1с) must match whole. */
function stemOf(word: string): string {
  if (word.length <= 4) return word;
  if (word.length <= 6) return word.slice(0, word.length - 1);
  return word.slice(0, word.length - 2);
}

/** stems[i] = prefix to match, maxLen[i] = longest token accepted (inflection, not a longer word). */
type Term = { raw: string; stems: string[]; maxLen: number[] };

function toTerm(raw: string): Term | null {
  const w = words(raw).filter((x) => x.length >= 2);
  if (!w.length) return null;
  return {
    raw: norm(raw).trim(),
    stems: w.map(stemOf),
    // «маркет» → маркета/маркету, never «маркетинг»; long stems (аналитик) may take a longer ending.
    maxLen: w.map((x) => x.length + (x.length <= 6 ? 2 : 4)),
  };
}

function textHasTerm(tokens: string[], term: Term): boolean {
  const n = term.stems.length;
  for (let i = 0; i + n <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      const tok = tokens[i + j]!;
      const stem = term.stems[j]!;
      const whole = stem.length <= 3;
      if (whole ? tok !== stem : !tok.startsWith(stem) || tok.length > term.maxLen[j]!) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** Usernames are glued (wbozsellers): latin stems ≥4 chars match anywhere, short ones only at the start. */
function usernameHasTerm(username: string, term: Term): boolean {
  if (!username || term.stems.length !== 1) return false;
  const stem = term.stems[0]!;
  if (!/^[a-z0-9]+$/.test(stem)) return false;
  if (stem.length >= 4) return username.includes(stem);
  return stem.length >= 2 && (username.startsWith(stem) || username.endsWith(stem));
}

const CATALOG_BY_USERNAME: Map<string, CatalogGroup> = (() => {
  const m = new Map<string, CatalogGroup>();
  for (const g of GROUP_CATALOG) {
    const u = extractTelegramUsername(g.url || "");
    // The first entry wins: topic placeholders reuse real URLs further down the catalog.
    if (u && !m.has(u)) m.set(u, g);
  }
  return m;
})();

export function catalogEntryFor(url: string): CatalogGroup | null {
  const u = extractTelegramUsername(url || "");
  return u ? CATALOG_BY_USERNAME.get(u) || null : null;
}

export function membersFromText(text: string): number {
  const m = MEMBERS_RE.exec(text || "");
  if (!m) return 0;
  const n = Number(m[1]!.replace(/[\s ]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export type RelevanceProfile = {
  configured: boolean;
  sig: string;
  strong: Term[];
  weak: Term[];
  niches: Set<GroupNiche>;
  stop: string[];
};

/** Alias that is a whole short word (wb, озон, авто) may only take an inflection ending, not a longer word. */
function aliasMatchesToken(alias: string, tok: string): boolean {
  if (alias.length <= 4) return tok === alias || (tok.startsWith(alias) && tok.length <= alias.length + 2);
  return tok.startsWith(alias);
}

function aliasInTokens(alias: string, tokens: string[]): boolean {
  const parts = words(alias);
  if (!parts.length) return false;
  for (let i = 0; i + parts.length <= tokens.length; i++) {
    if (parts.every((p, j) => aliasMatchesToken(p, tokens[i + j]!))) return true;
  }
  return false;
}

/** Aliases too generic to prove a group is on-topic even when their niche is ours. */
const GENERIC_ALIASES = new Set(["сервис", "telegram", "автоматиз", "интеграц", "бот", "чат-бот", "цен", "сервисы"]);

/** Product niches by word-start alias match («автоматизация» must not mean «авто»). */
export function productNiches(text: string): Set<GroupNiche> {
  const tokens = words(text);
  const out = new Set<GroupNiche>();
  for (const [alias, list] of Object.entries(NICHE_ALIASES)) {
    if (!aliasInTokens(alias, tokens)) continue;
    for (const n of list) if (!BROAD_NICHES.has(n)) out.add(n);
  }
  return out;
}

function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Terms and niches the product is about; signature changes whenever the inputs change. */
export function buildRelevanceProfile(settings: RelevanceSettings): RelevanceProfile {
  const core: LeadCoreSettings = {
    keywords: settings.keywords || "",
    hotSignals: settings.hotSignals || "",
    leadCriteria: settings.leadCriteria || "",
    product: settings.product || "",
    minusKeywords: settings.minusKeywords || "",
    avoidTopics: settings.avoidTopics || "",
  };
  const sig = hashText(
    JSON.stringify([
      JOIN_RELEVANCE_VERSION,
      core.keywords,
      core.hotSignals,
      core.leadCriteria,
      core.product,
      settings.audience || "",
      core.minusKeywords,
      core.avoidTopics,
    ]),
  );
  const configured = hasAssistantFitConfig(core) || String(settings.audience || "").trim().length > 10;
  const nicheText = [core.product, core.keywords, core.hotSignals, core.leadCriteria, settings.audience].join(" ");
  const niches = productNiches(nicheText);

  const seen = new Set<string>();
  const strong: Term[] = [];
  const weak: Term[] = [];
  const add = (list: Term[], raw: string) => {
    const t = toTerm(raw);
    if (!t || seen.has(t.raw)) return;
    seen.add(t.raw);
    list.push(t);
  };
  // Explicit settings first: keywords, hot signals, audience phrases and single audience words.
  const workerTerms = workerKeywordsFromSettings(core);
  const explicit = new Set([...splitTerms(core.keywords || ""), ...splitTerms(core.hotSignals || "")]);
  for (const t of workerTerms) if (explicit.has(t)) add(strong, t);
  for (const t of splitTerms(String(settings.audience || "").replace(/[;.]/g, ","))) add(strong, t);
  for (const w of words(settings.audience || "")) if (w.length >= 4) add(strong, w);
  // Everyday names of the product's own niches (wb, озон, селлер, мойсклад, 1с …).
  for (const [alias, list] of Object.entries(NICHE_ALIASES)) {
    if (GENERIC_ALIASES.has(alias) || !niches.has(list[0]!)) continue;
    add(strong, alias);
  }
  for (const t of workerTerms) if (!explicit.has(t)) add(weak, t);

  const stop = scanStopTerms(core);
  return { configured, sig, strong: strong.slice(0, 80), weak: weak.slice(0, 40), niches, stop };
}

function bandOf(score: number): RelevanceBand {
  if (score >= RELEVANCE_AUTO_MIN) return "auto";
  if (score >= RELEVANCE_REVIEW_MIN) return "review";
  return "skip";
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Score one group. Pure: same group + profile → same result (except `at`). */
export function scoreGroupRelevance(
  group: RelevanceGroup,
  profile: RelevanceProfile,
  now = new Date(),
): GroupRelevance {
  const catalog = catalogEntryFor(group.url || "");
  const username = extractTelegramUsername(group.url || "") || "";
  const description = [group.description, group.about, catalog?.description].filter(Boolean).join(" ");
  const members = membersFromText(description);
  const at = now.toISOString();
  if (!profile.configured) {
    return {
      v: JOIN_RELEVANCE_VERSION,
      sig: profile.sig,
      score: 50,
      band: "auto",
      reasons: ["настройки продукта не заданы — фильтр выключен"],
      members,
      at,
    };
  }
  const name = String(group.name || "");
  const tokens = words([name, catalog?.name, catalog?.audience, description].filter(Boolean).join(" "));
  const reasons: string[] = [];
  let score = BASE_SCORE;

  const groupNiches = catalog?.niches || [];
  // Outside the catalog the title is all we have: infer niches from it (wb → Wildberries, Маркетплейсы).
  const inferred = catalog ? [] : [...productNiches(`${name} ${username.replace(/_/g, " ")}`)];
  const nicheHits = [...new Set([...groupNiches, ...inferred])].filter((n) => profile.niches.has(n));
  if (nicheHits.length) {
    score += Math.min(NICHE_MAX, nicheHits.length * NICHE_POINTS);
    reasons.push(`ниша: ${nicheHits.slice(0, 3).map((n) => GROUP_NICHE_LABELS[n]).join(", ")}`);
  }

  const strongHits = profile.strong
    .filter((t) => textHasTerm(tokens, t) || usernameHasTerm(username, t))
    .map((t) => t.raw);
  if (strongHits.length) {
    score += Math.min(STRONG_MAX, strongHits.length * STRONG_POINTS);
    reasons.push(`совпадения: ${strongHits.slice(0, 4).join(", ")}`);
  }
  const weakHits = profile.weak.filter((t) => textHasTerm(tokens, t)).map((t) => t.raw);
  if (weakHits.length) {
    score += Math.min(WEAK_MAX, weakHits.length * WEAK_POINTS);
    reasons.push(`слова продукта: ${weakHits.slice(0, 3).join(", ")}`);
  }
  // Evidence beats guessing: a group that already produced leads is on-topic whatever its title says.
  const leads = Math.max(0, Number(group.leadsTotal) || 0);
  if (leads > 0) {
    score += leads >= LEADS_MANY ? LEADS_MANY_POINTS : LEADS_POINTS;
    reasons.unshift(`уже давала лиды: ${leads}`);
  }
  const topical = nicheHits.length > 0 || strongHits.length > 0 || leads > 0;

  const isChannel = String(group.source || "").startsWith("tgstat") || TGSTAT_CHANNEL_RE.test(description);
  const isChat = !isChannel && (CHAT_RE.test(name) || CHAT_USERNAME_RE.test(username));
  if (isChat) {
    score += CHAT_POINTS;
    reasons.push("чат: участники пишут сами");
  }
  if (isChannel) {
    score -= CHANNEL_PENALTY;
    reasons.push("канал: лиды только в комментариях");
  }
  const isBlog = BLOG_RE.test(name);
  if (isBlog) {
    score -= BLOG_PENALTY;
    reasons.push("блог/медиа");
  }
  if (groupNiches.length && !nicheHits.length && !strongHits.length) {
    score -= OFF_NICHE_PENALTY;
    const labels = groupNiches.filter((n) => n !== "blogs").slice(0, 2).map((n) => GROUP_NICHE_LABELS[n]);
    reasons.push(`не ваша ниша${labels.length ? `: ${labels.join(", ")}` : ""}`);
  }
  if (!strongHits.length) {
    const stopHit = findMinusHit(name, profile.stop);
    if (stopHit) {
      score -= STOP_PENALTY;
      reasons.push(`стоп-слово: ${stopHit}`);
    }
  }
  if (members > 0 && members < TINY_MEMBERS) {
    score -= TINY_PENALTY;
    reasons.push(`мало участников: ${members}`);
  }
  if (!topical) {
    score = Math.min(score, NO_TOPIC_CAP);
    reasons.unshift("нет признаков вашей ниши в названии/описании");
  } else if ((isChannel || isBlog) && score >= RELEVANCE_AUTO_MIN) {
    // Broadcast channels and blogs give few leads even on-topic: the owner decides, never auto.
    score = RELEVANCE_AUTO_MIN - 1;
  }
  const final = clamp(score);
  return {
    v: JOIN_RELEVANCE_VERSION,
    sig: profile.sig,
    score: final,
    band: bandOf(final),
    reasons: reasons.slice(0, 5),
    members,
    at,
  };
}

export function isRelevanceStale(stored: unknown, profile: RelevanceProfile): boolean {
  const r = stored as Partial<GroupRelevance> | null | undefined;
  return !r || r.v !== JOIN_RELEVANCE_VERSION || r.sig !== profile.sig || !Number.isFinite(Number(r.score));
}

export type JoinDecision = "" | "approved" | "skipped";

export type JoinGateGroup = RelevanceGroup & {
  membership?: string;
  status?: string;
  joinedAt?: string;
  joinDecision?: string;
  joinDead?: boolean;
  /** Was a member; membership was reset by an account swap — restoring it is not a new join decision. */
  joinRejoin?: boolean;
  joinRelevance?: unknown;
};

export type JoinGateState = "joined" | "approved" | "auto" | "review" | "skip" | "skipped" | "dead";

export type JoinGate = {
  allow: boolean;
  state: JoinGateState;
  label: string;
  reason: string;
  score: number | null;
};

export const JOIN_GATE_LABELS: Record<JoinGateState, string> = {
  joined: "Вступили",
  approved: "Одобрена",
  auto: "Авто",
  review: "На подтверждение",
  skip: "Не вступать",
  skipped: "Пропущена",
  dead: "Ссылка мертва",
};

function groupIsMember(g: JoinGateGroup): boolean {
  return g.membership === "joined" || g.membership === "pending" || g.status === "pending" || !!g.joinedAt;
}

/**
 * May the auto-queue join this group? Owner decisions beat the score; a missing score
 * (never rescored yet) parks the group for review instead of joining blind.
 */
export function joinGateFor(group: JoinGateGroup): JoinGate {
  const rel = group.joinRelevance as Partial<GroupRelevance> | undefined;
  const score = rel && Number.isFinite(Number(rel.score)) ? Number(rel.score) : null;
  const reason = Array.isArray(rel?.reasons) ? rel!.reasons!.join(" · ") : "";
  const gate = (allow: boolean, state: JoinGateState, why = reason): JoinGate => ({
    allow,
    state,
    label: JOIN_GATE_LABELS[state],
    reason: why,
    score,
  });
  if (groupIsMember(group)) return gate(true, "joined", "");
  if (group.joinDead) return gate(false, "dead", "Несколько аккаунтов не видят @username — проверьте ссылку");
  if (group.joinDecision === "skipped") return gate(false, "skipped", "пропущено вручную");
  if (group.joinRejoin) return gate(true, "joined", "восстановление членства после смены аккаунта");
  if (group.joinDecision === "approved") return gate(true, "approved", "одобрено вручную");
  if (score == null) return gate(false, "review", "ещё не оценена");
  const band = rel?.band === "auto" || rel?.band === "review" || rel?.band === "skip" ? rel.band : bandOf(score);
  return gate(band === "auto", band);
}

/** Queue order: owner-approved first, then score, then audience size, then name. */
export function joinPriority(group: JoinGateGroup): number {
  const rel = group.joinRelevance as Partial<GroupRelevance> | undefined;
  const score = Number(rel?.score) || 0;
  return score + (group.joinDecision === "approved" ? 100 : 0);
}

export function compareJoinPriority(a: JoinGateGroup, b: JoinGateGroup): number {
  const d = joinPriority(b) - joinPriority(a);
  if (d) return d;
  const ma = Number((a.joinRelevance as Partial<GroupRelevance> | undefined)?.members) || 0;
  const mb = Number((b.joinRelevance as Partial<GroupRelevance> | undefined)?.members) || 0;
  if (mb !== ma) return mb - ma;
  return String(a.name || "").localeCompare(String(b.name || ""), "ru");
}

/**
 * Migration: a group that was joined before (joinedAccountId is written only on join/request) but lost
 * its membership to an old account swap keeps bypassing the gate. Same object when nothing changes.
 */
export function seedRejoin<T extends JoinGateGroup & { joinedAccountId?: string }>(group: T): T {
  if (group.joinRejoin || group.joinDead || groupIsMember(group) || !String(group.joinedAccountId || "")) return group;
  return { ...group, joinRejoin: true };
}

export type RescorePatch = {
  joinRelevance: GroupRelevance;
  /** Parked groups leave the auto-queue (state cleared), everything else keeps its state. */
  clearQueue: boolean;
};

/**
 * Recompute the score of one group. Returns null when nothing changes (member, or fresh score
 * and not forced). Never touches joined groups.
 */
export function rescoreGroup(
  group: JoinGateGroup & { joinState?: string },
  profile: RelevanceProfile,
  opts: { force?: boolean; now?: Date } = {},
): RescorePatch | null {
  // Rejoins are scored too (queue order, UI) — the gate lets them through regardless.
  if (groupIsMember(group)) return null;
  if (!opts.force && !isRelevanceStale(group.joinRelevance, profile)) return null;
  const joinRelevance = scoreGroupRelevance(group, profile, opts.now);
  const gate = joinGateFor({ ...group, joinRelevance });
  const queued = String(group.joinState || "") === "queued" || String(group.joinState || "") === "waiting";
  return { joinRelevance, clearQueue: queued && !gate.allow };
}
