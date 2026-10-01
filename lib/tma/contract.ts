/**
 * Telegram Mini App (TMA) API contract — shared by the server (`app/api/tma/**`) and the client
 * (`app/tma/**`, `lib/tma/client.ts`). Spec: docs/project/specs/tg-mini-app.md.
 *
 * Transport: JSON over HTTPS. After `POST /api/tma/session` every call carries
 * `Authorization: Bearer <token>`; no cookies are used by the mini app.
 * Mutations reuse `POST /api/workspace` ({action, kind?, id?, data?}) with the bearer; only
 * `TMA_ACTIONS` are accepted for a tma actor (server-side, on top of the web role rules).
 */
import { z } from "zod";

/** Path segment `/tma/<wsKey>`: opaque, random, per workspace (not the owner id). */
export const WS_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Max accepted initData size (Telegram sends ~1–3 KB). */
export const TMA_INIT_DATA_MAX_BYTES = 8192;

/** Actions a tma actor may call on POST /api/workspace (intersected with the member's web rules). */
export const TMA_ACTIONS = [
  "draft",
  "mark_lead_viewed",
  "send_lead_message",
  "check_account",
  "start_mailing",
  "pause_mailing",
  "start_audience",
  "pause_audience",
  "start_invite",
  "pause_invite",
  "mark_auto_rescan",
] as const;
export type TmaAction = (typeof TMA_ACTIONS)[number];

// ---- POST /api/tma/session -------------------------------------------------------------------
export const sessionRequestSchema = z.object({
  wsKey: z.string().regex(WS_KEY_RE),
  initData: z.string().min(1).max(TMA_INIT_DATA_MAX_BYTES),
});
export type SessionRequest = z.infer<typeof sessionRequestSchema>;

export type TmaRole = "owner" | "admin" | "manager" | "operator" | "viewer";

export type SessionResponse = {
  token: string;
  /** Unix seconds. */
  expiresAt: number;
  me: {
    name: string;
    role: TmaRole;
    /** CRM access keys the member has (lib/staff-types.ts::CRM_ACCESS_KEYS subset). */
    access: string[];
  };
  workspace: { name: string };
};

/** Error body for every tma endpoint. `code` drives the client screen. */
export type TmaErrorCode =
  | "bad_request"
  | "invalid_init_data" // 401: HMAC mismatch or malformed
  | "init_data_expired" // 401: auth_date too old / in the future
  | "session_expired" // 401: bearer missing/expired/invalid
  | "not_linked" // 403: tg user not linked to a member of this workspace
  | "workspace_unavailable" // 403: unknown wsKey or no bot token
  | "forbidden" // 403: action/view not allowed for this member
  | "rate_limited"; // 429
export type TmaError = { error: string; code: TmaErrorCode; botLink?: string };

// ---- GET /api/tma/feed?view=… -----------------------------------------------------------------
export const FEED_VIEWS = ["overview", "inbox", "lead", "accounts", "tasks"] as const;
export type FeedView = (typeof FEED_VIEWS)[number];
export const FEED_PAGE_SIZE = 30;

export const feedQuerySchema = z.object({
  view: z.enum(FEED_VIEWS),
  /** inbox: opaque cursor from the previous page. */
  cursor: z.string().max(200).optional(),
  /** inbox filter. */
  filter: z.enum(["all", "hot", "unread", "conversations"]).optional(),
  /** lead: lead id (uuid). */
  id: z.string().uuid().optional(),
});
export type FeedQuery = z.infer<typeof feedQuerySchema>;

export type Temperature = "hot" | "warm" | "cold";

export type InboxItem = {
  id: string;
  name: string;
  username: string;
  temperature: Temperature;
  /** Last message text (client or ours), ≤200 chars. */
  preview: string;
  /** ISO time of the last activity. */
  at: string;
  unread: boolean;
  needsManager: boolean;
  conversation: boolean;
  source: string;
};
export type InboxFeed = { view: "inbox"; items: InboxItem[]; nextCursor: string | null; counts: { hot: number; unread: number } };

export type LeadMessage = { from: "us" | "client"; text: string; at: string; status: "sent" | "pending" | "failed"; error?: string };
export type LeadFeed = {
  view: "lead";
  lead: {
    id: string;
    name: string;
    username: string;
    temperature: Temperature;
    source: string;
    /** Original message the lead was found by. */
    message: string;
    reason: string;
    draft: string;
    messages: LeadMessage[];
    /** Whether a DM can be sent now (account bound, not blocked). */
    canReply: boolean;
    replyBlockedReason?: string;
  };
};

export type AccountHealth = "ok" | "warming" | "paused" | "error" | "setup";
export type AccountItem = {
  id: string;
  name: string;
  phone: string; // masked: +7 *** ** 12
  username: string;
  health: AccountHealth;
  statusLabel: string;
  /** e.g. warm-up / daily caps: used of limit. */
  caps: { label: string; used: number; limit: number }[];
  reason: string;
  lastCheckedAt: string;
  checking: boolean;
};
export type AccountsFeed = { view: "accounts"; items: AccountItem[] };

export type TaskKind = "mailing" | "audience" | "invite" | "auto_rescan";
export type TaskStatus = "draft" | "scheduled" | "running" | "paused" | "completed" | "error";
export type TaskItem = {
  id: string;
  kind: TaskKind;
  name: string;
  status: TaskStatus;
  progress: { done: number; total: number } | null;
  error: string;
  updatedAt: string;
  /** Actions the member may call right now on this task (subset of TMA_ACTIONS). */
  actions: TmaAction[];
};
export type TasksFeed = { view: "tasks"; items: TaskItem[] };

export type OverviewFeed = {
  view: "overview";
  /** Since local midnight of the workspace (UTC if unknown). */
  today: { newLeads: number; hotLeads: number; replies: number; sent: number; invites: number };
  accounts: { total: number; ok: number; problems: number };
  tasks: { running: number; paused: number; error: number };
};

export type FeedResponse = OverviewFeed | InboxFeed | LeadFeed | AccountsFeed | TasksFeed;

// ---- Linking (web session, cookie) — POST /api/tma/link --------------------------------------
export const linkRequestSchema = z.object({
  action: z.enum(["create_code", "unlink", "status", "set_dm_notices"]),
  /** set_dm_notices */
  enabled: z.boolean().optional(),
  /** unlink: admins/owner may unlink another member by user id; default = self. */
  userId: z.string().max(100).optional(),
});
export type LinkStatus = {
  linked: boolean;
  tgUsername: string;
  dmNotices: boolean;
  dmError: string;
  /** t.me/<bot>?start=link_<code> when action=create_code. */
  startLink?: string;
  expiresAt?: number;
  /** Mini app URL for this workspace (https), empty if APP_URL is not public https. */
  appUrl: string;
};
