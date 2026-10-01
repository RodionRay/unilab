import { describe, expect, it } from "vitest";
import {
  classifyInviteUser,
  interpretInviteWorkerResult,
  inviteAccountStillLive,
  inviteBatchLimit,
  inviteUserPatch,
} from "@/lib/processes/invite-tick";
import { moscowDayKey } from "@/lib/telegram-accounts";

const today = moscowDayKey();

describe("инвайт · тик воркера", () => {
  it("PEER_FLOOD → spamblock", () => {
    const out = interpretInviteWorkerResult(
      { status: "spamblock", error: "PEER_FLOOD" },
      { status: "active" },
    );
    expect(out.kind).toBe("spamblock");
    expect(out.accountPatch?.status).toBe("spamblock");
    expect(out.wentCooldown).toBe(true);
  });

  it("frozen → frozen", () => {
    const out = interpretInviteWorkerResult(
      { status: "frozen", error: "FROZEN" },
      { status: "active" },
    );
    expect(out.kind).toBe("frozen");
    expect(out.accountPatch?.status).toBe("frozen");
  });

  it("FloodWait → пауза без смены статуса аккаунта", () => {
    const out = interpretInviteWorkerResult(
      { status: "floodwait", floodWait: 180 },
      { status: "active" },
    );
    expect(out).toMatchObject({ kind: "flood", waitSec: 180, okN: 0 });
    expect(out.accountPatch).toBeUndefined();
  });

  it("FloodWait после успешных инвайтов бампит квоту аккаунта (REQ-V5)", () => {
    const out = interpretInviteWorkerResult(
      { ok: false, status: "floodwait", floodWait: 300, results: [{ ok: true, userId: "1" }] },
      { status: "active", memberInviteDay: today, memberInvitesToday: 5 },
    );
    expect(out.kind).toBe("flood");
    expect(out.okN).toBe(1);
    expect(out.accountPatch).toMatchObject({ memberInviteDay: today, memberInvitesToday: 6, status: "active" });
  });

  it("успешный батч бампит квоту и может увести в дневную отлёжку", () => {
    const out = interpretInviteWorkerResult(
      {
        ok: true,
        results: [
          { ok: true, userId: "1" },
          { ok: true, userId: "2" },
          { ok: false, userId: "3", error: "privacy" },
        ],
      },
      {
        status: "active",
        limits: { invite: 40, message: 40, chat: 40, memberInvite: 2 },
      },
    );
    expect(out.kind).toBe("batch");
    expect(out.okN).toBe(2);
    expect(out.failN).toBe(1);
    expect(out.wentCooldown).toBe(true);
    expect(out.accountPatch?.status).toBe("cooldown");
  });

  it("«уже в группе» считается отдельно и не тратит квоту (REQ-V4)", () => {
    const out = interpretInviteWorkerResult(
      { ok: true, results: [{ ok: true, userId: "1", error: "already" }] },
      { status: "active", memberInviteDay: today, memberInvitesToday: 3 },
    );
    expect(out).toMatchObject({ kind: "batch", okN: 0, alreadyN: 1, failN: 0 });
    expect(out.accountPatch).toBeUndefined();
    expect(out.users[0].verdict).toBe("already");
  });

  it("need_admin в результатах пользователя — ошибка цели, пользователь не тронут (REQ-V2)", () => {
    const out = interpretInviteWorkerResult(
      { ok: true, results: [{ ok: false, userId: "1", error: "need_admin" }] },
      { status: "active" },
    );
    expect(out.kind).toBe("target_error");
    if (out.kind === "target_error") {
      expect(out.code).toBe("need_admin");
      expect(out.message).toMatch(/администратор/);
    }
    expect(out.users).toEqual([]);
  });

  it("status target_error воркера → ошибка цели с его текстом; успешные до ошибки учтены", () => {
    const out = interpretInviteWorkerResult(
      {
        ok: false,
        status: "target_error",
        targetError: "chat_full",
        error: "Целевая группа заполнена",
        results: [{ ok: true, userId: "1" }],
      },
      { status: "active" },
    );
    expect(out).toMatchObject({ kind: "target_error", code: "chat_full", message: "Целевая группа заполнена", okN: 1 });
    expect(out.accountPatch?.memberInvitesToday).toBe(1);
  });

  it("ok:false без результатов (канал / нет цели) — ошибка цели, не пустой батч", () => {
    const out = interpretInviteWorkerResult(
      { ok: false, error: "Цель — канал, не группа", results: [] },
      { status: "active" },
    );
    expect(out).toMatchObject({ kind: "target_error", message: "Цель — канал, не группа" });
  });

  it("слепой аккаунт — не ошибка цели", () => {
    const out = interpretInviteWorkerResult(
      { ok: false, accountBlind: true, error: "blind", results: [] },
      { status: "active" },
    );
    expect(out.kind).toBe("account_blind");
  });

  it("inviteAccountStillLive учитывает отлёжку и квоту", () => {
    expect(inviteAccountStillLive({ status: "active" }, true)).toBe(false);
    expect(inviteAccountStillLive({ status: "spamblock" }, false)).toBe(false);
    expect(
      inviteAccountStillLive(
        {
          status: "active",
          limits: { memberInvite: 40 },
        },
        false,
      ),
    ).toBe(true);
  });
});

describe("инвайт · вердикт по пользователю", () => {
  it.each([
    [{ ok: true }, "invited"],
    [{ ok: true, error: "already" }, "already"],
    [{ ok: false, error: "privacy" }, "skipped"],
    [{ ok: false, error: "USER_PRIVACY_RESTRICTED" }, "skipped"],
    [{ ok: false, error: "kicked" }, "skipped"],
    [{ ok: false, error: "no_entity" }, "retry"],
    [{ ok: false, error: "Could not find the input entity for PeerUser" }, "retry"],
    [{ ok: false, error: "USER_ID_INVALID" }, "failed"],
  ] as const)("%j → %s", (r, verdict) => {
    expect(classifyInviteUser(r).verdict).toBe(verdict);
  });

  it("privacy — постоянный пропуск без повторов", () => {
    expect(inviteUserPatch({ verdict: "skipped", reason: "privacy" }, { invited: false })).toEqual({
      invited: true,
      skipReason: "privacy",
    });
  });

  it("soft-fail повторяется до 3 раз, потом списывается", () => {
    expect(inviteUserPatch({ verdict: "retry", reason: "no_entity" }, { inviteSoftFails: 0 })).toEqual({
      invited: false,
      skipReason: "no_entity",
      inviteSoftFails: 1,
    });
    expect(inviteUserPatch({ verdict: "retry", reason: "no_entity" }, { inviteSoftFails: 2 })).toEqual({
      invited: true,
      skipReason: "soft_fail_limit",
      inviteSoftFails: 3,
    });
  });

  it("already — отмечен, повторно не приглашаем", () => {
    expect(inviteUserPatch({ verdict: "already", reason: "already" }, {})).toEqual({ invited: true, skipReason: "already" });
  });
});

describe("инвайт · размер батча", () => {
  it("режется остатком дневного лимита задачи (REQ-V3)", () => {
    expect(inviteBatchLimit({ batchSize: 5, dailyLimitEnabled: true, dailyLimit: 10 }, 8)).toBe(2);
    expect(inviteBatchLimit({ batchSize: 5, dailyLimitEnabled: true, dailyLimit: 10 }, 10)).toBe(0);
    expect(inviteBatchLimit({ batchSize: 5, dailyLimitEnabled: false, dailyLimit: 10 }, 10)).toBe(5);
    expect(inviteBatchLimit({ batchSize: 99 }, 0)).toBe(20);
  });
});
