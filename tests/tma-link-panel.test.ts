import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkStatus } from "@/lib/tma/contract";
import {
  LINK_POLL_INTERVAL_MS,
  badgeFor,
  classifyFailure,
  cooldownLeftSec,
  formatCooldown,
  createLinkPoller,
  describeDmError,
  initialLinkState,
  linkReducer,
  minutesLeft,
  noticesOffHint,
  pluralMinutes,
  type LinkState,
} from "@/components/product/tma-link-state";

const NOW = Date.UTC(2026, 9, 1, 9, 0, 0);
const UNLINKED: LinkStatus = { linked: false, tgUsername: "", dmNotices: false, dmError: "", appUrl: "", botLink: "", noticesOff: false };
const LINKED: LinkStatus = { linked: true, tgUsername: "anna_orlova", dmNotices: true, dmError: "", appUrl: "https://x.example/tma/k", botLink: "", noticesOff: false };
const CODE: LinkStatus = { ...UNLINKED, startLink: "https://t.me/bot?start=link_abc", expiresAt: NOW / 1000 + 600 };

function pending(): LinkState {
  const loaded = linkReducer(initialLinkState(true), { type: "status_loaded", status: UNLINKED });
  return linkReducer(linkReducer(loaded, { type: "request", action: "create_code" }), { type: "code_created", status: CODE, nowMs: NOW });
}

describe("linkReducer", () => {
  it("starts in no_bot without a request when the bot is known to be missing", () => {
    expect(initialLinkState(false)).toMatchObject({ phase: "no_bot", busy: null });
    expect(initialLinkState(null)).toMatchObject({ phase: "loading", busy: "status" });
  });

  it("status → idle or linked", () => {
    expect(linkReducer(initialLinkState(true), { type: "status_loaded", status: UNLINKED }).phase).toBe("idle");
    expect(linkReducer(initialLinkState(true), { type: "status_loaded", status: LINKED }).phase).toBe("linked");
  });

  it("create_code → pending with link and expiry in ms, announced", () => {
    const s = pending();
    expect(s.phase).toBe("pending");
    expect(s.code).toEqual({ startLink: CODE.startLink, expiresAtMs: NOW + 600_000 });
    expect(s.busy).toBeNull();
    expect(s.announce).toContain("Ссылка готова");
  });

  it("create_code without a link or already expired → failure, stays idle", () => {
    const idle = linkReducer(initialLinkState(true), { type: "status_loaded", status: UNLINKED });
    const s = linkReducer(idle, { type: "code_created", status: { ...CODE, expiresAt: NOW / 1000 - 1 }, nowMs: NOW });
    expect(s.phase).toBe("idle");
    expect(s.failure?.action).toBe("create_code");
  });

  it("poll while pending: unlinked keeps pending, linked → linked + announce", () => {
    const s = pending();
    expect(linkReducer(s, { type: "polled", status: UNLINKED }).phase).toBe("pending");
    const done = linkReducer(s, { type: "polled", status: LINKED });
    expect(done).toMatchObject({ phase: "linked", code: null, announce: "Telegram подключён: @anna_orlova" });
  });

  it("late poll or expiry after the user left pending is ignored", () => {
    const idle = linkReducer(pending(), { type: "cancel_code" });
    expect(linkReducer(idle, { type: "polled", status: LINKED })).toBe(idle);
    expect(linkReducer(idle, { type: "expired" })).toBe(idle);
  });

  it("expiry → expired, code dropped", () => {
    expect(linkReducer(pending(), { type: "expired" })).toMatchObject({ phase: "expired", code: null });
  });

  it("unlink → idle (reversible), dm toggle announces", () => {
    const linked = linkReducer(initialLinkState(true), { type: "status_loaded", status: LINKED });
    expect(linkReducer(linked, { type: "unlinked", status: UNLINKED })).toMatchObject({ phase: "idle", announce: "Telegram отключён" });
    expect(linkReducer(linked, { type: "dm_saved", status: { ...LINKED, dmNotices: false } }).announce).toBe("Личные уведомления выключены");
  });

  it("no_bot failure switches to the explanation; others keep the phase", () => {
    const idle = linkReducer(initialLinkState(null), { type: "status_loaded", status: UNLINKED });
    expect(linkReducer(idle, { type: "failed", failure: { kind: "no_bot", message: "", action: "create_code" } }).phase).toBe("no_bot");
    const failed = linkReducer(idle, { type: "failed", failure: { kind: "network", message: "x", action: "create_code" } });
    expect(failed).toMatchObject({ phase: "idle", busy: null, failure: { kind: "network" } });
    expect(linkReducer(failed, { type: "request", action: "create_code" }).failure).toBeNull();
  });
});

describe("rate-limit cooldown", () => {
  const limited = classifyFailure("create_code", 429, { code: "rate_limited" }, "90", NOW);
  it("blocks retries until Retry-After elapses", () => {
    expect(cooldownLeftSec(limited, NOW)).toBe(90);
    expect(cooldownLeftSec(limited, NOW + 89_001)).toBe(1);
    expect(cooldownLeftSec(limited, NOW + 90_000)).toBe(0);
  });
  it("no cooldown for other failures or a 429 without Retry-After", () => {
    expect(cooldownLeftSec(classifyFailure("status", null, null, null, NOW), NOW)).toBe(0);
    expect(cooldownLeftSec(classifyFailure("create_code", 429, {}, null, NOW), NOW)).toBe(0);
    expect(cooldownLeftSec(null, NOW)).toBe(0);
  });
});

describe("badgeFor", () => {
  it("claims nothing while the status is unknown (loading or the first load failed)", () => {
    const loading = initialLinkState(true);
    expect(badgeFor(loading)).toBeNull();
    const failed = linkReducer(loading, { type: "failed", failure: classifyFailure("status", null, null, null, NOW) });
    expect(failed.phase).toBe("loading");
    expect(badgeFor(failed)).toBeNull();
  });
  it("names the known states", () => {
    expect(badgeFor(linkReducer(initialLinkState(true), { type: "status_loaded", status: UNLINKED }))).toEqual({ tone: "neutral", text: "Не подключено" });
    expect(badgeFor(linkReducer(initialLinkState(true), { type: "status_loaded", status: LINKED }))).toEqual({ tone: "success", text: "Подключено" });
    expect(badgeFor(pending())).toEqual({ tone: "warning", text: "Ждём подтверждения" });
    expect(badgeFor(initialLinkState(false))).toEqual({ tone: "neutral", text: "Нужен бот" });
  });
});

describe("classifyFailure", () => {
  it("network when fetch threw", () => {
    expect(classifyFailure("status", null, null, null)).toMatchObject({ kind: "network", action: "status" });
  });
  it("429 with Retry-After → minutes in words, retry moment pinned to the response time", () => {
    const f = classifyFailure("create_code", 429, { code: "rate_limited", error: "x" }, "540", NOW);
    expect(f).toMatchObject({ kind: "rate_limited", retryAfterSec: 540, retryAtMs: NOW + 540_000 });
    expect(f.message).toContain("через 9 минут");
    expect(classifyFailure("create_code", 429, {}, "30").message).toContain("через 30 с.");
    expect(classifyFailure("create_code", 429, {}, null).message).toContain("чуть позже");
  });
  it("403 forbidden keeps the server text", () => {
    expect(classifyFailure("unlink", 403, { code: "forbidden", error: "Недопустимый источник запроса" }, null)).toMatchObject({
      kind: "forbidden",
      message: "Недопустимый источник запроса",
    });
  });
  it("401 → session", () => {
    expect(classifyFailure("status", 401, { code: "session_expired" }, null).kind).toBe("session");
  });
  it("409 workspace_unavailable on create_code → no_bot; 502 bot down → other with text", () => {
    expect(classifyFailure("create_code", 409, { code: "workspace_unavailable", error: "Сначала…" }, null).kind).toBe("no_bot");
    expect(classifyFailure("create_code", 502, { code: "workspace_unavailable", error: "Не удалось связаться с ботом." }, null)).toMatchObject({
      kind: "other",
      message: "Не удалось связаться с ботом.",
    });
  });
  it("409 not_linked on dm toggle; 5xx without body → network", () => {
    expect(classifyFailure("set_dm_notices", 409, { code: "not_linked" }, null).kind).toBe("not_linked");
    expect(classifyFailure("status", 503, null, null).kind).toBe("network");
  });
});

describe("copy helpers", () => {
  it("minutesLeft rounds up and floors at 0", () => {
    expect(minutesLeft(NOW + 600_000, NOW)).toBe(10);
    expect(minutesLeft(NOW + 61_000, NOW)).toBe(2);
    expect(minutesLeft(NOW, NOW)).toBe(0);
  });
  it("pluralMinutes", () => {
    expect([1, 2, 5, 11, 21, 22, 10].map(pluralMinutes)).toEqual(["1 минуту", "2 минуты", "5 минут", "11 минут", "21 минуту", "22 минуты", "10 минут"]);
  });
  it("describeDmError: blocked bot → «Старт» hint with the bot link; other → quoted; empty → null", () => {
    const blocked = describeDmError("Forbidden: bot was blocked by the user");
    expect(blocked).toMatchObject({ openBot: true });
    expect(blocked?.text).toContain("нажмите «Старт»");
    expect(blocked?.text).not.toContain("/start");
    expect(describeDmError("timeout")).toMatchObject({ openBot: false, text: expect.stringContaining("(timeout)") });
    expect(describeDmError("  ")).toBeNull();
  });
  it("formatCooldown: seconds under a minute, m:ss above", () => {
    expect([45, 60, 539, 1].map(formatCooldown)).toEqual(["45 с", "1:00", "8:59", "1 с"]);
  });
  it("noticesOffHint only for a linked member whose workspace notices are off", () => {
    expect(noticesOffHint({ ...LINKED, noticesOff: true })).toContain("выключил уведомления кабинета");
    expect(noticesOffHint({ ...LINKED, noticesOff: false })).toBe("");
    expect(noticesOffHint({ ...UNLINKED, noticesOff: true })).toBe("");
  });
});

describe("createLinkPoller", () => {
  let hidden = false;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    hidden = false;
  });
  afterEach(() => vi.useRealTimers());

  function setup(statuses: (LinkStatus | Error)[]) {
    const fetchStatus = vi.fn(async () => {
      const next = statuses.shift() ?? UNLINKED;
      if (next instanceof Error) throw next;
      return next;
    });
    const onStatus = vi.fn();
    const onExpired = vi.fn();
    const poller = createLinkPoller({ fetchStatus, onStatus, onExpired, isHidden: () => hidden, now: () => Date.now(), expiresAtMs: NOW + 600_000 });
    return { fetchStatus, onStatus, onExpired, poller };
  }

  it("polls every 4 s and stops once linked", async () => {
    const { fetchStatus, onStatus } = setup([UNLINKED, UNLINKED, LINKED]);
    expect(fetchStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(LINK_POLL_INTERVAL_MS);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LINK_POLL_INTERVAL_MS * 2);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    expect(onStatus).toHaveBeenLastCalledWith(LINKED);
    await vi.advanceTimersByTimeAsync(LINK_POLL_INTERVAL_MS * 5);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it("stops on expiry and reports it once", async () => {
    const { fetchStatus, onExpired } = setup([]);
    await vi.advanceTimersByTimeAsync(600_000 + LINK_POLL_INTERVAL_MS);
    expect(onExpired).toHaveBeenCalledTimes(1);
    const calls = fetchStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchStatus).toHaveBeenCalledTimes(calls);
  });

  it("stop() (unmount) ends polling", async () => {
    const { fetchStatus, poller } = setup([]);
    await vi.advanceTimersByTimeAsync(LINK_POLL_INTERVAL_MS);
    poller.stop();
    await vi.advanceTimersByTimeAsync(LINK_POLL_INTERVAL_MS * 10);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("skips ticks while hidden; resume() polls at once", async () => {
    const { fetchStatus, poller } = setup([]);
    hidden = true;
    await vi.advanceTimersByTimeAsync(LINK_POLL_INTERVAL_MS * 4);
    expect(fetchStatus).not.toHaveBeenCalled();
    hidden = false;
    poller.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("a failed poll keeps polling", async () => {
    const { fetchStatus, onStatus } = setup([new Error("offline"), LINKED]);
    await vi.advanceTimersByTimeAsync(LINK_POLL_INTERVAL_MS * 2);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(onStatus).toHaveBeenCalledWith(LINKED);
  });
});
