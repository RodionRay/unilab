import type { D1LikeDatabase } from "@/lib/db";
import { leadReplies, type LeadData } from "@/lib/lead-conversation";
import { authorizeWorkspaceAction, visibleRecordsFor, type WorkspaceActor } from "@/lib/security/workspace-authz";
import { canPollDmInbox, hasMessageQuota, isAccountUsable } from "@/lib/telegram-accounts";
import {
  FEED_PAGE_SIZE,
  type FeedQuery,
  type InboxFeed,
  type InboxItem,
  type LeadFeed,
  type LeadMessage,
  type Temperature,
} from "@/lib/tma/contract";

/** Inbox and lead detail projections (REQ-M1/M2). Bounded SQL, owner-scoped, no full-table load. */

const PREVIEW_MAX = 200;
const TEMPERATURES: readonly Temperature[] = ["hot", "warm", "cold"];

type Cursor = { p: number; a: string; i: string };

export class FeedInputError extends Error {}

/** Unread or waiting for a manager sorts first, then the latest activity. */
const PRIO_SQL = `CASE WHEN COALESCE(json_extract(data,'$.viewed'),0)=0 OR COALESCE(json_extract(data,'$.needsManager'),0)=1 THEN 1 ELSE 0 END`;
const ACTIVITY_SQL = `MAX(created, COALESCE(json_extract(data,'$.conversationAt'),''), COALESCE(json_extract(data,'$.replies[#-1].at'),''))`;
const NOT_ARCHIVED_SQL = `COALESCE(json_extract(data,'$.status'),'new')!='archived'`;
const FILTER_SQL: Readonly<Record<NonNullable<FeedQuery["filter"]>, string>> = {
  all: "1=1",
  hot: `json_extract(data,'$.temperature')='hot'`,
  unread: `${PRIO_SQL}=1`,
  conversations: `(COALESCE(json_extract(data,'$.conversationOpen'),0)=1 OR COALESCE(json_array_length(data,'$.replies'),0)>0)`,
};

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    if ((c.p === 0 || c.p === 1) && typeof c.a === "string" && typeof c.i === "string" && c.a.length <= 40 && c.i.length <= 100) {
      return { p: c.p, a: c.a, i: c.i };
    }
  } catch {
    /* fall through */
  }
  throw new FeedInputError("bad cursor");
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function temperatureOf(v: unknown): Temperature {
  return TEMPERATURES.includes(v as Temperature) ? (v as Temperature) : "warm";
}

function inboxItem(id: string, lead: LeadData, activity: string): InboxItem {
  const replies = leadReplies(lead);
  const last = replies.at(-1)?.text || str(lead.incomingLastText) || str(lead.message);
  return {
    id,
    name: str(lead.name),
    username: str(lead.senderUsername),
    temperature: temperatureOf(lead.temperature),
    preview: last.slice(0, PREVIEW_MAX),
    at: activity,
    unread: lead.viewed !== true,
    needsManager: lead.needsManager === true,
    conversation: lead.conversationOpen === true || replies.length > 0,
    source: str(lead.source),
    reason: str(lead.reason).slice(0, PREVIEW_MAX),
  };
}

type InboxRow = { id: string; data: string; prio: number; act: string };

export async function inboxFeed(db: D1LikeDatabase, actor: WorkspaceActor, q: FeedQuery): Promise<InboxFeed> {
  const cursor = q.cursor ? decodeCursor(q.cursor) : null;
  const filter = FILTER_SQL[q.filter ?? "all"];
  const after = cursor ? "WHERE (prio<? OR (prio=? AND act<?) OR (prio=? AND act=? AND id<?))" : "";
  const binds: unknown[] = [actor.ownerId];
  if (cursor) binds.push(cursor.p, cursor.p, cursor.a, cursor.p, cursor.a, cursor.i);
  binds.push(FEED_PAGE_SIZE + 1);
  const rows = await db
    .prepare(
      `SELECT id, data, prio, act FROM (
         SELECT id, data, ${PRIO_SQL} AS prio, ${ACTIVITY_SQL} AS act
         FROM records WHERE owner=? AND kind='lead' AND ${NOT_ARCHIVED_SQL} AND ${filter}
       ) ${after}
       ORDER BY prio DESC, act DESC, id DESC LIMIT ?`,
    )
    .bind(...binds)
    .all();
  const page = (rows.results as InboxRow[]).slice(0, FEED_PAGE_SIZE);
  const visible = visibleRecordsFor(
    actor,
    page.map((r) => ({ kind: "lead", id: String(r.id), act: String(r.act), data: JSON.parse(String(r.data)) as Record<string, unknown> })),
  );
  const last = page.at(-1);
  const counts = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN json_extract(data,'$.temperature')='hot' THEN 1 ELSE 0 END),0) AS hot,
        COALESCE(SUM(CASE WHEN COALESCE(json_extract(data,'$.viewed'),0)=0 THEN 1 ELSE 0 END),0) AS unread
       FROM records WHERE owner=? AND kind='lead' AND ${NOT_ARCHIVED_SQL}`,
    )
    .bind(actor.ownerId)
    .first<{ hot: number; unread: number }>();
  return {
    view: "inbox",
    items: visible.map((r) => inboxItem(r.id, r.data, r.act)),
    nextCursor: rows.results.length > FEED_PAGE_SIZE && last ? encodeCursor({ p: Number(last.prio), a: String(last.act), i: String(last.id) }) : null,
    counts: { hot: Number(counts?.hot) || 0, unread: Number(counts?.unread) || 0 },
  };
}

function leadMessage(r: ReturnType<typeof leadReplies>[number]): LeadMessage {
  const status: LeadMessage["status"] =
    r.from === "client" || r.ok ? "sent" : r.status === "pending" || r.status === "unknown" ? "pending" : "failed";
  const msg: LeadMessage = { from: r.from === "client" ? "client" : "us", text: str(r.text), at: str(r.at), status };
  if (status === "failed" && r.error) msg.error = str(r.error).slice(0, 300);
  return msg;
}

type AccountState = { status?: string; cooldownUntil?: string; cooldownReason?: string; limits?: { message?: unknown }; messagesToday?: number; messagesDay?: string };

/**
 * Mirrors the cheap, deterministic part of R::sendLeadMessage: no client peer, or the conversation's
 * own account (which a reply may not rotate away from) on cooldown / out of daily quota.
 * Farm rotation and worker errors are still reported by send_lead_message itself.
 */
async function replyBlock(db: D1LikeDatabase, actor: WorkspaceActor, lead: LeadData): Promise<string | null> {
  const authz = authorizeWorkspaceAction(actor, "send_lead_message", undefined);
  if (!authz.ok) return authz.error;
  if (!lead.senderId && !lead.senderUsername) return "Нет Telegram id/username клиента — написать в личку нельзя";
  const accountId = str(lead.accountId);
  const kept = lead.conversationOpen === true || leadReplies(lead).some((x) => x.from === "us" && x.ok);
  if (!accountId || !kept) return null;
  const row = await db
    .prepare(
      `SELECT json_extract(data,'$.status') AS status, json_extract(data,'$.cooldownUntil') AS cooldownUntil,
        json_extract(data,'$.cooldownReason') AS cooldownReason, json_extract(data,'$.limits') AS limits,
        json_extract(data,'$.messagesToday') AS messagesToday, json_extract(data,'$.messagesDay') AS messagesDay
       FROM records WHERE owner=? AND id=? AND kind='account'`,
    )
    .bind(actor.ownerId, accountId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  const account: AccountState = {
    status: str(row.status),
    cooldownUntil: str(row.cooldownUntil),
    cooldownReason: str(row.cooldownReason),
    limits: row.limits ? (JSON.parse(String(row.limits)) as { message?: unknown }) : undefined,
    messagesToday: Number(row.messagesToday) || 0,
    messagesDay: str(row.messagesDay),
  };
  if (!canPollDmInbox(account)) return null;
  if (!isAccountUsable(account)) return "Аккаунт этой переписки на отлежке или в спамблоке — ответить можно позже";
  if (!hasMessageQuota(account)) return "Дневной лимит сообщений аккаунта этой переписки исчерпан — ответ после полуночи (МСК)";
  return null;
}

export async function leadFeed(db: D1LikeDatabase, actor: WorkspaceActor, id: string): Promise<LeadFeed | null> {
  const row = await db
    .prepare("SELECT id, data FROM records WHERE owner=? AND id=? AND kind='lead'")
    .bind(actor.ownerId, id)
    .first<{ id: string; data: string }>();
  if (!row) return null;
  const [visible] = visibleRecordsFor(actor, [{ kind: "lead", data: JSON.parse(String(row.data)) as Record<string, unknown> }]);
  if (!visible) return null;
  const lead = visible.data as LeadData;
  const block = await replyBlock(db, actor, lead);
  return {
    view: "lead",
    lead: {
      id: String(row.id),
      name: str(lead.name),
      username: str(lead.senderUsername),
      temperature: temperatureOf(lead.temperature),
      source: str(lead.source),
      message: str(lead.message),
      reason: str(lead.reason),
      draft: str(lead.draft),
      messages: leadReplies(lead).map(leadMessage),
      canReply: block === null,
      ...(block === null ? {} : { replyBlockedReason: block }),
    },
  };
}
