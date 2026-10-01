import type { D1LikeDatabase } from "@/lib/db";
import type { WorkspaceActor } from "@/lib/security/workspace-authz";
import type { CrmAccessKey } from "@/lib/staff-types";
import type { FeedQuery, FeedResponse, FeedView, TmaErrorCode } from "@/lib/tma/contract";
import { FeedInputError, inboxFeed, leadFeed } from "@/lib/tma/feed-inbox";
import { accountsFeed, overviewFeed, tasksFeed } from "@/lib/tma/feed-ops";

/** GET /api/tma/feed core (REQ-M1–M5): section gate per view, then an owner-scoped projection. */

const VIEW_ACCESS: Readonly<Record<FeedView, readonly CrmAccessKey[]>> = {
  overview: ["overview"],
  inbox: ["leads", "chats"],
  lead: ["leads", "chats"],
  accounts: ["accounts"],
  tasks: ["mailing", "audience", "invite", "groups"],
};

export function canOpenView(actor: WorkspaceActor, view: FeedView): boolean {
  if (actor.isOwner || actor.role === "admin") return true;
  return VIEW_ACCESS[view].some((k) => actor.access[k] === true);
}

export type FeedResult =
  | { ok: true; body: FeedResponse }
  | { ok: false; status: 400 | 403 | 404; code: TmaErrorCode; error?: string };

export async function buildFeed(db: D1LikeDatabase, actor: WorkspaceActor, q: FeedQuery): Promise<FeedResult> {
  if (!canOpenView(actor, q.view)) return { ok: false, status: 403, code: "forbidden" };
  try {
    switch (q.view) {
      case "inbox":
        return { ok: true, body: await inboxFeed(db, actor, q) };
      case "lead": {
        if (!q.id) return { ok: false, status: 400, code: "bad_request" };
        const lead = await leadFeed(db, actor, q.id);
        return lead ? { ok: true, body: lead } : { ok: false, status: 404, code: "bad_request", error: "Лид не найден" };
      }
      case "accounts":
        return { ok: true, body: await accountsFeed(db, actor) };
      case "tasks":
        return { ok: true, body: await tasksFeed(db, actor) };
      case "overview":
        return { ok: true, body: await overviewFeed(db, actor) };
    }
  } catch (e) {
    if (e instanceof FeedInputError) return { ok: false, status: 400, code: "bad_request" };
    throw e;
  }
}
