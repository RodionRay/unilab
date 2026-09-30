/** Модель аккаунтов/прокси по паттерну TGLab (docs.tglab.pro). */

export const ACCOUNT_STATUSES = [
  "setup",
  "checking",
  "active",
  "proxy_error",
  "disconnected",
  "unauthorized",
  "spamblock",
  "frozen",
  "cooldown",
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  setup: "Требует подключения",
  checking: "Проверяется",
  active: "Активный",
  proxy_error: "Ошибка прокси",
  disconnected: "Не подключен",
  unauthorized: "Не авторизован",
  spamblock: "Спамблок",
  frozen: "Заморожен",
  cooldown: "Отлежка",
};

export const PROXY_STATUSES = ["checking", "active", "inactive"] as const;
export type ProxyStatus = (typeof PROXY_STATUSES)[number];

export const PROXY_STATUS_LABELS: Record<ProxyStatus, string> = {
  checking: "Проверяется",
  active: "Активный",
  inactive: "Неактивный",
};

export type AccountLimits = {
  invite: number;
  message: number;
  chat: number;
};

export const DEFAULT_ACCOUNT_LIMITS: AccountLimits = {
  invite: 10,
  message: 10,
  chat: 10,
};

/**
 * Мягкие суточные лимиты под Telegram API / антиспам (как в TGLab и практике ферм).
 * Не официальная квота Bot API — ориентир для user-сессий.
 */
export const TELEGRAM_RECOMMENDED_LIMITS = {
  invite: 40,
  message: 40,
  chat: 20,
  memberInvite: 40,
} as const;

export type AccountFormat = "tdata" | "session" | "session_json" | "manual";
export type SessionMode = "keep" | "new";

export function accountStatusTone(status: string): "success" | "warning" | "danger" | "neutral" | "default" {
  if (status === "active") return "success";
  if (status === "setup" || status === "checking" || status === "cooldown") return "warning";
  if (
    status === "proxy_error" ||
    status === "disconnected" ||
    status === "unauthorized" ||
    status === "spamblock" ||
    status === "frozen" ||
    status === "inactive"
  ) {
    return "danger";
  }
  return "neutral";
}

export function isOnCooldown(cooldownUntil?: string | null): boolean {
  if (!cooldownUntil) return false;
  const t = Date.parse(cooldownUntil);
  return Number.isFinite(t) && t > Date.now();
}

/**
 * Дневная отлёжка: только явный status=cooldown + живой таймер.
 * Голый cooldownUntil (старый FloodWait/коннект) — НЕ отлёжка.
 */
export function isDayLimitCooldown(data: {
  status?: string | null;
  cooldownUntil?: string | null;
} | null | undefined): boolean {
  if (!data) return false;
  return String(data.status || "") === "cooldown" && isOnCooldown(data.cooldownUntil);
}

/** Можно ли ставить в работу (рассылка / инвайт / сбор / группы). */
export function isAccountUsable(data: {
  status?: string | null;
  cooldownUntil?: string | null;
} | null | undefined): boolean {
  if (!data) return false;
  const st = String(data.status || "");
  if (
    [
      "spamblock",
      "frozen",
      "unauthorized",
      "disconnected",
      "proxy_error",
      "checking",
      "setup",
      "inactive",
      "error",
    ].includes(st)
  ) {
    return false;
  }
  // Отлёжка только при явном status=cooldown и живом таймере (дневной лимит).
  if (st === "cooldown") {
    return !isOnCooldown(data.cooldownUntil);
  }
  // active / пустой / legacy — cooldownUntil без статуса cooldown игнорируем (старые фейлы коннекта).
  return !st || st === "active" || st === "ok" || st === "connected";
}

/**
 * Можно ли читать входящие ЛС.
 * spamblock/cooldown — писать нельзя, но ответы клиентов всё ещё приходят в эту сессию.
 */
export function canPollDmInbox(data: {
  status?: string | null;
} | null | undefined): boolean {
  if (!data) return false;
  const st = String(data.status || "");
  if (
    [
      "frozen",
      "unauthorized",
      "disconnected",
      "proxy_error",
      "checking",
      "setup",
      "inactive",
      "error",
    ].includes(st)
  ) {
    return false;
  }
  // active / cooldown / spamblock / пустой / legacy
  return (
    !st ||
    st === "active" ||
    st === "ok" ||
    st === "connected" ||
    st === "cooldown" ||
    st === "spamblock"
  );
}

export function cooldownLabel(cooldownUntil?: string | null): string {
  if (!isOnCooldown(cooldownUntil)) return "";
  return `до ${new Date(cooldownUntil!).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК`;
}

/** Авто-отлежка на N часов (спамблок). */
export function cooldownHoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

export type DayLimitKind = "invite" | "message" | "chat" | "memberInvite";

const DAY_LIMIT_LABELS: Record<DayLimitKind, string> = {
  invite: "вступлений",
  message: "сообщений (рассылка/ЛС)",
  chat: "комментариев",
  memberInvite: "инвайтов участников",
};

/**
 * Отлёжка только по правилам продукта:
 * — дневной лимит (до полуночи МСК);
 * — spamblock / PEER_FLOOD;
 * — заморозка Telegram.
 * FloodWait и ошибка коннекта/прокси — НЕ отлёжка.
 */
export function withDayLimitCooldown<T extends Record<string, unknown>>(
  data: T,
  kind: DayLimitKind,
): T & {
  status: "cooldown";
  cooldownUntil: string;
  cooldownReason: string;
  error: string;
} {
  return {
    ...data,
    status: "cooldown",
    cooldownUntil: moscowNextMidnightIso(),
    cooldownReason: `day_${kind}`,
    error: `Дневной лимит ${DAY_LIMIT_LABELS[kind]} исчерпан — до полуночи МСК`,
  };
}

export function withSpamblockStatus<T extends Record<string, unknown>>(
  data: T,
  error = "PEER_FLOOD",
): T & {
  status: "spamblock";
  cooldownUntil: string;
  cooldownReason: string;
  error: string;
} {
  return {
    ...data,
    status: "spamblock",
    cooldownUntil: cooldownHoursFromNow(24),
    cooldownReason: "spamblock",
    error: String(error || "PEER_FLOOD").slice(0, 500),
  };
}

export function withFrozenStatus<T extends Record<string, unknown>>(
  data: T,
  error = "Аккаунт заморожен Telegram",
): T & {
  status: "frozen";
  cooldownUntil: string;
  cooldownReason: string;
  error: string;
} {
  return {
    ...data,
    status: "frozen",
    // Заморозка — не таймер отлёжки; статус frozen достаточно для блокировки.
    cooldownUntil: "",
    cooldownReason: "frozen",
    error: String(error || "Аккаунт заморожен Telegram").slice(0, 500),
  };
}

export function hasChatQuota(data: {
  limits?: { chat?: unknown };
  chatsToday?: number;
  chatsDay?: string;
} | null | undefined): boolean {
  if (!data) return false;
  return hasDayQuota(
    dayCounter(data.chatsDay, data.chatsToday),
    data.limits?.chat ?? DEFAULT_ACCOUNT_LIMITS.chat,
  );
}

export function bumpChatCounters<T extends Record<string, unknown>>(
  data: T,
  n = 1,
): T & { chatsDay: string; chatsToday: number } {
  const day = moscowDayKey();
  const prev = (data as { chatsDay?: string; chatsToday?: number }).chatsDay === day
    ? Number((data as { chatsToday?: number }).chatsToday) || 0
    : 0;
  return {
    ...data,
    chatsDay: day,
    chatsToday: prev + Math.max(0, n),
  };
}

/** Если после операции дневной лимит кончился — увести в отлёжку до полуночи. */
export function applyQuotaCooldownIfExhausted<T extends Record<string, unknown>>(
  data: T,
): T {
  const st = String((data as { status?: string }).status || "");
  if (st === "spamblock" || st === "frozen") return data;
  if (isDayLimitCooldown(data as { status?: string; cooldownUntil?: string })) {
    return data;
  }

  if (!hasInviteQuota(data as Parameters<typeof hasInviteQuota>[0])) {
    return withDayLimitCooldown(data, "invite");
  }
  if (!hasMessageQuota(data as Parameters<typeof hasMessageQuota>[0])) {
    return withDayLimitCooldown(data, "message");
  }
  if (!hasMemberInviteQuota(data as Parameters<typeof hasMemberInviteQuota>[0])) {
    return withDayLimitCooldown(data, "memberInvite");
  }
  if (!hasChatQuota(data as Parameters<typeof hasChatQuota>[0])) {
    return withDayLimitCooldown(data, "chat");
  }
  // Сброс «осиротевшего» таймера от старых FloodWait/коннект-фейлов.
  if (
    st !== "cooldown" &&
    isOnCooldown(String((data as { cooldownUntil?: string }).cooldownUntil || ""))
  ) {
    return {
      ...data,
      cooldownUntil: "",
      cooldownReason: "",
    };
  }
  return data;
}

/** Пауза между вступлениями в группы (антибан). */
export const JOIN_GAP_MIN_SEC = 180; // 3 мин
export const JOIN_GAP_MAX_SEC = 420; // 7 мин
export const JOIN_GAP_DEFAULT_SEC = 240; // 4 мин

export function moscowDayKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Следующая полночь по Москве — когда сбрасываются дневные лимиты. */
export function moscowNextMidnightIso(now = Date.now()): string {
  const mskHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Moscow",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  const mskMin = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Moscow",
      minute: "numeric",
    }).format(now),
  );
  const minsLeft = 24 * 60 - (mskHour * 60 + mskMin) + 1;
  return new Date(now + minsLeft * 60 * 1000).toISOString();
}

function dayCounter(
  dayKey: string | undefined,
  count: number | undefined,
): number {
  if (dayKey !== moscowDayKey()) return 0;
  return Math.max(0, Number(count) || 0);
}

/** 0 в настройках = без потолка. */
export function hasDayQuota(used: number, limit: unknown): boolean {
  const lim = Number(limit);
  if (!Number.isFinite(lim) || lim <= 0) return true;
  return used < lim;
}

export function hasInviteQuota(data: {
  limits?: { invite?: unknown };
  joinsToday?: number;
  joinsDay?: string;
} | null | undefined): boolean {
  if (!data) return false;
  return hasDayQuota(
    normalizeJoinsToday(data),
    data.limits?.invite ?? DEFAULT_ACCOUNT_LIMITS.invite,
  );
}

export function hasMessageQuota(data: {
  limits?: { message?: unknown };
  messagesToday?: number;
  messagesDay?: string;
} | null | undefined): boolean {
  if (!data) return false;
  return hasDayQuota(
    dayCounter(data.messagesDay, data.messagesToday),
    data.limits?.message ?? DEFAULT_ACCOUNT_LIMITS.message,
  );
}

export function hasMemberInviteQuota(data: {
  limits?: { memberInvite?: unknown };
  memberInvitesToday?: number;
  memberInviteDay?: string;
} | null | undefined): boolean {
  if (!data) return false;
  return hasDayQuota(
    dayCounter(data.memberInviteDay, data.memberInvitesToday),
    data.limits?.memberInvite ?? 40,
  );
}

export function bumpMessageCounters(
  state: { messagesToday?: number; messagesDay?: string },
  add: number,
): { messagesToday: number; messagesDay: string } {
  const day = moscowDayKey();
  const prev = state.messagesDay === day ? Number(state.messagesToday) || 0 : 0;
  return { messagesDay: day, messagesToday: prev + Math.max(0, add) };
}

export function randomJoinGapSec(): number {
  return (
    JOIN_GAP_MIN_SEC +
    Math.floor(Math.random() * (JOIN_GAP_MAX_SEC - JOIN_GAP_MIN_SEC + 1))
  );
}

export type JoinPaceState = {
  lastJoinAt?: string;
  joinsToday?: number;
  joinsDay?: string;
};

/** Сколько секунд ждать до следующего join. 0 = можно сейчас. */
export function joinWaitSec(
  state: JoinPaceState,
  now = Date.now(),
): number {
  if (!state.lastJoinAt) return 0;
  const last = Date.parse(state.lastJoinAt);
  if (!Number.isFinite(last)) return 0;
  const elapsed = (now - last) / 1000;
  const need = JOIN_GAP_DEFAULT_SEC;
  return elapsed >= need ? 0 : Math.ceil(need - elapsed);
}

export function normalizeJoinsToday(state: JoinPaceState): number {
  const day = moscowDayKey();
  if (state.joinsDay !== day) return 0;
  return Math.max(0, Number(state.joinsToday) || 0);
}

export function normalizeMessagesToday(data: {
  messagesToday?: number;
  messagesDay?: string;
} | null | undefined): number {
  if (!data) return 0;
  return dayCounter(data.messagesDay, data.messagesToday);
}

export function normalizeMemberInvitesToday(data: {
  memberInvitesToday?: number;
  memberInviteDay?: string;
} | null | undefined): number {
  if (!data) return 0;
  return dayCounter(data.memberInviteDay, data.memberInvitesToday);
}

export type AccountLimitsUsage = {
  joins: number;
  messages: number;
  memberInvites: number;
  inviteLimit: number;
  messageLimit: number;
  chatLimit: number;
  memberInviteLimit: number;
};

/** Суточные счётчики и лимиты для UI менеджера аккаунтов. */
export function accountLimitsUsage(data: {
  limits?: {
    invite?: unknown;
    message?: unknown;
    chat?: unknown;
    memberInvite?: unknown;
  };
  joinsToday?: number;
  joinsDay?: string;
  messagesToday?: number;
  messagesDay?: string;
  memberInvitesToday?: number;
  memberInviteDay?: string;
} | null | undefined): AccountLimitsUsage {
  const limits = data?.limits || {};
  const inviteLimit = Number(limits.invite);
  const messageLimit = Number(limits.message);
  const chatLimit = Number(limits.chat);
  const memberInviteLimit = Number(limits.memberInvite);
  return {
    joins: normalizeJoinsToday(data || {}),
    messages: normalizeMessagesToday(data),
    memberInvites: normalizeMemberInvitesToday(data),
    inviteLimit: Number.isFinite(inviteLimit) ? inviteLimit : DEFAULT_ACCOUNT_LIMITS.invite,
    messageLimit: Number.isFinite(messageLimit)
      ? messageLimit
      : DEFAULT_ACCOUNT_LIMITS.message,
    chatLimit: Number.isFinite(chatLimit) ? chatLimit : DEFAULT_ACCOUNT_LIMITS.chat,
    memberInviteLimit: Number.isFinite(memberInviteLimit) ? memberInviteLimit : 40,
  };
}

/** Короткий хвост отлёжки: «5 часов», «40 мин»; пусто если нет. */
export function cooldownRemainingShort(
  cooldownUntil?: string | null,
  now = Date.now(),
): string {
  if (!cooldownUntil) return "";
  const t = Date.parse(cooldownUntil);
  if (!Number.isFinite(t) || t <= now) return "";
  const mins = Math.max(1, Math.round((t - now) / 60_000));
  if (mins < 60) return `${mins} мин`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "час" : hours < 5 ? "часа" : "часов"}`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "день" : days < 5 ? "дня" : "дней"}`;
}

/** Относительное «обновлено»: «39 минут назад». */
export function relativeTimeRu(iso?: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 45) return "только что";
  const mins = Math.round(sec / 60);
  if (mins < 60) {
    return `${mins} ${mins === 1 ? "минуту" : mins < 5 ? "минуты" : "минут"} назад`;
  }
  const hours = Math.round(mins / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? "час" : hours < 5 ? "часа" : "часов"} назад`;
  }
  const days = Math.round(hours / 24);
  if (days < 14) {
    return `${days} ${days === 1 ? "день" : days < 5 ? "дня" : "дней"} назад`;
  }
  return new Date(t).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Лучшая метка «обновлено» для строки аккаунта. */
export function accountUpdatedAt(data: {
  checkingAt?: string;
  lastJoinAt?: string;
  lastChecked?: string;
} | null | undefined, created?: string): string {
  const candidates = [
    data?.checkingAt,
    data?.lastChecked,
    data?.lastJoinAt,
    created,
  ].filter(Boolean) as string[];
  if (!candidates.length) return "";
  return candidates.reduce((best, cur) =>
    Date.parse(cur) > Date.parse(best) ? cur : best,
  );
}

const AVATAR_PALETTE = [
  "#eab308",
  "#22c55e",
  "#84cc16",
  "#ef4444",
  "#15803d",
  "#3b82f6",
  "#a855f7",
  "#f97316",
  "#06b6d4",
  "#ec4899",
];

export function accountAvatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]!;
}

export function bumpJoinCounters(state: JoinPaceState): JoinPaceState {
  const day = moscowDayKey();
  const prev = state.joinsDay === day ? Number(state.joinsToday) || 0 : 0;
  return {
    ...state,
    lastJoinAt: new Date().toISOString(),
    joinsDay: day,
    joinsToday: prev + 1,
  };
}

const USERNAME_A = ["nova","mira","lumen","orbit","pixel","cedar","harbor","maple","quark","velvet","cobalt","nimbus","atlas","sierra","echo","zen","fox","oak","iris","sol","river","cloud"];
const USERNAME_B = ["lab","hub","note","desk","path","wave","node","mint","peak","kite","flow","nest","spark","field"];

/** Случайный @username под правила Telegram: 5–32, a-z0-9_, начинается с буквы. */
export function generateTelegramUsername(taken?: Iterable<string>): string {
  const used = new Set(
    [...(taken || [])]
      .map((u) => String(u || "").replace(/^@/, "").trim().toLowerCase())
      .filter(Boolean),
  );
  for (let i = 0; i < 50; i++) {
    const a = USERNAME_A[Math.floor(Math.random() * USERNAME_A.length)]!;
    const b = USERNAME_B[Math.floor(Math.random() * USERNAME_B.length)]!;
    const n = 10 + Math.floor(Math.random() * 990);
    const u = `${a}${b}${n}`;
    if (!used.has(u) && u.length >= 5 && u.length <= 32 && /^[a-z]/.test(u)) return u;
  }
  return `user${Date.now().toString(36)}${Math.floor(Math.random() * 99)}`.slice(0, 32);
}
