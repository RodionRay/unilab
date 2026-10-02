"use client";

import { blockBadge } from "@/lib/lead-block";

/**
 * «Вероятно, заблокировал» для лида — бейдж в строке списка и в шапке переписки.
 * Isolated on purpose: the conversation page layout belongs to another task; this component only reads
 * `lead.blockSignal` (lib/lead-block.ts) and renders nothing when there is no signal.
 */
export function LeadBlockBadge({ signal, withReason = false }: { signal: unknown; withReason?: boolean }) {
  const b = blockBadge(signal);
  if (!b) return null;
  const since = b.at ? new Date(b.at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : "";
  const title = `${b.reason}${since ? ` · с ${since}` : ""}. Telegram не сообщает о блокировке напрямую — это оценка по косвенным признакам.`;
  if (!withReason) {
    return (
      <span className={`badge ${b.tone}`} title={title}>
        {b.label}
      </span>
    );
  }
  return (
    <span className="lead-block-note" title={title}>
      <span className={`badge ${b.tone}`}>{b.label}</span>
      <span className="lead-block-reason">
        {b.reason}
        {since ? ` · с ${since}` : ""}
      </span>
    </span>
  );
}
