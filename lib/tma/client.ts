/**
 * Browser client of the Telegram Mini App API (contract: lib/tma/contract.ts).
 *
 * - The bearer from `POST /api/tma/session` lives only in this closure: never in
 *   localStorage, sessionStorage or cookies (spec REQ-A4, D-design 2).
 * - Reads: `GET /api/tma/feed?view=…`; mutations reuse `POST /api/workspace`
 *   with the body shapes of `app/api/workspace/route.ts::POST` (top-level fields,
 *   not wrapped in `data`).
 */
import type {
  AccountsFeed,
  FeedView,
  InboxFeed,
  InboxItem,
  LeadFeed,
  OverviewFeed,
  SessionResponse,
  TasksFeed,
  TmaAction,
  TmaErrorCode,
} from "@/lib/tma/contract";

export type InboxRow = InboxItem;
export type InboxPage = Omit<InboxFeed, "items"> & { items: InboxRow[] };
export type InboxFilter = "all" | "hot" | "unread" | "conversations";

type FeedByView = {
  overview: OverviewFeed;
  inbox: InboxPage;
  lead: LeadFeed;
  accounts: AccountsFeed;
  tasks: TasksFeed;
};

/** Error kinds the UI distinguishes. `network` = no response (offline, DNS, CORS); `http` = unexpected status. */
export type TmaClientErrorCode = TmaErrorCode | "network" | "http";

export class TmaApiError extends Error {
  readonly code: TmaClientErrorCode;
  readonly status: number;
  readonly botLink: string;

  constructor(message: string, code: TmaClientErrorCode, status: number, botLink = "") {
    super(message);
    this.name = "TmaApiError";
    this.code = code;
    this.status = status;
    this.botLink = botLink;
  }
}

/** Local types of `app/api/workspace/route.ts` responses for the TMA_ACTIONS (contract gap: not in contract.ts). */
export type DraftResult = { ok: true; draft: string; model?: string };
export type SendResult = { ok: true; duplicate?: boolean };
export type ActionResult = { ok: true };

const KNOWN_CODES: ReadonlySet<string> = new Set<TmaErrorCode>([
  "bad_request",
  "invalid_init_data",
  "init_data_expired",
  "session_expired",
  "not_linked",
  "workspace_unavailable",
  "forbidden",
  "rate_limited",
  "unavailable",
]);

function codeForStatus(status: number): TmaClientErrorCode {
  if (status === 401) return "session_expired";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  if (status === 400) return "bad_request";
  if (status === 503) return "unavailable";
  return "http";
}

async function toApiError(res: Response): Promise<TmaApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rawCode = typeof rec.code === "string" ? rec.code : "";
  const code: TmaClientErrorCode = KNOWN_CODES.has(rawCode) ? (rawCode as TmaErrorCode) : codeForStatus(res.status);
  const message = typeof rec.error === "string" && rec.error ? rec.error : `Ошибка сервера (${res.status})`;
  const botLink = typeof rec.botLink === "string" ? rec.botLink : "";
  return new TmaApiError(message, code, res.status, botLink);
}

export type TmaClient = {
  /** Exchanges Telegram initData for the bearer; must succeed before any other call. */
  openSession(): Promise<SessionResponse>;
  feed<V extends FeedView>(view: V, params?: { cursor?: string; filter?: InboxFilter; id?: string }): Promise<FeedByView[V]>;
  draft(leadId: string): Promise<DraftResult>;
  markLeadViewed(leadId: string): Promise<ActionResult>;
  sendLeadMessage(input: { leadId: string; text: string; clientMsgId: string }): Promise<SendResult>;
  checkAccount(accountId: string): Promise<ActionResult>;
  runTaskAction(action: TmaAction, taskId: string): Promise<ActionResult>;
};

export function createTmaClient(opts: { wsKey: string; initData: string; fetchImpl?: typeof fetch }): TmaClient {
  const doFetch = opts.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  let token = "";
  let expiresAt = 0;

  async function request(path: string, init: RequestInit & { auth: boolean }): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (init.auth) {
      if (!token || Date.now() / 1000 >= expiresAt) {
        throw new TmaApiError("Сессия истекла", "session_expired", 401);
      }
      headers.set("Authorization", `Bearer ${token}`);
    }
    let res: Response;
    try {
      res = await doFetch(path, { ...init, headers, credentials: "omit", cache: "no-store" });
    } catch {
      throw new TmaApiError("Нет соединения с сервером", "network", 0);
    }
    if (!res.ok) {
      const err = await toApiError(res);
      // POST /api/workspace answers 401 without a tma code: any 401 on an authed call = expired bearer.
      if (init.auth && res.status === 401) {
        throw new TmaApiError(err.message, "session_expired", 401, err.botLink);
      }
      throw err;
    }
    try {
      return await res.json();
    } catch {
      throw new TmaApiError("Некорректный ответ сервера", "http", res.status);
    }
  }

  function post<T>(body: Record<string, unknown>): Promise<T> {
    return request("/api/workspace", { method: "POST", body: JSON.stringify(body), auth: true }) as Promise<T>;
  }

  return {
    async openSession() {
      const out = (await request("/api/tma/session", {
        method: "POST",
        body: JSON.stringify({ wsKey: opts.wsKey, initData: opts.initData }),
        auth: false,
      })) as SessionResponse;
      token = out.token;
      expiresAt = out.expiresAt;
      return out;
    },
    feed<V extends FeedView>(view: V, params: { cursor?: string; filter?: InboxFilter; id?: string } = {}) {
      const q = new URLSearchParams({ view });
      if (params.cursor) q.set("cursor", params.cursor);
      if (params.filter && view === "inbox") q.set("filter", params.filter);
      if (params.id) q.set("id", params.id);
      return request(`/api/tma/feed?${q.toString()}`, { method: "GET", auth: true }) as Promise<FeedByView[V]>;
    },
    draft: (leadId) => post<DraftResult>({ action: "draft", id: leadId }),
    markLeadViewed: (leadId) => post<ActionResult>({ action: "mark_lead_viewed", id: leadId }),
    sendLeadMessage: ({ leadId, text, clientMsgId }) =>
      post<SendResult>({ action: "send_lead_message", id: leadId, mode: "dm", text, clientMsgId }),
    checkAccount: (accountId) => post<ActionResult>({ action: "check_account", id: accountId }),
    runTaskAction: (action, taskId) => post<ActionResult>({ action, id: taskId }),
  };
}

/**
 * One idempotency nonce per send attempt of a given text: a retry or a double
 * tap of the same text reuses it (the server's findSendBlock dedupes by
 * clientMsgId), a different text gets a fresh one. Max 80 chars (route.ts).
 */
export class SendNonce {
  private text = "";
  private nonce = "";
  private readonly makeId: () => string;

  constructor(makeId: () => string = () => crypto.randomUUID()) {
    this.makeId = makeId;
  }

  for(text: string): string {
    if (!this.nonce || this.text !== text) {
      this.text = text;
      this.nonce = `tma:${this.makeId()}`;
    }
    return this.nonce;
  }

  /** Call after a confirmed send so the next message gets a new nonce. */
  reset(): void {
    this.text = "";
    this.nonce = "";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lead to open on launch (REQ-M6): `#lead=<uuid>` in the URL hash (private notice
 * `web_app` button) or `start_param` `lead_<uuid>` / `lead-<uuid>`. Telegram adds
 * its own `tgWebApp*` params to the hash, so the hash is parsed as `&`-pairs.
 */
export function deepLinkLeadId(hash: string, startParam: string | undefined, search = ""): string | null {
  // Bot notices link with ?lead=<id> (Telegram owns the URL hash for tgWebAppData); #lead= stays for old links.
  const fromQuery = new URLSearchParams(search).get("lead") ?? "";
  if (UUID_RE.test(fromQuery)) return fromQuery.toLowerCase();
  const pairs = hash.replace(/^#/, "").split("&");
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    if (key !== "lead") continue;
    let value = pair.slice(eq + 1);
    try {
      value = decodeURIComponent(value);
    } catch {
      continue;
    }
    if (UUID_RE.test(value)) return value.toLowerCase();
  }
  const fromStart = /^lead[_-](.+)$/.exec(startParam ?? "")?.[1] ?? "";
  return UUID_RE.test(fromStart) ? fromStart.toLowerCase() : null;
}
