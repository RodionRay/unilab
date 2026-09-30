/** Решения скана групп / отбора лидов. */

import { isDayLimitCooldown, isAccountUsable } from "@/lib/telegram-accounts";
import {
  explainLeadDecision,
  type LeadCoreSettings,
} from "@/lib/lead-core";

export type ScanGateResult =
  | { ok: true }
  | { ok: false; reason: "cooldown" | "hard_dead" | "missing"; waitSec?: number; message: string };

const HARD_DEAD = new Set([
  "disconnected",
  "unauthorized",
  "frozen",
  "spamblock",
  "proxy_error",
]);

/** Можно ли сканить группу с этого аккаунта. */
export function evaluateScanGate(account: {
  status?: string | null;
  cooldownUntil?: string | null;
} | null): ScanGateResult {
  if (!account) {
    return { ok: false, reason: "missing", message: "Аккаунт группы не найден" };
  }
  const st = String(account.status || "");
  if (isDayLimitCooldown(account) || st === "spamblock" || st === "frozen") {
    const until = String(account.cooldownUntil || "");
    const waitSec = Math.max(
      60,
      Math.ceil((Date.parse(until) - Date.now()) / 1000) || 300,
    );
    return {
      ok: false,
      reason: "cooldown",
      waitSec,
      message: "Аккаунт на отлёжке — скан позже",
    };
  }
  if (HARD_DEAD.has(st) || !isAccountUsable(account)) {
    return {
      ok: false,
      reason: "hard_dead",
      message: "Аккаунт недоступен — нужна пересадка",
    };
  }
  return { ok: true };
}

export type ScanLeadDecision = {
  pass: boolean;
  temperature: "hot" | "warm" | "cold" | null;
  summary: string;
};

/** Решение ядра: писать ли лид из текста сообщения. */
export function decideScanLead(
  message: string,
  settings: LeadCoreSettings,
): ScanLeadDecision {
  const d = explainLeadDecision(message, settings);
  return {
    pass: d.pass,
    temperature: d.pass ? d.temperature : null,
    summary: d.summary || d.rejectReason || "",
  };
}
