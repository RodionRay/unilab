/**
 * VK API objects → lead candidates (spec vk-lead-source D4, REQ-5, AM-3, AM-15).
 * Keys are platform-wide so search and group scans of one item collide on purpose:
 *   post          vk:<owner_id>_<post_id>
 *   wall comment  vk:<owner_id>_<post_id>_c<comment_id>
 *   board comment vk:board<group_id>_<topic_id>_<comment_id>
 * Items without text (deleted, media-only) yield no candidate.
 */
import type {VkBoardComment, VkGroup, VkPost, VkProfile, VkWallComment} from '@/lib/vk/client';

export const VK_MESSAGE_MAX = 8000;

export type VkCandidate = {
  key: string;
  message: string;
  name: string;
  /** ISO 8601 (UTC), like Telegram scan items. */
  date: string;
  url: string;
  authorId: number;
};

export type VkNameBook = {user: (id: number) => string | null; group: (id: number) => string | null};

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function isPost(v: unknown): v is VkPost {
  return isRec(v) && isInt(v.id) && isInt(v.owner_id) && isInt(v.date);
}
function isComment(v: unknown): v is VkWallComment & VkBoardComment {
  return isRec(v) && isInt(v.id) && isInt(v.from_id) && isInt(v.date);
}

/** Names from the `profiles` / `groups` arrays of an `extended=1` response. */
export function vkNameBook(response: unknown): VkNameBook {
  const users = new Map<number, string>();
  const groups = new Map<number, string>();
  const r = isRec(response) ? response : {};
  for (const p of list(r.profiles) as VkProfile[]) {
    if (!isRec(p) || !isInt(p.id)) continue;
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
    if (name) users.set(p.id, name);
  }
  for (const g of list(r.groups) as VkGroup[]) {
    if (isRec(g) && isInt(g.id) && g.name) groups.set(g.id, String(g.name));
  }
  return {user: (id) => users.get(id) ?? null, group: (id) => groups.get(id) ?? null};
}

/** Author name; communities (negative ids) by name. AM-15: a signed community post names the signer. */
function authorName(fromId: number, book: VkNameBook, signerId?: number): string {
  if (fromId > 0) return book.user(fromId) ?? `id${fromId}`;
  const signer = signerId && signerId > 0 ? book.user(signerId) : null;
  return signer ?? book.group(-fromId) ?? `club${-fromId}`;
}

/** Cuts to VK_MESSAGE_MAX UTF-16 units without leaving half of a surrogate pair. */
export function truncateVkMessage(text: string): string {
  if (text.length <= VK_MESSAGE_MAX) return text;
  const cut = text.slice(0, VK_MESSAGE_MAX);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

const isoDate = (unix: number) => new Date(unix * 1000).toISOString();

export function vkPostUrl(ownerId: number, postId: number): string {
  return `https://vk.com/wall${ownerId}_${postId}`;
}

export function vkPostCandidate(post: VkPost, book: VkNameBook): VkCandidate | null {
  const text = String(post.text ?? '').trim();
  if (!text) return null;
  const fromId = isInt(post.from_id) && post.from_id !== 0 ? post.from_id : post.owner_id;
  return {
    key: `vk:${post.owner_id}_${post.id}`,
    message: truncateVkMessage(text),
    name: authorName(fromId, book, post.signer_id),
    date: isoDate(post.date),
    url: vkPostUrl(post.owner_id, post.id),
    authorId: fromId,
  };
}

export function vkWallCommentCandidate(
  comment: VkWallComment,
  ctx: {ownerId: number; postId: number; threadId?: number},
  book: VkNameBook,
): VkCandidate | null {
  const text = String(comment.text ?? '').trim();
  if (!text) return null;
  const threadId = comment.parents_stack?.[0] ?? ctx.threadId;
  const thread = threadId && threadId !== comment.id ? `&thread=${threadId}` : '';
  return {
    key: `vk:${ctx.ownerId}_${ctx.postId}_c${comment.id}`,
    message: truncateVkMessage(text),
    name: authorName(comment.from_id, book),
    date: isoDate(comment.date),
    url: `${vkPostUrl(ctx.ownerId, ctx.postId)}?reply=${comment.id}${thread}`,
    authorId: comment.from_id,
  };
}

export function vkBoardCommentCandidate(
  comment: VkBoardComment,
  ctx: {groupId: number; topicId: number},
  book: VkNameBook,
): VkCandidate | null {
  const text = String(comment.text ?? '').trim();
  if (!text) return null;
  const groupId = Math.abs(ctx.groupId);
  return {
    key: `vk:board${groupId}_${ctx.topicId}_${comment.id}`,
    message: truncateVkMessage(text),
    name: authorName(comment.from_id, book),
    date: isoDate(comment.date),
    url: `https://vk.com/topic-${groupId}_${ctx.topicId}?post=${comment.id}`,
    authorId: comment.from_id,
  };
}

const present = <T>(v: T | null): v is T => v !== null;

/** newsfeed.search (extended=1) or wall.get (extended=1) response → post candidates. */
export function vkPostCandidates(response: unknown): VkCandidate[] {
  const book = vkNameBook(response);
  const items = isRec(response) ? list(response.items) : [];
  return items.filter(isPost).map((p) => vkPostCandidate(p, book)).filter(present);
}

/** Posts of a wall.get / newsfeed.search response (for cursors and comment fetches). */
export function vkPosts(response: unknown): VkPost[] {
  return isRec(response) ? list(response.items).filter(isPost) : [];
}

/** wall.getComments response → candidates for top-level comments and their thread replies. */
export function vkWallCommentCandidates(response: unknown, ctx: {ownerId: number; postId: number}): VkCandidate[] {
  const book = vkNameBook(response);
  const out: VkCandidate[] = [];
  for (const c of (isRec(response) ? list(response.items) : []).filter(isComment)) {
    const top = vkWallCommentCandidate(c, ctx, book);
    if (top) out.push(top);
    for (const r of list(c.thread?.items).filter(isComment)) {
      const reply = vkWallCommentCandidate(r, {...ctx, threadId: c.id}, book);
      if (reply) out.push(reply);
    }
  }
  return out;
}

/** board.getComments response → candidates. */
export function vkBoardCommentCandidates(response: unknown, ctx: {groupId: number; topicId: number}): VkCandidate[] {
  const book = vkNameBook(response);
  const items = isRec(response) ? list(response.items) : [];
  return items.filter(isComment).map((c) => vkBoardCommentCandidate(c, ctx, book)).filter(present);
}
