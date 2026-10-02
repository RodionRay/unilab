/**
 * Delivery status and send-failure copy for the lead screen (components/tma/lead-screen.tsx).
 * Server side: app/api/workspace/route.ts::sendLeadMessage — 504 `unknown` when the Telegram worker did not answer,
 * 409 when the same text is still pending/unknown within lib/lead-conversation.ts::SEND_BLOCK_WINDOW_MS.
 * lib/tma/feed-inbox.ts reports a server `unknown` entry as "pending", so a stale pending is shown as unknown here.
 */
import { SEND_BLOCK_WINDOW_MS } from "@/lib/lead-conversation";
import type { LeadMessage } from "@/lib/tma/contract";

/** A send is one synchronous worker call; a pending entry older than this never resolved. */
export const SEND_UNKNOWN_AFTER_MS = 2 * 60_000;

export type DisplayStatus = LeadMessage["status"] | "unknown";

export function displayStatus(message: LeadMessage, nowMs: number, unknownTexts: ReadonlySet<string>): DisplayStatus {
  // The contract has no "unknown" yet; accept it if the feed starts sending it.
  if ((message.status as string) === "unknown") return "unknown";
  if (message.status !== "pending") return message.status;
  if (unknownTexts.has(message.text)) return "unknown";
  const at = Date.parse(message.at);
  return Number.isFinite(at) && nowMs - at > SEND_UNKNOWN_AFTER_MS ? "unknown" : "pending";
}

export type SendFailure = { kind: "unknown" | "blocked" | "network" | "other"; text: string };

const BLOCK_MINUTES = Math.round(SEND_BLOCK_WINDOW_MS / 60_000);

export function describeSendFailure(err: { code: string; status: number; message: string }): SendFailure {
  if (err.code === "network") return { kind: "network", text: "Нет соединения, сообщение не отправлено. Нажмите «Отправить» ещё раз." };
  // The bubble itself reads «Статус неизвестен»; this line says what to do, without repeating it.
  if (err.status === 504) {
    return { kind: "unknown", text: "Ответа от Telegram нет, сообщение могло уйти. Проверьте переписку в Telegram, прежде чем отправлять снова." };
  }
  if (err.status === 409) {
    return {
      kind: "blocked",
      text: `Прошлая отправка этого текста не подтверждена. Проверьте переписку в Telegram: этот же текст можно отправить снова через ${BLOCK_MINUTES} минут после прошлой попытки, чтобы клиент не получил дубль.`,
    };
  }
  return { kind: "other", text: err.message };
}
