/**
 * «Вероятно, заблокировал» — per lead, as seen by the account that writes to it. Telegram has no direct
 * signal (users.getFullUser.blocked is only about peers WE blocked), so this is a heuristic built from:
 * - send errors returned by the worker (`errorCode`): USER_IS_BLOCKED, USER_PRIVACY_RESTRICTED,
 *   PRIVACY_PREMIUM_REQUIRED, INPUT_USER_DEACTIVATED;
 * - peer snapshots (send result `peer`, batched `/peer-status`): «был(а) в сети» and photo that this account
 *   saw before and that are now hidden (UserStatusEmpty + no photo) — what a block looks like from our side;
 * - read state: our last message unread while the peer was online after it (ignoring rather than blocking).
 * Pure functions; the route stores the result in `lead.blockSignal` (server-owned field).
 */

export type PeerStatus = "online" | "offline" | "recently" | "last_week" | "last_month" | "hidden";

export type PeerSnapshot = {
  status: PeerStatus;
  /** unix seconds; 0 = unknown */
  wasOnline?: number;
  photo?: boolean;
  deleted?: boolean;
  /** our message is the top one and its id > read_outbox_max_id (one tick) */
  outUnread?: boolean;
  /** unix seconds of our unread top message */
  lastOutAt?: number;
};

export type BlockReasonCode = "deleted" | "blocked_error" | "privacy" | "profile_hidden" | "unread_seen_online";

export type BlockReason = { code: BlockReasonCode; at: string; detail: string };

export type LeadBlockSignal = {
  accountId: string;
  reasons: BlockReason[];
  /** last time this account saw the peer's status or photo */
  visibleAt?: string;
  visibleStatus?: boolean;
  visiblePhoto?: boolean;
  /** last batched check (`/peer-status`) — drives the re-check cadence */
  checkedAt?: string;
};

export const PEER_SEND_ERROR_CODES = [
  "USER_IS_BLOCKED",
  "USER_PRIVACY_RESTRICTED",
  "PRIVACY_PREMIUM_REQUIRED",
  "INPUT_USER_DEACTIVATED",
] as const;
export type PeerSendErrorCode = (typeof PEER_SEND_ERROR_CODES)[number];

/** Re-check cadence of one conversation: one batched request per account, no per-lead polling. */
export const LEAD_BLOCK_RECHECK_MS = 6 * 3600_000;
/** Conversations whose last own message is older than this are not re-checked. */
export const LEAD_BLOCK_ACTIVE_MS = 30 * 24 * 3600_000;
/** Peers per `/peer-status` call (worker caps at the same number). */
export const LEAD_BLOCK_BATCH = 50;
/** «Не читает»: the peer was online at least this long after our unread message. */
export const UNREAD_SEEN_GRACE_SEC = 3600;

const PEER_STATUSES: readonly PeerStatus[] = ["online", "offline", "recently", "last_week", "last_month", "hidden"];
const REASON_ORDER: readonly BlockReasonCode[] = ["deleted", "blocked_error", "privacy", "profile_hidden", "unread_seen_online"];
/** A delivered message proves the peer exists and accepts our DMs. */
const SEND_CLEARS: readonly BlockReasonCode[] = ["blocked_error", "privacy", "deleted"];

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Worker `errorCode` (or the code name inside the error text) when it is one of the peer-side codes. */
export function peerSendErrorCode(result: { errorCode?: unknown; error?: unknown } | null | undefined): PeerSendErrorCode | null {
  if (!result) return null;
  const code = str(result.errorCode).toUpperCase();
  if ((PEER_SEND_ERROR_CODES as readonly string[]).includes(code)) return code as PeerSendErrorCode;
  const text = str(result.error).toUpperCase();
  return PEER_SEND_ERROR_CODES.find((c) => text.includes(c)) ?? null;
}

/** Validates a worker snapshot; null when the shape is unusable. */
export function parsePeerSnapshot(raw: unknown): PeerSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const status = PEER_STATUSES.includes(r.status as PeerStatus) ? (r.status as PeerStatus) : null;
  if (!status) return null;
  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
  return {
    status,
    wasOnline: num(r.wasOnline),
    photo: r.photo === true,
    deleted: r.deleted === true,
    outUnread: r.outUnread === true,
    lastOutAt: num(r.lastOutAt),
  };
}

export function readBlockSignal(raw: unknown): LeadBlockSignal | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const reasons = Array.isArray(r.reasons)
    ? r.reasons.filter(
        (x): x is BlockReason =>
          !!x && typeof x === "object" && REASON_ORDER.includes((x as BlockReason).code),
      )
    : [];
  return { ...(r as LeadBlockSignal), accountId: str(r.accountId), reasons };
}

/** Observations from another account start a fresh baseline: visibility is per (peer, our account). */
function base(prev: unknown, accountId: string): LeadBlockSignal {
  const cur = readBlockSignal(prev);
  if (cur && cur.accountId === accountId) return cur;
  return { accountId, reasons: [] };
}

function withReason(s: LeadBlockSignal, code: BlockReasonCode, at: string, detail: string): LeadBlockSignal {
  const kept = s.reasons.find((r) => r.code === code);
  const reason: BlockReason = { code, at: kept?.at || at, detail };
  return { ...s, reasons: [...s.reasons.filter((r) => r.code !== code), reason] };
}

function without(s: LeadBlockSignal, codes: readonly BlockReasonCode[]): LeadBlockSignal {
  return { ...s, reasons: s.reasons.filter((r) => !codes.includes(r.code)) };
}

const ERROR_REASON: Record<PeerSendErrorCode, { code: BlockReasonCode; detail: string }> = {
  USER_IS_BLOCKED: { code: "blocked_error", detail: "Telegram ответил USER_IS_BLOCKED при отправке" },
  USER_PRIVACY_RESTRICTED: { code: "privacy", detail: "Настройки приватности запрещают писать (USER_PRIVACY_RESTRICTED)" },
  PRIVACY_PREMIUM_REQUIRED: { code: "privacy", detail: "Принимает сообщения только от Telegram Premium (PRIVACY_PREMIUM_REQUIRED)" },
  INPUT_USER_DEACTIVATED: { code: "deleted", detail: "Аккаунт клиента удалён (INPUT_USER_DEACTIVATED)" },
};

export function observeSendError(prev: unknown, code: PeerSendErrorCode, accountId: string, nowIso: string): LeadBlockSignal {
  const r = ERROR_REASON[code];
  return withReason(base(prev, accountId), r.code, nowIso, r.detail);
}

/** A delivered message disproves the send-error reasons and refreshes the visibility baseline. */
export function observeSendOk(prev: unknown, snap: PeerSnapshot | null, accountId: string, nowIso: string): LeadBlockSignal {
  const cleared = without(base(prev, accountId), SEND_CLEARS);
  return snap ? observePeer(cleared, snap, accountId, nowIso) : cleared;
}

export function observePeer(prev: unknown, snap: PeerSnapshot, accountId: string, nowIso: string, nowSec = Math.floor(Date.parse(nowIso) / 1000)): LeadBlockSignal {
  let s = base(prev, accountId);
  if (snap.deleted) return withReason(s, "deleted", nowIso, ERROR_REASON.INPUT_USER_DEACTIVATED.detail);
  s = without(s, ["deleted"]);
  const statusVisible = snap.status !== "hidden";
  const photo = snap.photo === true;
  if (statusVisible || photo) {
    s = without({ ...s, visibleAt: nowIso, visibleStatus: statusVisible, visiblePhoto: photo }, ["profile_hidden"]);
  } else if (s.visibleAt) {
    const seen = [s.visibleStatus ? "«был(а) в сети»" : "", s.visiblePhoto ? "фото" : ""].filter(Boolean).join(" и ");
    const unread = snap.outUnread ? "; наше сообщение не прочитано" : "";
    s = withReason(s, "profile_hidden", nowIso, `Раньше были видны ${seen || "профиль"}, теперь скрыты${unread}`);
  }
  const lastOut = snap.lastOutAt || 0;
  const onlineAfter = snap.status === "online" ? nowSec : snap.wasOnline || 0;
  if (snap.outUnread && lastOut && onlineAfter - lastOut >= UNREAD_SEEN_GRACE_SEC) {
    s = withReason(s, "unread_seen_online", nowIso, "Был(а) в сети после нашего сообщения, но не прочитал(а) его");
  } else if (!snap.outUnread) {
    s = without(s, ["unread_seen_online"]);
  }
  return s;
}

/** The peer wrote to us: whatever looked like a block is disproved (a deleted account cannot write). */
export function observeIncoming(prev: unknown, accountId: string): LeadBlockSignal | undefined {
  const cur = readBlockSignal(prev);
  if (!cur) return undefined;
  if (cur.accountId !== accountId) return cur;
  return without(cur, ["blocked_error", "privacy", "profile_hidden", "unread_seen_online"]);
}

export function markChecked(prev: unknown, accountId: string, nowIso: string): LeadBlockSignal {
  return { ...base(prev, accountId), checkedAt: nowIso };
}

export type BlockBadge = { label: string; reason: string; tone: "danger" | "warning"; likelyBlocked: boolean; at: string };

const BADGE: Record<BlockReasonCode, { label: string; tone: BlockBadge["tone"]; likelyBlocked: boolean }> = {
  deleted: { label: "Аккаунт удалён", tone: "danger", likelyBlocked: false },
  blocked_error: { label: "Вероятно, заблокировал", tone: "danger", likelyBlocked: true },
  privacy: { label: "Вероятно, закрыл ЛС", tone: "warning", likelyBlocked: true },
  profile_hidden: { label: "Вероятно, заблокировал", tone: "danger", likelyBlocked: true },
  unread_seen_online: { label: "Вероятно, не читает", tone: "warning", likelyBlocked: false },
};

/** Strongest reason first; the rest go into the reason text. Null = nothing to show. */
export function blockBadge(raw: unknown): BlockBadge | null {
  const s = readBlockSignal(raw);
  if (!s || !s.reasons.length) return null;
  const sorted = [...s.reasons].sort((a, b) => REASON_ORDER.indexOf(a.code) - REASON_ORDER.indexOf(b.code));
  const top = sorted[0]!;
  const b = BADGE[top.code];
  return {
    label: b.label,
    tone: b.tone,
    likelyBlocked: b.likelyBlocked,
    at: top.at,
    reason: sorted.map((r) => r.detail).join(". "),
  };
}

/** Same signal (ignoring checkedAt) → no write needed. */
export function sameSignal(a: unknown, b: unknown): boolean {
  const x = readBlockSignal(a);
  const y = readBlockSignal(b);
  if (!x || !y) return !x && !y;
  const strip = (s: LeadBlockSignal) => JSON.stringify({ ...s, checkedAt: undefined, visibleAt: undefined });
  return strip(x) === strip(y);
}

/**
 * Lead after a DM send attempt by `accountId`: delivered → send-error reasons cleared + visibility baseline from
 * the worker's `peer`; peer-side error code → reason added; anything else (flood, timeout…) → unchanged.
 */
export function applySendToBlockSignal<T extends Record<string, unknown>>(
  lead: T,
  result: { ok?: unknown; errorCode?: unknown; error?: unknown; peer?: unknown } | null | undefined,
  accountId: string,
  nowIso: string,
): T {
  if (!result || !accountId) return lead;
  if (result.ok === true) {
    return { ...lead, blockSignal: observeSendOk(lead.blockSignal, parsePeerSnapshot(result.peer), accountId, nowIso) };
  }
  const code = peerSendErrorCode(result);
  return code ? { ...lead, blockSignal: observeSendError(lead.blockSignal, code, accountId, nowIso) } : lead;
}
