import { describe, expect, it } from "vitest";
import {
  evaluateJoinGate,
  interpretJoinWorkerResult,
  sanitizeJoinStateError,
} from "@/lib/processes/join-flow";
import { withDayLimitCooldown, withSpamblockStatus } from "@/lib/telegram-accounts";

describe("вступление в группы · gate", () => {
  it("требует аккаунт и реальную ссылку", () => {
    expect(evaluateJoinGate({ groupUrl: "https://t.me/sellers" }).reason).toBe(
      "missing_account",
    );
    // Известная заглушка каталога (см. catalogPlaceholderUsernames)
    expect(
      evaluateJoinGate({
        accountId: "a1",
        account: { status: "active", limits: { invite: 40 } },
        groupUrl: "https://t.me/mp_automation",
      }).ok,
    ).toBe(false);
    expect(
      evaluateJoinGate({
        accountId: "a1",
        account: { status: "active", limits: { invite: 40 } },
        groupUrl: "https://t.me/mp_automation",
      }).reason,
    ).toBe("placeholder_url");
  });

  it("блокирует spamblock / freeze / дневную отлёжку / квоту / pace", () => {
    expect(
      evaluateJoinGate({
        accountId: "a1",
        groupUrl: "https://t.me/wildberries_sllr",
        account: withSpamblockStatus({ status: "active" }),
      }).reason,
    ).toBe("spamblock");

    expect(
      evaluateJoinGate({
        accountId: "a1",
        groupUrl: "https://t.me/wildberries_sllr",
        account: { status: "frozen" },
      }).reason,
    ).toBe("frozen");

    const cool = withDayLimitCooldown(
      { status: "active", limits: { invite: 1 }, joinsToday: 1, joinsDay: "2099-01-01" },
      "invite",
    );
    expect(
      evaluateJoinGate({
        accountId: "a1",
        groupUrl: "https://t.me/wildberries_sllr",
        account: cool,
      }).reason,
    ).toBe("cooldown");

    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    expect(
      evaluateJoinGate({
        accountId: "a1",
        groupUrl: "https://t.me/wildberries_sllr",
        account: {
          status: "active",
          limits: { invite: 2 },
          joinsToday: 2,
          joinsDay: day,
        },
      }).reason,
    ).toBe("quota");

    expect(
      evaluateJoinGate({
        accountId: "a1",
        groupUrl: "https://t.me/wildberries_sllr",
        account: {
          status: "active",
          limits: { invite: 40 },
          lastJoinAt: new Date().toISOString(),
        },
      }).reason,
    ).toBe("pace");
  });

  it("пускает активный аккаунт с квотой", () => {
    expect(
      evaluateJoinGate({
        accountId: "a1",
        groupUrl: "https://t.me/wildberries_sllr",
        account: { status: "active", limits: { invite: 40 } },
      }),
    ).toEqual({ ok: true });
  });
});

describe("вступление · ответ воркера", () => {
  it("joined / pending / already", () => {
    expect(interpretJoinWorkerResult({ ok: true, join: "ok" }).kind).toBe("joined");
    expect(interpretJoinWorkerResult({ ok: true, join: "requested" }).kind).toBe(
      "pending",
    );
    expect(interpretJoinWorkerResult({ ok: false, join: "already" }).kind).toBe(
      "already",
    );
  });

  it("FloodWait — только pace, не отлёжка", () => {
    const out = interpretJoinWorkerResult({
      ok: false,
      join: "flood",
      error: "FloodWait 120",
    });
    expect(out).toMatchObject({ kind: "flood", waitSec: 120, pace: true });
  });

  it("frozen / fail", () => {
    expect(
      interpretJoinWorkerResult({ ok: false, status: "frozen", error: "FROZEN" }).kind,
    ).toBe("frozen");
    expect(interpretJoinWorkerResult({ ok: false, error: "USER_BANNED" }).kind).toBe(
      "fail",
    );
  });
});

describe("sanitizeJoinStateError", () => {
  it("чистит null/object и режет длину", () => {
    expect(sanitizeJoinStateError(null)).toBe("");
    expect(sanitizeJoinStateError({ _def: "zod" })).toBe("");
    expect(sanitizeJoinStateError("x".repeat(600)).length).toBe(500);
    expect(sanitizeJoinStateError("ok")).toBe("ok");
  });
});
