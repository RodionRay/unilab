/**
 * What one scan of a VK source reads (spec vk-lead-source REQ-3, REQ-4, NFR page caps):
 * search → one newsfeed.search page per strong keyword since the cursor; group → the newest
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

export async function fetchVkSearch(
  run: VkRunCalls,
  input: {keywords: readonly string[]; cursor: VkSourceCursor; depthCutoffSec: number; nowSec: number},
): Promise<VkFetchOutcome> {
  const keywords = input.keywords.slice(0, VK_SEARCH_MAX_KEYWORDS);
  const since = Math.max(input.depthCutoffSec, (input.cursor.searchStartTime ?? 0) - VK_SEARCH_OVERLAP_SEC);
  const calls = keywords.map((q) => vkMethods.newsfeedSearch({q, startTime: since}));
  const results = await run(calls);
  const candidates = results.flatMap((r) => (r.ok ? vkPostCandidates(r.response) : []));
  const incomplete = results.some(failedHard);
  return {
    candidates,
    cursor: incomplete ? input.cursor : {...input.cursor, searchStartTime: input.nowSec},
    calls: calls.length,
    incomplete,
    sourceError: '',
  };
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
