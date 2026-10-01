/**
 * Groups page tabs and status label (app/app/page.tsx), pure so tab counts and filters share one rule.
 * docs/join-pipeline.md § «Вкладки страницы групп».
 */

import { isCatalogPlaceholderUrl } from "@/lib/group-catalog";
import { joinGateFor, type JoinGateGroup } from "@/lib/join-relevance";

export type GroupTabData = JoinGateGroup & {
  accountId?: string;
  joinState?: string;
  /** Last join failure caused by the account, not the group (lib/processes/join-flow::accountSideJoinErrorPatch). */
  joinAccountError?: string;
};

export type GroupTab = "need" | "review" | "skip" | "error" | "joined" | "pending";

export type GroupStatusTone = "success" | "warning" | "danger" | "neutral";

export function groupIsMember(d: GroupTabData): boolean {
  return d.membership === "joined" || d.membership === "pending" || d.status === "pending" || !!d.joinedAt;
}

function groupIsPending(d: GroupTabData): boolean {
  return d.membership === "pending" || d.status === "pending";
}

/** Not a member and something went wrong: a group error, a dead link or an account that could not join. */
export function groupHasJoinError(d: GroupTabData): boolean {
  if (groupIsMember(d)) return false;
  return d.status === "error" || !!String(d.joinAccountError || "") || joinGateFor(d).state === "dead";
}

/**
 * The one tab a group belongs to (besides «Все»). Errors beat the relevance band, so an account failure
 * on a low-score group is never hidden in «Не вступать»; groups without an account still wait in «Ждут».
 */
export function groupTab(d: GroupTabData): GroupTab | null {
  if (groupIsPending(d)) return "pending";
  if (groupIsMember(d)) return "joined";
  if (groupHasJoinError(d)) return "error";
  const gate = joinGateFor(d);
  if (gate.allow) return d.url && !isCatalogPlaceholderUrl(d.url) ? "need" : null;
  if (gate.state === "review") return "review";
  if (gate.state === "skip" || gate.state === "skipped") return "skip";
  return null;
}

/** Tab filter: «Вступили» lists every member (requests included), «Заявка» only requests. */
export function groupInTab(d: GroupTabData, tab: GroupTab): boolean {
  if (tab === "joined") return groupIsMember(d);
  return groupTab(d) === tab;
}

const JOIN_STATE_LABELS: Record<string, string> = {
  queued: "В очереди",
  waiting: "Пауза",
  joining: "Вступаем…",
  scanning: "Скан…",
};

export function groupStatusLabel(d: GroupTabData): { label: string; tone: GroupStatusTone } {
  const queueLabel = JOIN_STATE_LABELS[String(d.joinState || "")];
  if (queueLabel) return { label: queueLabel, tone: "warning" };
  const s = String(d.status || "setup");
  if (groupIsPending(d)) return { label: "Заявка", tone: "warning" };
  if (groupIsMember(d) || (s === "active" && d.joinedAt)) return { label: "Вступили", tone: "success" };
  if (String(d.joinAccountError || "")) return { label: "Ошибка аккаунта", tone: "danger" };
  const gate = joinGateFor(d);
  // A dead link is the most specific group error: keep its own label.
  if (gate.state === "dead") return { label: gate.label, tone: "danger" };
  if (s === "error") return { label: "Ошибка", tone: "danger" };
  if (gate.state === "review") return { label: gate.label, tone: "warning" };
  if (gate.state === "skip" || gate.state === "skipped") return { label: gate.label, tone: "neutral" };
  if (s === "active") return { label: "Не вступили", tone: "warning" };
  return { label: "Ждёт вступления", tone: "neutral" };
}
