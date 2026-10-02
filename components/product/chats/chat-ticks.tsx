import { Check, CheckCheck, CircleAlert, Clock3 } from "lucide-react";
import type { TickState } from "@/lib/chat-view";

const LABEL: Record<TickState, string> = {
  pending: "Отправляется",
  sent: "Отправлено",
  read: "Клиент ответил после этого сообщения",
  failed: "Не отправлено",
  unknown: "Результат отправки неизвестен",
};

/** Telegram-style delivery mark: clock · ✓ · ✓✓ · red «!». `read` is inferred (a later client message). */
export function ChatTick({ state, size = 15 }: { state: TickState; size?: number }) {
  const Icon =
    state === "pending" ? Clock3 : state === "sent" ? Check : state === "read" ? CheckCheck : state === "failed" ? CircleAlert : Clock3;
  return (
    <span className="chat-tick" data-tick={state} title={LABEL[state]}>
      <Icon size={size} strokeWidth={state === "pending" || state === "unknown" ? 2 : 2.4} aria-hidden />
      <span className="sr-only">{LABEL[state]}</span>
    </span>
  );
}
