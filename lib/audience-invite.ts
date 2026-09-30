import { telegramEntityKey } from "@/lib/record-identity";

/** Типы и хелперы модулей «Сбор аудитории» и «Инвайтинг». */

export const AUDIENCE_TASK_STATUSES = [
  "draft",
  "scheduled",
  "running",
  "paused",
  "completed",
  "error",
] as const;
export type AudienceTaskStatus = (typeof AUDIENCE_TASK_STATUSES)[number];

export const AUDIENCE_STATUS_LABELS: Record<AudienceTaskStatus, string> = {
  draft: "Черновик",
  scheduled: "Запланирован",
  running: "Идёт сбор",
  paused: "Остановлен",
  completed: "Завершён",
  error: "Ошибка",
};

export const AUDIENCE_SOURCE_KINDS = ["channel", "chat", "custom"] as const;
export type AudienceSourceKind = (typeof AUDIENCE_SOURCE_KINDS)[number];

export const AUDIENCE_SOURCE_LABELS: Record<AudienceSourceKind, string> = {
  channel: "Каналы",
  chat: "Чаты",
  custom: "Своя база",
};

export const COLLECT_MODES = ["discussions", "comments"] as const;
export type CollectMode = (typeof COLLECT_MODES)[number];

export const COLLECT_RANGE_MODES = ["count", "period"] as const;
export type CollectRangeMode = (typeof COLLECT_RANGE_MODES)[number];

export const PREMIUM_FILTERS = ["all", "only", "exclude"] as const;
export type PremiumFilter = (typeof PREMIUM_FILTERS)[number];

export const USER_STATUS_FILTERS = [
  "all",
  "online",
  "recently",
  "last_week",
  "last_month",
  "long_ago",
] as const;
export type UserStatusFilter = (typeof USER_STATUS_FILTERS)[number];

/** Конкретные статусы без «все» — для мультивыбора. */
export const USER_STATUS_OPTIONS = [
  "online",
  "recently",
  "last_week",
  "last_month",
  "long_ago",
] as const;
export type UserStatusOption = (typeof USER_STATUS_OPTIONS)[number];

export const USER_STATUS_OPTION_LABELS: Record<UserStatusOption, string> = {
  online: "Онлайн",
  recently: "Недавно",
  last_week: "На прошлой неделе",
  last_month: "В этом месяце",
  long_ago: "Давно",
};

/**
 * Нормализация фильтра статусов.
 * Пустой массив / «all» → все статусы.
 * Старое поле statusFilter:string тоже принимается.
 */
export function normalizeStatusFilters(
  input: unknown,
  legacySingle?: unknown,
): UserStatusOption[] {
  const allowed = new Set<string>(USER_STATUS_OPTIONS);
  const fromList = (raw: unknown): UserStatusOption[] => {
    if (!Array.isArray(raw)) return [];
    const out: UserStatusOption[] = [];
    for (const v of raw) {
      const s = String(v || "");
      if (s === "all") return [];
      if (allowed.has(s) && !out.includes(s as UserStatusOption)) {
        out.push(s as UserStatusOption);
      }
    }
    return out;
  };
  const multi = fromList(input);
  if (multi.length) return multi;
  const single = String(legacySingle ?? "").trim();
  if (single && single !== "all" && allowed.has(single)) {
    return [single as UserStatusOption];
  }
  return [];
}

/** Подпись для UI: «Все статусы» или «Онлайн, Недавно». */
export function statusFiltersLabel(filters: UserStatusOption[]): string {
  if (!filters.length) return "Все статусы";
  return filters.map((f) => USER_STATUS_OPTION_LABELS[f] || f).join(", ");
}

export const INVITE_TASK_STATUSES = [
  "draft",
  "scheduled",
  "running",
  "paused",
  "completed",
  "error",
] as const;
export type InviteTaskStatus = (typeof INVITE_TASK_STATUSES)[number];

export const INVITE_STATUS_LABELS: Record<InviteTaskStatus, string> = {
  draft: "Черновик",
  scheduled: "Запланирован",
  running: "Идёт",
  paused: "Остановлен",
  completed: "Завершён",
  error: "Ошибка",
};

export const INVITE_MODES = ["ordinary", "advanced"] as const;
export type InviteMode = (typeof INVITE_MODES)[number];

export const INVITE_MODE_LABELS: Record<InviteMode, string> = {
  ordinary: "Обычный",
  advanced: "Продвинутый",
};

export type TaskLogEntry = {
  at: string;
  level: "info" | "ok" | "warn" | "error";
  text: string;
};

export function pushTaskLog(
  log: TaskLogEntry[] | undefined,
  level: TaskLogEntry["level"],
  text: string,
  max = 200,
): TaskLogEntry[] {
  const next = [
    ...(log || []),
    { at: new Date().toISOString(), level, text: text.slice(0, 400) },
  ];
  return next.slice(-max);
}

/** Несколько событий одним тиком (как в TGLab: инвайт → ожидание → смена аккаунта). */
export function pushTaskLogs(
  log: TaskLogEntry[] | undefined,
  entries: { level: TaskLogEntry["level"]; text: string }[],
  max = 200,
): TaskLogEntry[] {
  let next = log || [];
  const at = new Date().toISOString();
  for (const e of entries) {
    next = [...next, { at, level: e.level, text: e.text.slice(0, 400) }];
  }
  return next.slice(-max);
}

/** «16 сен, 13:30» МСК — для отлёжки / автозапуска в логах. */
export function formatRuWhen(iso: string | number | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d
    .toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function bracketLabel(raw: string | null | undefined, fallback = "—"): string {
  const s = String(raw || "")
    .trim()
    .replace(/^@+/, "");
  return `[${s || fallback}]`;
}

export function inviteUserOkText(username: string, userId?: string): string {
  const label = username
    ? bracketLabel(username)
    : bracketLabel(userId ? `id${userId}` : "", "без_username");
  return `Пригласил пользователя ${label}`;
}

export function inviteUserFailText(
  username: string,
  error: string,
  userId?: string,
): string {
  const label = username
    ? bracketLabel(username)
    : bracketLabel(userId ? `id${userId}` : "", "без_username");
  const e = String(error || "").toLowerCase();
  if (e.includes("privacy") || e.includes("privacy_restricted")) {
    return `Пользователь ${label} запретил приглашать себя в группы`;
  }
  if (e.includes("already")) {
    return `Пользователь ${label} уже в группе`;
  }
  if (e.includes("no_entity") || e.includes("username_not_occupied")) {
    return `Не удалось найти пользователя ${label}`;
  }
  if (e.includes("need_admin") || e.includes("chat_admin_required")) {
    return `Нет прав для приглашения ${label}`;
  }
  if (
    e.includes("chat_member_add_failed") ||
    e.includes("user_not_mutual_contact") ||
    e.includes("user_channels_too_much")
  ) {
    return `Не удалось пригласить пользователя ${label}`;
  }
  const short = String(error || "ошибка").slice(0, 80);
  return `Ошибка приглашения ${label}: ${short}`;
}

export function normalizeTgRef(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  if (s.startsWith("https://t.me/") || s.startsWith("@")) return s;
  if (/^[a-zA-Z0-9_]{5,32}$/.test(s)) return `@${s}`;
  return s;
}

export function displayTgHandle(url: string): string {
  const s = (url || "").trim();
  const m = s.match(/(?:t\.me\/|@)([a-zA-Z0-9_]+)/i);
  if (m) return `@${m[1]}`;
  return s.slice(0, 40) || "—";
}

/** Разбор списка ссылок/username для массового добавления групп. */
export function parseGroupUrlLines(raw: string): { url: string; name: string }[] {
  const chunks = String(raw || "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: { url: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    // вытащить t.me/… из строки с мусором
    const link = chunk.match(
      /(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/)(?:\+|joinchat\/)?[^\s<>"']+/i,
    );
    let url = "";
    if (link) {
      url = link[0].startsWith("http") ? link[0] : `https://${link[0]}`;
      url = url.replace(/^https?:\/\/telegram\.me\//i, "https://t.me/");
    } else if (/^@[a-zA-Z0-9_]{5,32}$/.test(chunk)) {
      url = `https://t.me/${chunk.slice(1)}`;
    } else if (/^[a-zA-Z0-9_]{5,32}$/.test(chunk)) {
      url = `https://t.me/${chunk}`;
    } else {
      continue;
    }
    url = url.replace(/[.,;:!?)]+$/, "");
    // всегда https://t.me/…
    if (url.startsWith("@")) url = `https://t.me/${url.slice(1)}`;
    if (!/^https:\/\/t\.me\//i.test(url)) continue;
    const key = telegramEntityKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const handle = displayTgHandle(url).replace(/^@/, "");
    const name =
      handle && handle !== "—"
        ? handle
        : url.includes("+") || /joinchat/i.test(url)
          ? "Инвайт-группа"
          : "Группа";
    out.push({ url, name });
  }
  return out.slice(0, 200);
}

/** Ссылка на сообщение в публичном чате / супергруппе. */
export function telegramMessageLink(
  groupUrl: string,
  messageId: string,
  chatId = "",
): string {
  const mid = String(messageId || "").replace(/\D/g, "");
  if (!mid) return "";
  const url = String(groupUrl || "").trim();
  const pub = url.match(/t\.me\/([A-Za-z][\w]{3,})(?:\/\d+)?/i);
  if (pub?.[1] && !/^(c|joinchat)$/i.test(pub[1])) {
    return `https://t.me/${pub[1]}/${mid}`;
  }
  let cid = String(chatId || "").trim();
  if (cid.startsWith("-100")) cid = cid.slice(4);
  else if (cid.startsWith("-")) cid = cid.slice(1);
  if (/^\d+$/.test(cid)) return `https://t.me/c/${cid}/${mid}`;
  const priv = url.match(/t\.me\/c\/(\d+)/i);
  if (priv?.[1]) return `https://t.me/c/${priv[1]}/${mid}`;
  return "";
}

export function remainSec(untilIso: string | undefined, now = Date.now()): number {
  const t = Date.parse(String(untilIso || ""));
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t - now) / 1000));
}

export function formatLiveClock(now = Date.now()): string {
  return new Date(now)
    .toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    .replace(",", "");
}

export function liveWaitLogText(
  text: string,
  at: string | undefined,
  nextAt: string | undefined,
  now = Date.now(),
): string {
  const m = String(text || "").match(/^Ожидание (\d+) секунд$/);
  if (!m) return text;
  const orig = Number(m[1]) || 0;
  const until = nextAt
    ? Date.parse(nextAt)
    : Date.parse(String(at || "")) + orig * 1000;
  if (!Number.isFinite(until)) return text;
  return `Ожидание ${Math.max(0, Math.ceil((until - now) / 1000))} секунд`;
}

export function relativeRu(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 60) return "только что";
  if (sec < 3600) return `${Math.floor(sec / 60)} мин назад`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ч назад`;
  const days = Math.floor(sec / 86400);
  if (days < 30) return `${days} ${days === 1 ? "день" : days < 5 ? "дня" : "дней"} назад`;
  const months = Math.floor(days / 30);
  return `${months} ${months === 1 ? "месяц" : months < 5 ? "месяца" : "месяцев"} назад`;
}

export function randomPauseSec(from: number, to: number): number {
  const a = Math.max(1, Math.min(3600, Number(from) || 15));
  const b = Math.max(a, Math.min(3600, Number(to) || a));
  return a + Math.floor(Math.random() * (b - a + 1));
}

export const DEFAULT_AUDIENCE_TASK = {
  name: "",
  url: "",
  sourceKind: "chat" as AudienceSourceKind,
  collectMode: "discussions" as CollectMode,
  rangeMode: "count" as CollectRangeMode,
  messageLimit: 5000,
  periodDays: 30,
  audienceScope: "no_admins" as "no_admins" | "all",
  premiumFilter: "all" as PremiumFilter,
  /** Пусто = все статусы; иначе мультивыбор. */
  statusFilters: [] as UserStatusOption[],
  /** @deprecated — совместимость со старыми задачами */
  statusFilter: "all" as UserStatusFilter,
  accountIds: [] as string[],
  status: "draft" as AudienceTaskStatus,
  total: 0,
  collected: 0,
  cursor: "",
  hasMore: true,
  autoStart: true,
  lastTickAt: "",
  error: "",
  log: [] as TaskLogEntry[],
  title: "",
};

export const DEFAULT_INVITE_TASK = {
  name: "",
  mode: "ordinary" as InviteMode,
  targetUrl: "",
  audienceTaskId: "",
  accountIds: [] as string[],
  batchSize: 1,
  dailyLimitEnabled: false,
  dailyLimit: 50,
  stopDisconnectedPct: 30,
  pauseFromSec: 15,
  pauseToSec: 15,
  pauseBetweenAccounts: false,
  autoStart: true,
  status: "draft" as InviteTaskStatus,
  done: 0,
  total: 0,
  invitedToday: 0,
  inviteDay: "",
  nextAt: "",
  accountIndex: 0,
  cursorUserId: "",
  error: "",
  log: [] as TaskLogEntry[],
  lastTickAt: "",
};
