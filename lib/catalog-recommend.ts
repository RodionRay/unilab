/**
 * «Найти чаты с клиентами»: the dialog shows only chats we recommend joining for this project, and the chats
 * we are already in, each in exactly one list. Which workspace group is «recommended» is decided by an injected
 * gate (the relevance gate where the workspace stores relevance, a project-niche fallback otherwise), so this
 * module owns the split, ordering and copy, not the scoring.
 */
import {
  GROUP_CATALOG,
  GROUP_NICHE_LABELS,
  extractTelegramUsername,
  isCatalogPlaceholderUrl,
  nichesFromProjectText,
  type CatalogGroup,
  type GroupNiche,
} from "@/lib/group-catalog";
import { telegramEntityKey } from "@/lib/record-identity";

/** Gate states as stored by the join-relevance gate; anything else counts as «not recommended». */
export type RecommendGate = { state: string; reason?: string; score?: number | null };
export type GroupData = Record<string, unknown>;
export type GroupRecordLike = { id: string; data: GroupData };

/** join = owner can queue it; queued = owner already queued it; joining = worker is joining right now. */
export type RecommendStatus = "join" | "queued" | "joining";

export type RecommendedRow = {
  key: string;
  /** workspace = a group record (id = record id); catalog = a catalog chat not in the workspace (id = catalog id). */
  source: "workspace" | "catalog";
  id: string;
  name: string;
  url: string;
  handle: string | null;
  subscribers: number | null;
  reason: string;
  status: RecommendStatus;
  score: number | null;
};

export type JoinedRow = {
  key: string;
  id: string;
  name: string;
  url: string;
  handle: string | null;
  /** Join request sent, not a member yet. */
  pending: boolean;
  leadsTotal: number;
  lastScanned: string;
};

export type RecommendedView = {
  /** Actionable rows first (workspace by score, then catalog chats), then rows already queued or joining. */
  recommended: RecommendedRow[];
  joined: JoinedRow[];
  /** Not-joined workspace groups the gate does not recommend (review / skip / dead). */
  hiddenCount: number;
};

const RECOMMENDED_STATES = new Set(["auto", "approved"]);
const QUEUED_JOIN_STATES = new Set(["queued", "waiting"]);
const RUNNING_JOIN_STATES = new Set(["joining"]);
const STATUS_ORDER: Record<RecommendStatus, number> = { join: 0, queued: 1, joining: 2 };

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

function isMember(d: GroupData): boolean {
  return d.membership === "joined" || d.membership === "pending" || d.status === "pending" || !!d.joinedAt;
}

function isPending(d: GroupData): boolean {
  return (d.membership === "pending" || d.status === "pending") && d.membership !== "joined";
}

/** A catalog entry the user can join right away (real public t.me link). */
export function isJoinableCatalogItem(item: Pick<CatalogGroup, "verified" | "url">): boolean {
  return item.verified && !!item.url && !isCatalogPlaceholderUrl(item.url);
}

const CATALOG_BY_KEY: ReadonlyMap<string, CatalogGroup> = new Map(
  GROUP_CATALOG.filter((g) => g.url)
    .map((g) => [telegramEntityKey(g.url), g] as const)
    .filter(([k]) => k)
    .reverse(),
);

function rowStatus(d: GroupData, gateState: string): RecommendStatus {
  const js = str(d.joinState);
  if (RUNNING_JOIN_STATES.has(js)) return "joining";
  if (QUEUED_JOIN_STATES.has(js) || gateState === "approved") return "queued";
  return "join";
}

function matchesQuery(q: string, ...fields: (string | null)[]): boolean {
  return !q || fields.some((f) => !!f && f.toLowerCase().includes(q));
}

export function buildRecommendedView(opts: {
  groups: readonly GroupRecordLike[];
  catalog: readonly CatalogGroup[];
  gateOf: (data: GroupData) => RecommendGate;
  query?: string;
}): RecommendedView {
  const q = (opts.query || "").trim().toLowerCase();
  const seen = new Set<string>();
  const recommended: RecommendedRow[] = [];
  const joined: JoinedRow[] = [];
  let hiddenCount = 0;

  for (const g of opts.groups) {
    const d = g.data || {};
    const url = str(d.url);
    const key = telegramEntityKey(url) || `id:${g.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = str(d.name) || "Без названия";
    const meta = catalogRowMeta({ url, description: CATALOG_BY_KEY.get(key)?.description || "" });
    if (isMember(d)) {
      if (matchesQuery(q, name, meta.handle, url)) {
        joined.push({
          key,
          id: g.id,
          name,
          url,
          handle: meta.handle,
          pending: isPending(d),
          leadsTotal: Number(d.leadsTotal) || 0,
          lastScanned: str(d.lastScanned),
        });
      }
      continue;
    }
    const gate = opts.gateOf(d);
    if (!RECOMMENDED_STATES.has(gate.state)) {
      hiddenCount++;
      continue;
    }
    if (!matchesQuery(q, name, meta.handle, url)) continue;
    const relevance = d.joinRelevance as { members?: unknown } | undefined;
    const members = Number(relevance?.members) || 0;
    recommended.push({
      key,
      source: "workspace",
      id: g.id,
      name,
      url,
      handle: meta.handle,
      subscribers: members > 0 ? members : meta.subscribers,
      reason: gate.reason || "",
      status: rowStatus(d, gate.state),
      score: gate.score ?? null,
    });
  }

  const catalogRows: RecommendedRow[] = [];
  for (const c of opts.catalog) {
    if (!isJoinableCatalogItem(c)) continue;
    const key = telegramEntityKey(c.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const meta = catalogRowMeta(c);
    if (!matchesQuery(q, c.name, meta.handle, c.url)) continue;
    // The gate knows why this chat fits the project (matched niches); the chat's own niches are the fallback.
    const gate = opts.gateOf({ url: c.url });
    catalogRows.push({
      key,
      source: "catalog",
      id: c.id,
      name: c.name,
      url: c.url,
      handle: meta.handle,
      subscribers: meta.subscribers,
      reason: gate.reason || c.niches.slice(0, 2).map((n) => GROUP_NICHE_LABELS[n]).join(", "),
      status: "join",
      score: gate.score ?? null,
    });
  }
  // Closest fit first; equal fit keeps catalog (rank) order (Array.prototype.sort is stable).
  catalogRows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const byRank = (a: RecommendedRow, b: RecommendedRow) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    (b.score ?? -1) - (a.score ?? -1) ||
    a.name.localeCompare(b.name, "ru");
  recommended.sort(byRank);
  // Catalog rows follow the workspace rows: the owner's own groups first, then new chats by fit.
  const actionable = recommended.filter((r) => r.status === "join");
  const inFlight = recommended.filter((r) => r.status !== "join");
  joined.sort((a, b) => Number(a.pending) - Number(b.pending) || b.leadsTotal - a.leadsTotal || a.name.localeCompare(b.name, "ru"));

  return { recommended: [...actionable, ...catalogRows, ...inFlight], joined, hiddenCount };
}

/**
 * Gate for workspaces without stored relevance scores: a group is recommended when its chat is one of the
 * project-niche catalog chats; score = how many project niches the chat matches (orders rows, closest fit first).
 * Owner decisions and a stored relevance band win, same order as the relevance gate.
 */
export function nicheFallbackGate(
  candidates: readonly CatalogGroup[],
  projectNiches: readonly GroupNiche[],
): (data: GroupData) => RecommendGate {
  const wanted = new Set(projectNiches);
  const fits = new Map<string, { reason: string; score: number }>();
  for (const c of candidates) {
    const key = telegramEntityKey(c.url);
    if (!key || fits.has(key)) continue;
    const hits = c.niches.filter((n) => wanted.has(n));
    fits.set(key, {
      reason: (hits.length ? hits : c.niches).slice(0, 2).map((n) => GROUP_NICHE_LABELS[n]).join(", "),
      score: hits.length,
    });
  }
  return (d) => {
    if (d.joinDead) return { state: "dead" };
    if (d.joinDecision === "skipped") return { state: "skipped" };
    if (d.joinDecision === "approved" || d.joinWanted === true) return { state: "approved", reason: "отмечено вами" };
    const rel = d.joinRelevance as { band?: unknown; score?: unknown } | undefined;
    if (rel && typeof rel.band === "string") {
      const score = Number(rel.score);
      return { state: rel.band, score: Number.isFinite(score) ? score : null };
    }
    const fit = fits.get(telegramEntityKey(str(d.url)));
    return fit ? { state: "auto", reason: fit.reason, score: fit.score } : { state: "skip" };
  };
}

/** Joinable catalog chats of the niches named in the project description (one per Telegram chat, catalog order). */
export function projectCatalogCandidates(projectText: readonly (string | undefined)[]): {
  niches: GroupNiche[];
  groups: CatalogGroup[];
} {
  const niches = nichesFromProjectText(...projectText);
  if (!niches.length) return { niches, groups: [] };
  const wanted = new Set(niches);
  const seen = new Set<string>();
  const groups: CatalogGroup[] = [];
  for (const g of GROUP_CATALOG) {
    if (!isJoinableCatalogItem(g) || !g.niches.some((n) => wanted.has(n))) continue;
    const key = telegramEntityKey(g.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    groups.push(g);
  }
  return { niches, groups };
}

/** Russian plural: pluralRu(5, ["чат","чата","чатов"]) → "чатов". */
export function pluralRu(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

const NUMBER_RU = new Intl.NumberFormat("ru-RU");

export function formatCountRu(n: number): string {
  return NUMBER_RU.format(n);
}

export function chatsLabel(n: number): string {
  return `${formatCountRu(n)} ${pluralRu(n, ["чат", "чата", "чатов"])}`;
}

export function subscribersLabel(n: number): string {
  return `${formatCountRu(n)} ${pluralRu(n, ["подписчик", "подписчика", "подписчиков"])}`;
}

export function leadsLabel(n: number): string {
  return `${formatCountRu(n)} ${pluralRu(n, ["лид", "лида", "лидов"])}`;
}

const TGSTAT_IMPORTED = /^(Канал|Чат) из TGStat «[^»]*» \(([\d\s  ]+) subscribers\)\.?$/;

export type CatalogRowMeta = { handle: string | null; subscribers: number | null; blurb: string | null };

/** Split raw catalog text into row meta: @handle, subscribers (from TGStat stamps), human description. */
export function catalogRowMeta(item: Pick<CatalogGroup, "url" | "description">): CatalogRowMeta {
  const username = item.url ? extractTelegramUsername(item.url) : null;
  const original = username ? item.url.match(/t\.me\/([a-zA-Z0-9_]{5,32})/i)?.[1] || username : null;
  const handle = original ? `@${original}` : null;
  const text = (item.description || "").trim();
  const m = text.match(TGSTAT_IMPORTED);
  if (m) {
    const subscribers = Number(m[2].replace(/[\s  ]/g, ""));
    return { handle, subscribers: Number.isFinite(subscribers) ? subscribers : null, blurb: null };
  }
  return { handle, subscribers: null, blurb: text || null };
}

export type BulkJoinConfirm = { title: string; names: string; risk: string; action: string };

/** Copy for the bulk-join confirmation: count, account and the first chats by name. */
export function bulkJoinConfirmText(opts: { names: readonly string[]; accountName: string }): BulkJoinConfirm {
  const count = opts.names.length;
  const shown = opts.names.slice(0, 3).map((n) => `«${n}»`);
  const rest = count - shown.length;
  const list = rest > 0 ? `${shown.join(", ")} и ещё ${formatCountRu(rest)}` : shown.join(", ");
  return {
    title: `Вступить в ${chatsLabel(count)} с аккаунта «${opts.accountName}»?`,
    names: `${list}.`,
    risk: "Вступаем в фоне по очереди. Много вступлений подряд Telegram может расценить как спам и ограничить аккаунт.",
    action: `Вступить в ${chatsLabel(count)}`,
  };
}
