import type { D1LikeDatabase } from "@/lib/db";
import { authorizeWorkspaceAction, visibleRecordsFor, type WorkspaceActor } from "@/lib/security/workspace-authz";
import {
  ACCOUNT_STATUS_LABELS,
  accountLimitsUsage,
  cooldownRemainingShort,
  isAccountFlooded,
  isOnCooldown,
  type AccountStatus,
} from "@/lib/telegram-accounts";
import type {
  AccountHealth,
  AccountItem,
  AccountsFeed,
  OverviewFeed,
  TaskItem,
  TaskKind,
  TaskStatus,
  TasksFeed,
  TmaAction,
} from "@/lib/tma/contract";

/** Accounts, tasks and overview projections (REQ-M3–M5). Only whitelisted fields leave the server. */

const ACCOUNTS_MAX = 200;
const TASKS_MAX = 100;
const TASK_STATUSES: readonly TaskStatus[] = ["draft", "scheduled", "running", "paused", "completed", "error"];
const BROKEN_STATUSES = new Set(["frozen", "unauthorized", "disconnected", "proxy_error", "inactive", "error"]);
const MSK_OFFSET_MS = 3 * 3600_000;
const DAY_MS = 86_400_000;

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

/** `+7 *** ** 12`: country lead digit and the last two digits only. */
export function maskPhone(raw: unknown): string {
  const digits = str(raw).replace(/\D/g, "");
  if (digits.length < 4) return digits ? "***" : "";
  return `+${digits[0]} *** ** ${digits.slice(-2)}`;
}

type AccountFields = {
  status: string;
  cooldownUntil: string;
  floodUntil: string;
  lastChecked: string;
};

export function accountHealth(a: AccountFields): AccountHealth {
  const st = a.status;
  if (st === "setup") return "setup";
  if (st === "checking") return a.lastChecked ? "ok" : "setup";
  if (BROKEN_STATUSES.has(st)) return "error";
  if (st === "spamblock") {
    if (!a.cooldownUntil) return "error";
    return isOnCooldown(a.cooldownUntil) ? "paused" : "ok";
  }
  if (st === "cooldown" && isOnCooldown(a.cooldownUntil)) return "paused";
  return isAccountFlooded({ floodUntil: a.floodUntil }) ? "paused" : "ok";
}

const ACCOUNT_FIELDS = [
  "name", "phone", "username", "status", "error", "checkError", "cooldownUntil", "floodUntil", "lastChecked", "checkingAt",
  "joinsToday", "joinsDay", "messagesToday", "messagesDay", "memberInvitesToday", "memberInviteDay",
] as const;

function accountColumns(): string {
  return ACCOUNT_FIELDS.map((f) => `json_extract(data,'$.${f}') AS "${f}"`).join(", ") + `, json_extract(data,'$.limits') AS "limits"`;
}

async function accountRows(db: D1LikeDatabase, owner: string): Promise<{ id: string; kind: string; data: Record<string, unknown> }[]> {
  const rows = await db
    .prepare(`SELECT id, ${accountColumns()} FROM records WHERE owner=? AND kind='account' ORDER BY created ASC LIMIT ?`)
    .bind(owner, ACCOUNTS_MAX)
    .all();
  return rows.results.map((r) => {
    const { id, limits, ...rest } = r;
    let parsedLimits: Record<string, unknown> = {};
    try {
      parsedLimits = limits ? (JSON.parse(String(limits)) as Record<string, unknown>) : {};
    } catch {
      /* malformed limits → defaults */
    }
    return { id: String(id), kind: "account", data: { ...rest, limits: parsedLimits } };
  });
}

function accountItem(id: string, d: Record<string, unknown>): AccountItem {
  const fields: AccountFields = {
    status: str(d.status),
    cooldownUntil: str(d.cooldownUntil),
    floodUntil: str(d.floodUntil),
    lastChecked: str(d.lastChecked),
  };
  const health = accountHealth(fields);
  const usage = accountLimitsUsage(d as Parameters<typeof accountLimitsUsage>[0]);
  const wait = cooldownRemainingShort(fields.cooldownUntil);
  const reason = str(d.error) || str(d.checkError) || (health === "paused" && wait ? `Пауза ещё ${wait}` : "");
  return {
    id,
    name: str(d.name),
    phone: maskPhone(d.phone),
    username: str(d.username),
    health,
    statusLabel: ACCOUNT_STATUS_LABELS[fields.status as AccountStatus] ?? (fields.status || "Активный"),
    caps: [
      { label: "Сообщения", used: usage.messages, limit: usage.messageLimit },
      { label: "Вступления", used: usage.joins, limit: usage.inviteLimit },
      { label: "Инвайты", used: usage.memberInvites, limit: usage.memberInviteLimit },
    ],
    reason: reason.slice(0, 300),
    lastCheckedAt: fields.lastChecked,
    checking: fields.status === "checking",
  };
}

export async function accountsFeed(db: D1LikeDatabase, actor: WorkspaceActor): Promise<AccountsFeed> {
  const visible = visibleRecordsFor(actor, await accountRows(db, actor.ownerId));
  return { view: "accounts", items: visible.map((r) => accountItem(r.id, r.data)) };
}

type TaskRecordKind = "mailing_task" | "audience_task" | "invite_task";
const TASK_KINDS: Readonly<Record<TaskRecordKind, { kind: TaskKind; start: TmaAction; pause: TmaAction; done: string; total: string }>> = {
  mailing_task: { kind: "mailing", start: "start_mailing", pause: "pause_mailing", done: "sentTotal", total: "total" },
  audience_task: { kind: "audience", start: "start_audience", pause: "pause_audience", done: "collected", total: "total" },
  invite_task: { kind: "invite", start: "start_invite", pause: "pause_invite", done: "done", total: "total" },
};

function taskStatus(v: unknown): TaskStatus {
  return TASK_STATUSES.includes(v as TaskStatus) ? (v as TaskStatus) : "draft";
}

function allowed(actor: WorkspaceActor, action: TmaAction): boolean {
  return authorizeWorkspaceAction(actor, action, undefined).ok;
}

function taskActions(actor: WorkspaceActor, kind: TaskRecordKind, status: TaskStatus): TmaAction[] {
  const spec = TASK_KINDS[kind];
  if (status === "running" || status === "scheduled") return allowed(actor, spec.pause) ? [spec.pause] : [];
  if (status === "draft" || status === "paused" || status === "error") return allowed(actor, spec.start) ? [spec.start] : [];
  return [];
}

async function recordTasks(db: D1LikeDatabase, actor: WorkspaceActor): Promise<TaskItem[]> {
  // Heavy fields (deliveries, deliveredKeys, logs) never leave SQLite: only the projected columns are read.
  const rows = await db
    .prepare(
      `SELECT id, kind, created,
        json_extract(data,'$.name') AS name, json_extract(data,'$.title') AS title, json_extract(data,'$.status') AS status,
        json_extract(data,'$.error') AS error, json_extract(data,'$.lastTickAt') AS lastTickAt,
        json_extract(data,'$.sentTotal') AS sentTotal, json_extract(data,'$.collected') AS collected,
        json_extract(data,'$.done') AS done, json_extract(data,'$.total') AS total
       FROM records WHERE owner=? AND kind IN ('mailing_task','audience_task','invite_task')
       ORDER BY created DESC LIMIT ?`,
    )
    .bind(actor.ownerId, TASKS_MAX)
    .all();
  const visible = visibleRecordsFor(actor, rows.results.map((r) => ({ kind: String(r.kind), data: r })));
  return visible.map(({ kind, data: r }) => {
    const spec = TASK_KINDS[kind as TaskRecordKind];
    const status = taskStatus(r.status);
    const total = Number(r[spec.total]) || 0;
    return {
      id: String(r.id),
      kind: spec.kind,
      name: str(r.name || r.title).slice(0, 200),
      status,
      progress: total > 0 ? { done: Number(r[spec.done]) || 0, total } : null,
      error: str(r.error).slice(0, 300),
      updatedAt: str(r.lastTickAt || r.created),
      actions: taskActions(actor, kind as TaskRecordKind, status),
    };
  });
}

/** Auto-rescan of groups is a workspace setting, shown as one task row for members with the groups section. */
async function autoRescanTask(db: D1LikeDatabase, actor: WorkspaceActor): Promise<TaskItem | null> {
  if (!visibleRecordsFor(actor, [{ kind: "group", data: {} }]).length) return null;
  const row = await db
    .prepare(
      `SELECT json_extract(data,'$.autoRescanEnabled') AS enabled, json_extract(data,'$.lastAutoRescanAt') AS lastAt,
        json_extract(data,'$.rescanLog[#-1].level') AS level, json_extract(data,'$.rescanLog[#-1].text') AS text
       FROM records WHERE owner=? AND kind='settings' LIMIT 1`,
    )
    .bind(actor.ownerId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  const failed = row.level === "warn" || row.level === "error";
  return {
    id: "auto_rescan",
    kind: "auto_rescan",
    name: "Автообход групп",
    status: row.enabled === 0 ? "paused" : "running",
    progress: null,
    error: failed ? str(row.text).slice(0, 300) : "",
    updatedAt: str(row.lastAt),
    // Turning auto-rescan on/off is a settings save, outside TMA_ACTIONS; the row is read-only here.
    actions: [],
  };
}

export async function tasksFeed(db: D1LikeDatabase, actor: WorkspaceActor): Promise<TasksFeed> {
  const items = await recordTasks(db, actor);
  const rescan = await autoRescanTask(db, actor);
  return { view: "tasks", items: rescan ? [rescan, ...items] : items };
}

/** Moscow midnight (the CRM's day boundary for every daily counter) as an ISO string. */
export function moscowMidnightIso(nowMs = Date.now()): string {
  return new Date(Math.floor((nowMs + MSK_OFFSET_MS) / DAY_MS) * DAY_MS - MSK_OFFSET_MS).toISOString();
}

export async function overviewFeed(db: D1LikeDatabase, actor: WorkspaceActor, nowMs = Date.now()): Promise<OverviewFeed> {
  const since = moscowMidnightIso(nowMs);
  const owner = actor.ownerId;
  const leads = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN created>=? THEN 1 ELSE 0 END),0) AS newLeads,
        COALESCE(SUM(CASE WHEN created>=? AND json_extract(data,'$.temperature')='hot' THEN 1 ELSE 0 END),0) AS hotLeads
       FROM records WHERE owner=? AND kind='lead'`,
    )
    .bind(since, since, owner)
    .first<{ newLeads: number; hotLeads: number }>();
  const replies = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM records r, json_each(r.data,'$.replies') j
       WHERE r.owner=? AND r.kind='lead' AND json_extract(j.value,'$.from')='client' AND json_extract(j.value,'$.at')>=?`,
    )
    .bind(owner, since)
    .first<{ n: number }>();
  const tasks = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN json_extract(data,'$.status')='running' THEN 1 ELSE 0 END),0) AS running,
        COALESCE(SUM(CASE WHEN json_extract(data,'$.status')='paused' THEN 1 ELSE 0 END),0) AS paused,
        COALESCE(SUM(CASE WHEN json_extract(data,'$.status')='error' THEN 1 ELSE 0 END),0) AS error
       FROM records WHERE owner=? AND kind IN ('mailing_task','audience_task','invite_task')`,
    )
    .bind(owner)
    .first<{ running: number; paused: number; error: number }>();
  const accounts = (await accountRows(db, owner)).map((r) => accountItem(r.id, r.data));
  const sum = (label: string) => accounts.reduce((n, a) => n + (a.caps.find((c) => c.label === label)?.used ?? 0), 0);
  return {
    view: "overview",
    today: {
      newLeads: Number(leads?.newLeads) || 0,
      hotLeads: Number(leads?.hotLeads) || 0,
      replies: Number(replies?.n) || 0,
      sent: sum("Сообщения"),
      invites: sum("Инвайты"),
    },
    accounts: {
      total: accounts.length,
      ok: accounts.filter((a) => a.health === "ok").length,
      problems: accounts.filter((a) => a.health === "error").length,
    },
    tasks: { running: Number(tasks?.running) || 0, paused: Number(tasks?.paused) || 0, error: Number(tasks?.error) || 0 },
  };
}
