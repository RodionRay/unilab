/** Канонический ключ группы/канала: @Name, t.me/Name и t.me/Name/123 — одна сущность. */
export function telegramEntityKey(raw: string): string {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(/[?#].*$/, "").replace(/\/+$/, "");
  s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (s.startsWith("@")) s = `t.me/${s.slice(1)}`;
  s = s.replace(/^telegram\.me\//i, "t.me/");
  const idx = s.search(/t\.me\//i);
  if (idx < 0) {
    if (/^[a-zA-Z0-9_]{5,32}$/.test(s)) return `t.me/${s.toLowerCase()}`;
    return s.toLowerCase();
  }
  const path = s.slice(idx + 5);
  if (/^joinchat\//i.test(path)) return `t.me/+${path.replace(/^joinchat\//i, "")}`;
  if (path.startsWith("+")) return `t.me/${path}`;
  if (/^c\/\d+/i.test(path)) {
    const parts = path.split("/");
    return `t.me/${parts[0]}/${parts[1]}`.toLowerCase();
  }
  const user = path.split("/")[0] || "";
  return user ? `t.me/${user.toLowerCase()}` : "";
}

/** Сохраняемый вид ссылки под схему t.me / @username. */
export function canonicalizeTgUrl(raw: string): string {
  const s = String(raw || "").trim();
  const key = telegramEntityKey(s);
  if (key.startsWith("t.me/")) return `https://${key}`;
  return s;
}

export function proxyIdentityKey(data: {
  host?: unknown;
  port?: unknown;
  protocol?: unknown;
  username?: unknown;
}): string {
  return [
    String(data.protocol || "socks5").trim().toLowerCase(),
    String(data.host || "").trim().toLowerCase(),
    String(Number(data.port) || 0),
    String(data.username || "").trim().toLowerCase(),
  ].join("|");
}

export function accountPhoneKey(phone: unknown): string {
  return String(phone || "").replace(/\D/g, "");
}

export function accountUsernameKey(username: unknown): string {
  return String(username || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();
}

const DUP_KINDS = new Set(["account", "proxy", "group", "audience_task", "invite_task"]);

export function isDuplicateKind(kind: string): boolean {
  return DUP_KINDS.has(kind);
}

/** Почему `incoming` совпадает с уже сохранённой записью того же kind. */
export function duplicateReason(kind: string, incoming: any, existing: any): string | null {
  if (!incoming || !existing) return null;
  if (kind === "account") {
    const phone = accountPhoneKey(incoming.phone);
    if (phone && phone === accountPhoneKey(existing.phone)) return "Аккаунт с этим номером уже есть";
    const user = accountUsernameKey(incoming.username);
    if (user && user === accountUsernameKey(existing.username)) return "Аккаунт с этим username уже есть";
    return null;
  }
  if (kind === "proxy") {
    if (proxyIdentityKey(incoming) === proxyIdentityKey(existing)) return "Такой прокси уже добавлен";
    return null;
  }
  if (kind === "group") {
    const a = telegramEntityKey(incoming.url);
    const b = telegramEntityKey(existing.url);
    if (a && a === b) return "Эта группа или канал уже есть в кабинете";
    return null;
  }
  if (kind === "audience_task") {
    const a = telegramEntityKey(incoming.url);
    const b = telegramEntityKey(existing.url);
    if (a && a === b) return "Сбор с этим источником уже создан";
    return null;
  }
  if (kind === "invite_task") {
    const a = telegramEntityKey(incoming.targetUrl);
    const b = telegramEntityKey(existing.targetUrl);
    if (
      a &&
      a === b &&
      String(incoming.audienceTaskId || "") === String(existing.audienceTaskId || "")
    ) {
      return "Инвайт в эту группу из этой базы уже создан";
    }
    return null;
  }
  return null;
}

export function findDuplicate<T extends { id: string; data: any; kind?: string }>(
  kind: string,
  incoming: any,
  rows: T[],
  excludeId?: string,
): T | undefined {
  if (!isDuplicateKind(kind)) return undefined;
  return rows.find(
    (row) =>
      row.id !== excludeId &&
      // Нельзя сверять audience_task с group и т.п. — один t.me ключ, разные сущности
      (row.kind == null || row.kind === kind) &&
      !!duplicateReason(kind, incoming, row.data),
  );
}
