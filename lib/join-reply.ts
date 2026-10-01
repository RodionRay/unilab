/** How the UI join queue treats a join_group reply (200 body or the data of a non-2xx error). */

export type JoinRejoinItem = { id: string; name: string };

export type JoinReplyVerdict =
  | { kind: "joined" }
  /** The account, not the group, was at fault: the server parked or moved the group — a note, never an error. */
  | { kind: "parked"; note: string; rejoinItem: JoinRejoinItem | null }
  | { kind: "failed"; error: string };

type JoinReply = {
  ok?: unknown;
  error?: unknown;
  deferred?: unknown;
  accountFrozen?: unknown;
  reassigned?: unknown;
  rejoinItem?: unknown;
  result?: { join?: unknown; error?: unknown } | null;
} | null | undefined;

function rejoinItemOf(v: unknown): JoinRejoinItem | null {
  if (!v || typeof v !== "object") return null;
  const id = String((v as { id?: unknown }).id || "");
  if (!id) return null;
  return { id, name: String((v as { name?: unknown }).name || "Группа") };
}

export function classifyJoinReply(reply: JoinReply): JoinReplyVerdict {
  const kind = String(reply?.result?.join || "");
  if (reply?.ok || kind === "already" || kind === "requested") return { kind: "joined" };
  const error = String(reply?.error || reply?.result?.error || "Не удалось вступить в группу");
  if (reply?.deferred === true || reply?.accountFrozen === true || reply?.reassigned === true) {
    return { kind: "parked", note: error.slice(0, 120), rejoinItem: rejoinItemOf(reply?.rejoinItem) };
  }
  return { kind: "failed", error };
}
