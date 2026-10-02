/**
 * What one scan of a VK source reads (spec vk-lead-source REQ-3, REQ-4, NFR page caps):
 * search → up to 3 newsfeed.search pages per strong keyword since the cursor; group → the newest
 * wall page, comments of the latest posts and comments of recently updated board topics.
 * Cursors advance only for the parts that were read without a failover-worthy error (REQ-9).
 */
import {
  classifyVkError,
  shouldFailOver,
  vkMethods,
  type VkBoardTopic,
  type VkCall,
  type VkResult,
} from '@/lib/vk/client';
import {
  vkBoardCommentCandidates,
  vkPostCandidates,
  vkPosts,
  vkWallCommentCandidates,
  type VkCandidate,
} from '@/lib/vk/parse';
import type {VkSourceCursor} from '@/lib/vk/records';

/** Strong keywords searched per run (≈ 48 runs/day × 8 stays near the 500/day default cap). */
export const VK_SEARCH_MAX_KEYWORDS = 8;
/** Search overlap so posts indexed late are still found; duplicates fall to the D4 key. */
export const VK_SEARCH_OVERLAP_SEC = 300;
/** next_from pages per keyword per run (≤ 8 × 3 search calls a run). */
export const VK_SEARCH_PAGES_PER_RUN = 3;
export const VK_WALL_PAGE = 100;
export const VK_COMMENT_POSTS_PER_RUN = 10;
/** One full page: topics updated since the cursor beyond it are not seen (≫ 5 per run × runs per day). */
export const VK_BOARD_TOPICS_PAGE = 100;
export const VK_BOARD_TOPICS_PER_RUN = 5;

export type VkRunCalls = (calls: readonly VkCall[]) => Promise<VkResult[]>;

export type VkFetchOutcome = {
  candidates: VkCandidate[];
  cursor: VkSourceCursor;
  /** Calls sent (for the funnel). */
  calls: number;
  /** A failover-worthy error was left unresolved: cursor parts it touched were kept. */
  incomplete: boolean;
  /** The source itself is unreadable (closed group, no access): shown on the source. */
  sourceError: string;
};

const failedHard = (r: VkResult): boolean => !r.ok && shouldFailOver(classifyVkError(r.error));
const skipReason = (r: VkResult): string => (r.ok ? '' : classifyVkError(r.error).reason);

type SearchInput = {keywords: readonly string[]; cursor: VkSourceCursor; depthCutoffSec: number; nowSec: number};

function nextFrom(response: unknown): string {
  const r = typeof response === 'object' && response !== null ? (response as {next_from?: unknown; items?: unknown}) : {};
  const more = typeof r.next_from === 'string' && r.next_from !== '' && Array.isArray(r.items) && r.items.length > 0;
  return more ? String(r.next_from) : '';
}

/** Interval in progress: the stored one (keywords still paging) or a new one ending now. */
function openInterval(input: SearchInput, keywords: readonly string[]): {endTime: number; pending: Map<string, string>} {
  const paging = input.cursor.searchPaging;
  if (paging && Number.isInteger(paging.endTime) && paging.next && typeof paging.next === 'object') {
    const pending = new Map(keywords.filter((q) => typeof paging.next[q] === 'string').map((q) => [q, paging.next[q]]));
    if (pending.size) return {endTime: paging.endTime, pending};
  }
  return {endTime: input.nowSec, pending: new Map(keywords.map((q) => [q, '']))};
}

/**
 * REQ-3: every strong keyword pages through [cursor − overlap, endTime] with next_from, up to
 * VK_SEARCH_PAGES_PER_RUN pages a run. Unfinished keywords keep their next_from in
 * `cursor.searchPaging` (endTime pinned); searchStartTime moves to endTime only when all finished.
 */
export async function fetchVkSearch(run: VkRunCalls, input: SearchInput): Promise<VkFetchOutcome> {
  const keywords = input.keywords.slice(0, VK_SEARCH_MAX_KEYWORDS);
  const since = Math.max(input.depthCutoffSec, (input.cursor.searchStartTime ?? 0) - VK_SEARCH_OVERLAP_SEC);
  const {endTime, pending} = openInterval(input, keywords);
  const candidates: VkCandidate[] = [];
  let active = [...pending.keys()];
  let calls = 0;
  let anyAnswered = false;
  let incomplete = false;
  for (let page = 0; page < VK_SEARCH_PAGES_PER_RUN && active.length; page += 1) {
    const results = await run(active.map((q) => vkMethods.newsfeedSearch({q, startTime: since, endTime, startFrom: pending.get(q) || undefined})));
    calls += active.length;
    const still: string[] = [];
    results.forEach((r, i) => {
      const q = active[i];
      if (failedHard(r)) {
        incomplete = true;
        return;
      }
      anyAnswered = true;
      const next = r.ok ? nextFrom(r.response) : '';
      if (r.ok) candidates.push(...vkPostCandidates(r.response));
      if (next) {
        pending.set(q, next);
        still.push(q);
      } else pending.delete(q);
    });
    active = still;
  }
  return {candidates, cursor: searchCursor(input.cursor, {anyAnswered, endTime, pending}), calls, incomplete, sourceError: ''};
}

/** Nothing answered (every call hit a failover-worthy error) → the cursor stays as it was (REQ-9). */
function searchCursor(cursor: VkSourceCursor, run: {anyAnswered: boolean; endTime: number; pending: Map<string, string>}): VkSourceCursor {
  if (!run.anyAnswered) return cursor;
  const rest: VkSourceCursor = {...cursor};
  delete rest.searchPaging;
  if (!run.pending.size) return {...rest, searchStartTime: run.endTime};
  return {...rest, searchPaging: {endTime: run.endTime, next: Object.fromEntries(run.pending)}};
}

type GroupInput = {groupId: number; cursor: VkSourceCursor; depthCutoffSec: number};

function commentCalls(response: unknown, input: GroupInput): {calls: VkCall[]; ctx: {ownerId: number; postId: number}[]} {
  const posts = vkPosts(response)
    .filter((p) => p.date >= input.depthCutoffSec && Number(p.comments?.count) > 0)
    .sort((a, b) => b.date - a.date)
    .slice(0, VK_COMMENT_POSTS_PER_RUN);
  return {
    calls: posts.map((p) => vkMethods.wallGetComments({ownerId: p.owner_id, postId: p.id})),
    ctx: posts.map((p) => ({ownerId: p.owner_id, postId: p.id})),
  };
}

const topicUpdated = (t: VkBoardTopic): number => Number(t.updated ?? t.created ?? 0);

/**
 * Oldest-updated first, so when more than the per-run cap are fresh the cursor stops at the
 * newest topic actually read and the next run continues with the rest (none is skipped).
 */
function freshTopics(response: unknown, since: number): VkBoardTopic[] {
  const items = typeof response === 'object' && response !== null ? (response as {items?: unknown}).items : [];
  return (Array.isArray(items) ? (items as VkBoardTopic[]) : [])
    .filter((t) => Number.isInteger(t?.id) && topicUpdated(t) >= since)
    .sort((a, b) => topicUpdated(a) - topicUpdated(b))
    .slice(0, VK_BOARD_TOPICS_PER_RUN);
}

export async function fetchVkGroup(run: VkRunCalls, input: GroupInput): Promise<VkFetchOutcome> {
  const {groupId, cursor} = input;
  const [wall, topics] = await run([
    vkMethods.wallGet({groupId, count: VK_WALL_PAGE}),
    vkMethods.boardGetTopics({groupId, count: VK_BOARD_TOPICS_PAGE}),
  ]);
  if (!wall.ok && !failedHard(wall)) {
    return {candidates: [], cursor, calls: 2, incomplete: false, sourceError: skipReason(wall)};
  }
  const lastPostId = cursor.wallMaxPostId ?? 0;
  const posts = wall.ok ? vkPostCandidates(wall.response).filter((c) => Number(c.key.split('_')[1]) > lastPostId) : [];
  const comments = wall.ok ? commentCalls(wall.response, input) : {calls: [], ctx: []};
  const boardSince = Math.max(input.depthCutoffSec, cursor.boardSince ?? 0);
  const topicList = topics.ok ? freshTopics(topics.response, boardSince) : [];
  const boardCalls = topicList.map((t) => vkMethods.boardGetComments({groupId, topicId: t.id}));
  const second = comments.calls.length + boardCalls.length ? await run([...comments.calls, ...boardCalls]) : [];
  const wallComments = second.slice(0, comments.calls.length);
  const boardComments = second.slice(comments.calls.length);
  const candidates = [
    ...posts,
    ...wallComments.flatMap((r, i) => (r.ok ? vkWallCommentCandidates(r.response, comments.ctx[i]) : [])),
    ...boardComments.flatMap((r, i) => (r.ok ? vkBoardCommentCandidates(r.response, {groupId, topicId: topicList[i].id}) : [])),
  ];
  const wallOk = wall.ok && !wallComments.some(failedHard);
  const boardOk = !failedHard(topics) && !boardComments.some(failedHard);
  const maxPostId = wall.ok ? Math.max(lastPostId, ...vkPosts(wall.response).map((p) => p.id)) : lastPostId;
  const maxUpdated = Math.max(cursor.boardSince ?? 0, ...topicList.map(topicUpdated));
  return {
    candidates,
    cursor: {
      ...cursor,
      ...(wallOk ? {wallMaxPostId: maxPostId} : {}),
      ...(boardOk && topics.ok ? {boardSince: maxUpdated} : {}),
    },
    calls: 2 + second.length,
    incomplete: !wallOk || !boardOk,
    sourceError: '',
  };
}
