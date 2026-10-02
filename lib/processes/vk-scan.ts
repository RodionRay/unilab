/**
 * Action `scan_vk_source` (spec vk-lead-source REQ-1b, 2..9, AM-1, AM-8, AM-9, AM-13):
 * per-source lock → account session with failover → fetch → lib/processes/lead-ingest.ts::pickLeads
 * → `INSERT OR IGNORE` leads keyed by hash(owner+msgKey) → notify flag → source metrics/cursor.
 * Route glue (settings, AI key, notify sender, global log) is injected by app/api/workspace/route.ts.
 */
import type {D1LikeDatabase} from '@/lib/db';
import {pushTaskLog} from '@/lib/audience-invite';
import type {LeadCoreSettings} from '@/lib/lead-core';
import {parseLeadTemperature, ratingFromTemperatures, strongPlusTerms} from '@/lib/lead-filter';
import {pickLeads, type PickedLead, type QualifyFn} from '@/lib/processes/lead-ingest';
import {activeAiRejects, aiSettingsSignature, rememberAiRejects} from '@/lib/processes/scan-flow';
import type {WorkerPost} from '@/lib/vk/client';
import {fetchVkGroup, fetchVkSearch, type VkFetchOutcome} from '@/lib/vk/fetch';
import {VK_DEFAULT_SEARCH_DAILY_CAP} from '@/lib/vk/pool';
import type {VkCandidate} from '@/lib/vk/parse';
import {
  VK_SOURCE_KIND,
  acquireVkSourceLock,
  loadVkAccounts,
  loadVkSource,
  loadVkSources,
  releaseVkSourceLock,
  vkLeadId,
  type StoredVkSource,
  type VkSourceData,
} from '@/lib/vk/records';
import {noUsableVkAccount, openVkSession, type VkSession} from '@/lib/vk/session';

/** VK reading part of a scan; the last batch must still fit, so new batches stop earlier. */
export const VK_SCAN_BUDGET_MS = 45_000;
/**
 * Items sent to AI per run (3 batches of lib/processes/lead-ai.ts): with the 45 s fetch budget the
 * whole scan stays inside the cron's 150 s per-scan timeout. The rest wait for the next run.
 */
export const VK_AI_ITEMS_PER_RUN = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export type VkLeadContext = {
  settings: Record<string, unknown>;
  coreSettings: LeadCoreSettings;
  /** null = AI off or no key: the core decides alone. */
  qualify: QualifyFn | null;
};

export type VkScanDeps = {
  db: D1LikeDatabase;
  owner: string;
  post: WorkerPost;
  leadContext: () => Promise<VkLeadContext>;
  flushNotifications: (settings: Record<string, unknown>) => Promise<void>;
  log: (level: 'info' | 'ok' | 'warn' | 'error', text: string) => Promise<void>;
  now?: () => number;
};

export type VkActionResult = {status: number; body: Record<string, unknown>};

const ok = (body: Record<string, unknown>): VkActionResult => ({status: 200, body: {ok: true, ...body}});

function throttleWait(data: VkSourceData, settings: Record<string, unknown>, now: number): number {
  const minutes = Math.max(5, Math.min(180, Number(settings.autoRescanMinutes) || 30));
  const last = Date.parse(String(data.lastScanAt || ''));
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, Math.ceil((last + minutes * 60_000 - now) / 1000));
}

/** REQ-6 + AM-2: keys of every VK lead of the owner and every tombstone on any VK source. */
async function seenVkKeys(db: D1LikeDatabase, owner: string, sources: readonly StoredVkSource[]): Promise<Set<string>> {
  const rows = await db
    .prepare("SELECT json_extract(data,'$.msgKey') AS k FROM records WHERE owner=? AND kind='lead' AND json_extract(data,'$.platform')='vk'")
    .bind(owner)
    .all();
  const seen = new Set<string>(rows.results.map((r) => String(r.k ?? '')).filter(Boolean));
  for (const s of sources) for (const t of Array.isArray(s.data.leadTombstones) ? s.data.leadTombstones : []) seen.add(String(t));
  return seen;
}

async function sourceMetrics(db: D1LikeDatabase, owner: string, sourceId: string) {
  const rows = await db
    .prepare("SELECT json_extract(data,'$.temperature') AS t, COUNT(*) AS n FROM records WHERE owner=? AND kind='lead' AND json_extract(data,'$.vkSourceId')=? GROUP BY t")
    .bind(owner, sourceId)
    .all();
  const counts = {hot: 0, warm: 0, cold: 0};
  for (const r of rows.results) counts[parseLeadTemperature(r.t || 'warm')] += Number(r.n) || 0;
  return {leadsTotal: counts.hot + counts.warm + counts.cold, leadsHot: counts.hot, leadsWarm: counts.warm, leadsCold: counts.cold, rating: ratingFromTemperatures(counts)};
}

/** Shown on a source that cannot be scanned with the current settings; such a source is not due (REQ-8). */
export const VK_NO_KEYWORDS_ERROR = 'Нет ключевых слов';
const VK_NO_GROUP_ERROR = 'У источника нет группы VK';

/** '' = scannable; otherwise the user-facing reason, decided before any VK call or account lease. */
export function vkSourceBlocker(src: VkSourceData, settings: Record<string, unknown>): string {
  if (src.type === 'group') return src.vkGroupId ? '' : VK_NO_GROUP_ERROR;
  return strongPlusTerms(String(settings.keywords || '')).length ? '' : VK_NO_KEYWORDS_ERROR;
}

function fetchSource(session: VkSession, src: VkSourceData, settings: Record<string, unknown>, now: number): Promise<VkFetchOutcome> {
  const depthDays = Math.max(1, Math.min(90, Number(settings.scanDepthDays) || 7));
  const depthCutoffSec = Math.floor((now - depthDays * DAY_MS) / 1000);
  const cursor = src.cursor ?? {};
  if (src.type === 'group') return fetchVkGroup(session.run, {groupId: Number(src.vkGroupId), cursor, depthCutoffSec});
  const keywords = strongPlusTerms(String(settings.keywords || ''));
  return fetchVkSearch(session.run, {keywords, cursor, depthCutoffSec, nowSec: Math.floor(now / 1000)});
}

type Inserted = {added: number; addedByTemp: {hot: number; warm: number; cold: number}};

async function insertLeads(
  deps: VkScanDeps,
  src: StoredVkSource,
  kept: readonly PickedLead<VkCandidate>[],
  notify: boolean,
): Promise<Inserted> {
  const addedByTemp = {hot: 0, warm: 0, cold: 0};
  let added = 0;
  for (const k of kept) {
    const lead = {
      name: k.item.name || 'Участник VK',
      message: k.item.message,
      source: src.data.title || 'VK',
      status: 'new',
      temperature: k.temperature,
      draft: '',
      reason: k.reason,
      viewed: false,
      viewedAt: '',
      replies: [],
      coreScore: Number(k.core.score) || 0,
      platform: 'vk',
      msgKey: k.item.key,
      url: k.item.url,
      vkSourceId: src.id,
      notifyPending: notify,
      notifiedAt: '',
    };
    const id = await vkLeadId(deps.owner, k.item.key);
    const res = await deps.db
      .prepare('INSERT OR IGNORE INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)')
      .bind(id, deps.owner, 'lead', JSON.stringify(lead), null, new Date().toISOString())
      .run();
    if (res.meta.changes !== 1) continue;
    added += 1;
    addedByTemp[k.temperature] += 1;
  }
  return {added, addedByTemp};
}

const STATE_KEY_RE = /^[A-Za-z]+$/;

/** json_set path/value pairs; keys are spliced into SQL, so only plain letter keys pass. */
export function sourceStateSets(keys: readonly string[]): string {
  for (const k of keys) if (!STATE_KEY_RE.test(k)) throw new Error(`Unsafe VK source state key: ${JSON.stringify(k)}`);
  return keys.map((k) => `'$.${k}',json(?)`).join(',');
}

/** Scan-owned fields only (json_set): a lead deletion writing tombstones meanwhile is never lost. */
async function saveSourceState(deps: VkScanDeps, id: string, patch: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(patch);
  const sets = sourceStateSets(keys);
  await deps.db
    .prepare(`UPDATE records SET data=json_set(data,${sets}) WHERE owner=? AND id=? AND kind=?`)
    .bind(...keys.map((k) => JSON.stringify(patch[k])), deps.owner, id, VK_SOURCE_KIND)
    .run();
}

export async function scanVkSource(deps: VkScanDeps, input: {id: string; force: boolean}): Promise<VkActionResult> {
  const now = deps.now ?? Date.now;
  const src = await loadVkSource(deps.db, deps.owner, input.id);
  if (!src) return {status: 404, body: {error: 'Источник VK не найден'}};
  const ctx = await deps.leadContext();
  const wait = input.force ? 0 : throttleWait(src.data, ctx.settings, now());
  if (wait > 0) return ok({skipped: true, waitSec: wait, added: 0, message: `Скан не чаще 1 раза в ${Number(ctx.settings.autoRescanMinutes) || 30} мин.`});
  const lock = await acquireVkSourceLock(deps.db, deps.owner, src.id, now());
  if (!lock) return ok({skipped: true, locked: true, added: 0, message: 'Скан этого источника уже идёт'});
  try {
    return await scanLocked(deps, src, ctx, now);
  } finally {
    await releaseVkSourceLock(deps.db, deps.owner, src.id, lock.token);
  }
}

async function scanLocked(deps: VkScanDeps, src: StoredVkSource, ctx: VkLeadContext, now: () => number): Promise<VkActionResult> {
  const started = now();
  const blocker = vkSourceBlocker(src.data, ctx.settings);
  if (blocker) {
    // lastScanAt moves so a manual or cron run does not retry it every tick; keywords re-enable it.
    await saveSourceState(deps, src.id, {error: blocker, lastScanAt: new Date(started).toISOString()});
    return {status: 400, body: {error: blocker === VK_NO_KEYWORDS_ERROR ? 'Нет ключевых слов — добавьте их в настройках' : blocker}};
  }
  const accounts = await loadVkAccounts(deps.db, deps.owner);
  if (noUsableVkAccount(accounts, started)) {
    const error = 'Нет активного VK-аккаунта с прокси';
    await saveSourceState(deps, src.id, {error});
    return {status: 409, body: {error, noAccount: true}};
  }
  const caps = {search: Number(ctx.settings.vkSearchDailyCap ?? VK_DEFAULT_SEARCH_DAILY_CAP), calls: 0};
  const session = await openVkSession({db: deps.db, owner: deps.owner, post: deps.post, caps, deadlineAt: started + VK_SCAN_BUDGET_MS, now});
  let fetched: VkFetchOutcome;
  try {
    fetched = await fetchSource(session, src.data, ctx.settings, started);
  } finally {
    await session.close();
  }
  if (session.stats.noAccount && !session.stats.accountsUsed.length) {
    return ok({skipped: true, noAccount: true, added: 0, message: 'Все VK-аккаунты заняты или на паузе — скан позже'});
  }
  return finishScan(deps, src, ctx, fetched, session, now);
}

async function finishScan(
  deps: VkScanDeps,
  src: StoredVkSource,
  ctx: VkLeadContext,
  fetched: VkFetchOutcome,
  session: VkSession,
  now: () => number,
): Promise<VkActionResult> {
  const t = now();
  const depthDays = Math.max(1, Math.min(90, Number(ctx.settings.scanDepthDays) || 7));
  const sig = aiSettingsSignature(ctx.settings);
  const aiActive = activeAiRejects(src.data.aiRejected, sig, t);
  const seen = await seenVkKeys(deps.db, deps.owner, await loadVkSources(deps.db, deps.owner));
  const picked = await pickLeads({
    items: fetched.candidates,
    coreSettings: ctx.coreSettings,
    seen,
    aiRejects: aiActive,
    depthCutoff: t - depthDays * DAY_MS,
    qualify: ctx.qualify,
    maxJudged: VK_AI_ITEMS_PER_RUN,
  });
  // Deferred items are neither leads nor AI rejects yet: the cursor must not pass them.
  const cursor = picked.deferred ? src.data.cursor ?? {} : fetched.cursor;
  const inserted = await insertLeads(deps, src, picked.kept, ctx.settings.notifyEnabled === true);
  try {
    await deps.flushNotifications(ctx.settings);
  } catch (e) {
    console.error('[vk-scan] notify:', String((e as Error)?.message || e).slice(0, 200));
  }
  const {funnel} = picked;
  const metrics = await sourceMetrics(deps.db, deps.owner, src.id);
  const partial = fetched.incomplete ? ` · не всё прочитано (${session.stats.lastError || 'повтор позже'})` : '';
  const later = picked.deferred ? ` · ${picked.deferred} на AI в следующий скан` : '';
  const line = `VK · +${inserted.added} · запросов ${fetched.calls} · найдено ${funnel.fetched} → ядро ${funnel.core} → AI/match ${funnel.matched}${funnel.aiUsed ? ' · AI' : ''}${partial}${later}`;
  const lastScanAt = new Date(t).toISOString();
  await saveSourceState(deps, src.id, {
    cursor,
    lastScanAt,
    error: fetched.sourceError,
    aiRejected: ctx.qualify && funnel.fresh ? rememberAiRejects(aiActive, picked.rejectedIds, sig, t) : src.data.aiRejected ?? null,
    scanMatched: funnel.matched,
    scanLog: pushTaskLog(src.data.scanLog, fetched.sourceError ? 'error' : inserted.added ? 'ok' : 'info', fetched.sourceError || line, 50),
    ...metrics,
  });
  await deps.log(inserted.added ? 'ok' : 'info', `${src.data.title || 'VK'}: ${inserted.added ? `+${inserted.added} лидов` : 'без новых'} · VK ${funnel.fetched} → ядро ${funnel.core}`);
  return ok({
    scanned: funnel.fetched,
    prefilter: funnel.core,
    matched: funnel.matched,
    added: inserted.added,
    addedByTemp: inserted.addedByTemp,
    aiUsed: funnel.aiUsed,
    partial: fetched.incomplete,
    more: session.stats.outOfTime || picked.deferred > 0,
    deferred: picked.deferred,
    accountsUsed: session.stats.accountsUsed.length,
    failovers: session.stats.failovers,
    error: fetched.sourceError || (fetched.incomplete ? session.stats.lastError : ''),
    title: src.data.title,
    metrics: {...metrics, lastScanAt},
  });
}
