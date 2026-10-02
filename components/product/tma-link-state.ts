/**
 * Pure state + polling for the «Telegram-приложение» settings block (components/product/tma-link-panel.tsx).
 * Spec: docs/project/specs/tg-mini-app.md REQ-L1, L4, N2. API: POST /api/tma/link (lib/tma/link-api.ts).
 */
import type { LinkStatus, TmaErrorCode } from "@/lib/tma/contract";

export const LINK_POLL_INTERVAL_MS = 4000;

export type LinkAction = "status" | "create_code" | "unlink" | "set_dm_notices";

export type LinkFailureKind = "rate_limited" | "network" | "forbidden" | "session" | "no_bot" | "not_linked" | "other";

export type LinkFailure = {
  kind: LinkFailureKind;
  message: string;
  /** The request that failed: «Повторить» repeats it. */
  action: LinkAction;
  retryAfterSec?: number;
  /** rate_limited with Retry-After: epoch ms before which a retry is pointless (buttons stay disabled). */
  retryAtMs?: number;
};

export type LinkCode = { startLink: string; expiresAtMs: number };

export type LinkPhase = "loading" | "no_bot" | "idle" | "pending" | "expired" | "linked";

export type LinkState = {
  phase: LinkPhase;
  status: LinkStatus | null;
  code: LinkCode | null;
  busy: LinkAction | null;
  failure: LinkFailure | null;
  /** Polite live-region text for status changes. */
  announce: string;
};

export type LinkEvent =
  | { type: "request"; action: LinkAction }
  | { type: "status_loaded"; status: LinkStatus }
  | { type: "code_created"; status: LinkStatus; nowMs: number }
  | { type: "polled"; status: LinkStatus }
  | { type: "expired" }
  | { type: "dm_saved"; status: LinkStatus }
  | { type: "unlinked"; status: LinkStatus }
  | { type: "failed"; failure: LinkFailure }
  | { type: "cancel_code" };

export function initialLinkState(botConfigured: boolean | null): LinkState {
  return {
    phase: botConfigured === false ? "no_bot" : "loading",
    status: null,
    code: null,
    busy: botConfigured === false ? null : "status",
    failure: null,
    announce: "",
  };
}

function linkedName(status: LinkStatus): string {
  return status.tgUsername ? `@${status.tgUsername}` : "ваш Telegram";
}

function settled(state: LinkState, status: LinkStatus): LinkState {
  return {
    ...state,
    status,
    busy: null,
    failure: null,
    phase: status.linked ? "linked" : state.phase === "pending" ? "pending" : "idle",
  };
}

export function linkReducer(state: LinkState, event: LinkEvent): LinkState {
  switch (event.type) {
    case "request":
      return { ...state, busy: event.action, failure: null };
    case "status_loaded":
      return { ...settled(state, event.status), phase: event.status.linked ? "linked" : "idle", code: null };
    case "code_created": {
      if (event.status.linked) return { ...settled(state, event.status), phase: "linked", code: null };
      const startLink = event.status.startLink ?? "";
      const expiresAtMs = (event.status.expiresAt ?? 0) * 1000;
      if (!startLink || expiresAtMs <= event.nowMs) {
        return { ...state, busy: null, failure: { kind: "other", message: "Не удалось получить ссылку. Повторите.", action: "create_code" } };
      }
      return {
        ...state,
        status: event.status,
        phase: "pending",
        code: { startLink, expiresAtMs },
        busy: null,
        failure: null,
        announce: "Ссылка готова. Откройте бота и нажмите «Старт».",
      };
    }
    case "polled":
      if (state.phase !== "pending") return state;
      if (!event.status.linked) return { ...state, status: event.status };
      return {
        ...state,
        status: event.status,
        phase: "linked",
        code: null,
        busy: null,
        failure: null,
        announce: `Telegram подключён: ${linkedName(event.status)}`,
      };
    case "expired":
      if (state.phase !== "pending") return state;
      return { ...state, phase: "expired", code: null, announce: "Ссылка истекла. Получите новую." };
    case "dm_saved":
      return {
        ...settled(state, event.status),
        announce: event.status.dmNotices ? "Личные уведомления включены" : "Личные уведомления выключены",
      };
    case "unlinked":
      return { ...settled(state, event.status), phase: "idle", code: null, announce: "Telegram отключён" };
    case "cancel_code":
      return { ...state, phase: "idle", code: null, failure: null };
    case "failed": {
      const { failure } = event;
      if (failure.kind === "no_bot") return { ...state, phase: "no_bot", busy: null, failure: null, code: null };
      return { ...state, busy: null, failure };
    }
  }
}

export type LinkBadge = { tone: "success" | "warning" | "neutral"; text: string };

/** Header badge; null while the status is unknown (first load running or failed): never claim «Не подключено» blind. */
export function badgeFor(state: LinkState): LinkBadge | null {
  if (state.phase === "loading") return null;
  if (state.phase === "linked") return { tone: "success", text: "Подключено" };
  if (state.phase === "pending") return { tone: "warning", text: "Ждём подтверждения" };
  if (state.phase === "no_bot") return { tone: "neutral", text: "Нужен бот" };
  return { tone: "neutral", text: "Не подключено" };
}

/** Seconds until a rate-limited request may be repeated; 0 = may retry now. */
export function cooldownLeftSec(failure: LinkFailure | null, nowMs: number): number {
  if (!failure?.retryAtMs) return 0;
  const left = failure.retryAtMs - nowMs;
  return left <= 0 ? 0 : Math.ceil(left / 1000);
}

/** «45 с» under a minute, «8:59» above. */
export function formatCooldown(sec: number): string {
  if (sec < 60) return `${sec} с`;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** Private notices are on but the owner switched workspace notices off: say why nothing arrives. */
export function noticesOffHint(status: LinkStatus): string {
  if (!status.linked || !status.noticesOff) return "";
  return "Владелец выключил уведомления кабинета, поэтому личные уведомления сейчас не приходят.";
}

/** Whole minutes left, rounded up («действует 10 минут»); 0 when expired. */
export function minutesLeft(expiresAtMs: number, nowMs: number): number {
  const left = expiresAtMs - nowMs;
  return left <= 0 ? 0 : Math.ceil(left / 60_000);
}

export function pluralMinutes(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} минуту`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} минуты`;
  return `${n} минут`;
}

function retryText(sec: number | undefined): string {
  if (!sec || sec <= 0) return "Повторите чуть позже.";
  if (sec < 60) return `Повторите через ${sec} с.`;
  return `Повторите через ${pluralMinutes(Math.ceil(sec / 60))}.`;
}

const NETWORK_TEXT = "Нет связи с сервером. Проверьте интернет и повторите.";

/** Maps a non-2xx response (or a thrown fetch) of POST /api/tma/link to a UI failure. */
export function classifyFailure(
  action: LinkAction,
  httpStatus: number | null,
  body: unknown,
  retryAfterHeader: string | null,
  nowMs: number = Date.now(),
): LinkFailure {
  if (httpStatus === null) return { kind: "network", message: NETWORK_TEXT, action };
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const code = typeof obj.code === "string" ? (obj.code as TmaErrorCode) : null;
  const serverText = typeof obj.error === "string" && obj.error.trim() ? obj.error.trim() : "";
  if (httpStatus === 429 || code === "rate_limited") {
    const retryAfterSec = Number(retryAfterHeader) > 0 ? Math.ceil(Number(retryAfterHeader)) : undefined;
    const wait = retryAfterSec ? { retryAfterSec, retryAtMs: nowMs + retryAfterSec * 1000 } : {};
    return { kind: "rate_limited", message: `Слишком много попыток. ${retryText(retryAfterSec)}`, action, ...wait };
  }
  if (httpStatus === 401 || code === "session_expired") {
    return { kind: "session", message: "Сессия кабинета истекла. Обновите страницу и войдите снова.", action };
  }
  if (code === "forbidden" || httpStatus === 403) {
    return { kind: "forbidden", message: serverText || "Нет доступа к этому действию.", action };
  }
  if (code === "not_linked") return { kind: "not_linked", message: "Telegram уже не подключён. Обновите статус.", action };
  if (code === "workspace_unavailable" && httpStatus === 409 && action === "create_code") {
    return { kind: "no_bot", message: serverText, action };
  }
  if (httpStatus >= 500 && !serverText) return { kind: "network", message: NETWORK_TEXT, action };
  return { kind: "other", message: serverText || "Не получилось. Повторите.", action };
}

export type DmProblem = { text: string; /** The fix is «open the bot and press Старт»: show the bot link inline. */ openBot: boolean };

/** dmError (free text from the bot sender) → one sentence the member can act on; null = no problem. */
export function describeDmError(dmError: string): DmProblem | null {
  const raw = dmError.trim();
  if (!raw) return null;
  if (/block|forbidden|403|chat not found|deactivated|blocked/i.test(raw)) {
    return { text: "Бот не может написать вам: откройте бота и нажмите «Старт», затем включите уведомления снова.", openBot: true };
  }
  return { text: `Последнее личное уведомление не доставлено (${raw.slice(0, 160)}). Включите уведомления снова.`, openBot: false };
}

export type PollerDeps = {
  fetchStatus: () => Promise<LinkStatus | null>;
  onStatus: (status: LinkStatus) => void;
  onExpired: () => void;
  isHidden: () => boolean;
  now: () => number;
  expiresAtMs: number;
  intervalMs?: number;
};

/**
 * Polls `status` every 4 s while the code is active. Stops on link, on expiry and on stop();
 * skips ticks while the tab is hidden (resume() polls at once when it becomes visible).
 */
export function createLinkPoller(deps: PollerDeps): { stop: () => void; resume: () => void } {
  const interval = deps.intervalMs ?? LINK_POLL_INTERVAL_MS;
  let stopped = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, interval);
  };

  async function tick(): Promise<void> {
    timer = null;
    if (stopped) return;
    if (deps.now() >= deps.expiresAtMs) {
      stop();
      deps.onExpired();
      return;
    }
    if (deps.isHidden() || inFlight) return schedule();
    inFlight = true;
    let status: LinkStatus | null = null;
    try {
      status = await deps.fetchStatus();
    } catch {
      status = null;
    } finally {
      inFlight = false;
    }
    if (stopped) return;
    if (status) deps.onStatus(status);
    if (status?.linked) return stop();
    schedule();
  }

  schedule();
  return {
    stop,
    resume: () => {
      if (stopped || inFlight) return;
      if (timer) clearTimeout(timer);
      void tick();
    },
  };
}
