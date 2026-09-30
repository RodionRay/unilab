/**
 * Реестр получателей рассылок владельца: одна строка `records` на человека (kind mailing_recipient).
 * Не ограничен по размеру (в отличие от deliveredKeys задачи) и общий для всех задач — человеку,
 * которому уже писала любая рассылка, повторно не пишем (REQ-M2, REQ-M3).
 * Строка ставится `pending` ДО отправки: таймаут → `unknown`, автоповтора нет (письмо могло уйти).
 */

import type { D1LikeDatabase } from "@/lib/db";

export const MAILING_RECIPIENT_KIND = "mailing_recipient";

export type MailingRecipientState = "pending" | "sent" | "unknown" | "failed";

export type MailingRecipientEntry = {
  key: string;
  state: MailingRecipientState;
  taskId: string;
  accountId: string;
  leadId: string;
  at: string;
  error: string;
};

const idPrefix = (owner: string) => `mr:${owner}:`;
const recipientRowId = (owner: string, personKey: string) => `${idPrefix(owner)}${personKey}`;

function legacyPersonKeys(userId: unknown, username: unknown): string[] {
  const out: string[] = [];
  const uid = String(userId || "").trim();
  const un = String(username || "").trim().replace(/^@/, "").toLowerCase();
  if (uid) out.push(`dm:u:${uid}`);
  if (un) out.push(`dm:un:${un}`);
  return out;
}

function parseData(raw: unknown): Record<string, unknown> | null {
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Кому уже писали: реестр + данные до реестра (deliveredKeys других задач, лиды с mailingTaskId
 * другой задачи). `leadIds` — лиды, которые уже получили рассылку другой задачи.
 */
export async function loadContactedRecipients(
  db: D1LikeDatabase,
  owner: string,
  taskId: string,
): Promise<{ personKeys: Set<string>; leadIds: Set<string> }> {
  const personKeys = new Set<string>();
  const leadIds = new Set<string>();
  const prefix = idPrefix(owner);
  const rows = await db
    .prepare("SELECT id FROM records WHERE owner=? AND kind=?")
    .bind(owner, MAILING_RECIPIENT_KIND)
    .all();
  for (const r of rows.results) {
    const id = String(r.id);
    if (id.startsWith(prefix)) personKeys.add(id.slice(prefix.length));
  }

  const tasks = await db
    .prepare("SELECT data FROM records WHERE owner=? AND kind='mailing_task' AND id!=?")
    .bind(owner, taskId)
    .all();
  for (const t of tasks.results) {
    const keys = parseData(t.data)?.deliveredKeys;
    if (!Array.isArray(keys)) continue;
    for (const k of keys) {
      const s = String(k);
      if (s.startsWith("u:") || s.startsWith("un:")) personKeys.add(`dm:${s}`);
    }
  }

  const leads = await db
    .prepare(
      "SELECT id,data FROM records WHERE owner=? AND kind='lead' AND COALESCE(json_extract(data,'$.mailingTaskId'),'') NOT IN ('',?)",
    )
    .bind(owner, taskId)
    .all();
  for (const l of leads.results) {
    const d = parseData(l.data);
    if (!d) continue;
    leadIds.add(String(l.id));
    for (const k of legacyPersonKeys(d.senderId, d.senderUsername)) personKeys.add(k);
  }
  return { personKeys, leadIds };
}

/** Занять получателя перед отправкой; false — уже занят (другая задача/тик успели раньше). */
export async function claimMailingRecipient(
  db: D1LikeDatabase,
  owner: string,
  entry: MailingRecipientEntry,
): Promise<boolean> {
  const r = await db
    .prepare(
      "INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,NULL,?) ON CONFLICT(id) DO NOTHING",
    )
    .bind(recipientRowId(owner, entry.key), owner, MAILING_RECIPIENT_KIND, JSON.stringify(entry), entry.at)
    .run();
  return r.meta.changes === 1;
}

/** Итог отправки: sent / unknown / failed — получатель остаётся занятым навсегда. */
export async function settleMailingRecipient(
  db: D1LikeDatabase,
  owner: string,
  entry: MailingRecipientEntry,
): Promise<void> {
  await db
    .prepare("UPDATE records SET data=? WHERE owner=? AND id=? AND kind=?")
    .bind(JSON.stringify(entry), owner, recipientRowId(owner, entry.key), MAILING_RECIPIENT_KIND)
    .run();
}

/** Точно не отправлено (отказ Telegram, воркер занят) — получатель снова свободен. */
export async function releaseMailingRecipient(
  db: D1LikeDatabase,
  owner: string,
  personKey: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM records WHERE owner=? AND id=? AND kind=?")
    .bind(owner, recipientRowId(owner, personKey), MAILING_RECIPIENT_KIND)
    .run();
}
