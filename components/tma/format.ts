import type { TaskKind } from "@/lib/tma/contract";

const TIME = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const WEEKDAY = new Intl.DateTimeFormat("ru-RU", { weekday: "short" });
const DAY_MONTH = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
const DAY_MONTH_LONG = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const FULL_DATE = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function daysAgo(at: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
}

function parse(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Chat-list time, like Telegram: «14:02» today, «вчера», «пн» this week, «12 сент.» this year. Never seconds. */
export function formatListTime(iso: string, now: Date = new Date()): string {
  const at = parse(iso);
  if (!at) return "";
  const ago = daysAgo(at, now);
  if (ago <= 0) return TIME.format(at);
  if (ago === 1) return "вчера";
  if (ago < 7) return WEEKDAY.format(at);
  if (at.getFullYear() === now.getFullYear()) return DAY_MONTH.format(at).replace(/\.$/, "");
  return FULL_DATE.format(at);
}

export function formatClock(iso: string): string {
  const at = parse(iso);
  return at ? TIME.format(at) : "";
}

/** Day separator in a conversation: «Сегодня», «Вчера», «12 сентября». */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const at = parse(iso);
  if (!at) return "";
  const ago = daysAgo(at, now);
  if (ago <= 0) return "Сегодня";
  if (ago === 1) return "Вчера";
  return DAY_MONTH_LONG.format(at);
}

export function dayKey(iso: string): string {
  const at = parse(iso);
  return at ? `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}` : "";
}

/** «проверен 14:02» / «проверен вчера» / «проверен 28 сент» — relative to now, no seconds. */
export function formatChecked(iso: string, now: Date = new Date()): string {
  const at = parse(iso);
  if (!at) return "ещё не проверялся";
  const ago = daysAgo(at, now);
  if (ago <= 0) return `проверен ${TIME.format(at)}`;
  if (ago === 1) return "проверен вчера";
  return `проверен ${DAY_MONTH.format(at).replace(/\.$/, "")}`;
}

/** Russian plural: plural(5, ["лид", "лида", "лидов"]) → «лидов». */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

const NUMBER = new Intl.NumberFormat("ru-RU");
export function formatNumber(n: number): string {
  return NUMBER.format(n);
}

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  mailing: "Рассылка",
  audience: "Сбор аудитории",
  invite: "Инвайтинг",
  auto_rescan: "Автообход групп",
};

const TASK_UNITS: Record<TaskKind, readonly [string, string, string]> = {
  mailing: ["сообщение", "сообщения", "сообщений"],
  audience: ["пользователь", "пользователя", "пользователей"],
  invite: ["приглашение", "приглашения", "приглашений"],
  auto_rescan: ["группа", "группы", "групп"],
};

/** «120 из 400 сообщений». */
export function formatProgress(kind: TaskKind, done: number, total: number): string {
  return `${formatNumber(done)} из ${formatNumber(total)} ${plural(total, TASK_UNITS[kind])}`;
}

/** Initial for the avatar circle: first letter of the name, else of the username. */
export function initialOf(name: string, username: string): string {
  const src = (name || username || "?").replace(/^@/, "").trim();
  return (Array.from(src)[0] ?? "?").toUpperCase();
}

/** Telegram's 7 peer colours (iOS), picked stably from the id like Telegram does. */
const PEER_HUES = ["#e17076", "#faa774", "#a695e7", "#7bc862", "#6ec9cb", "#65aadd", "#ee7aae"] as const;
export function peerColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PEER_HUES[h % PEER_HUES.length] ?? PEER_HUES[0];
}
