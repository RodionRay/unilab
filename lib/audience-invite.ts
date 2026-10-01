import { telegramEntityKey } from "@/lib/record-identity";

/** Журналы задач и разбор Telegram-ссылок. Модули сбора аудитории и инвайтинга удалены; путь сохранён ради импортов кабинета. */

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

/** Несколько событий журнала одним вызовом. */
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
