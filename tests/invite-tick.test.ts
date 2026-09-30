import { describe, expect, it } from "vitest";
import {
  interpretInviteWorkerResult,
  inviteAccountStillLive,
} from "@/lib/processes/invite-tick";

describe("инвайт · тик воркера", () => {
  it("PEER_FLOOD → spamblock", () => {
    const out = interpretInviteWorkerResult(
      { status: "spamblock", error: "PEER_FLOOD" },
      { status: "active" },
    );
    expect(out.kind).toBe("spamblock");
    if (out.kind === "spamblock") {
      expect(out.accountPatch.status).toBe("spamblock");
    }
  });

  it("frozen → frozen", () => {
    const out = interpretInviteWorkerResult(
      { status: "frozen", error: "FROZEN" },
      { status: "active" },
    );
    expect(out.kind).toBe("frozen");
  });

  it("FloodWait → пауза без смены статуса аккаунта", () => {
    const out = interpretInviteWorkerResult(
      { status: "floodwait", floodWait: 180 },
      { status: "active" },
    );
    expect(out).toEqual({ kind: "flood", waitSec: 180 });
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
    if (out.kind === "batch") {
      expect(out.okN).toBe(2);
      expect(out.failN).toBe(1);
      expect(out.wentCooldown).toBe(true);
      expect(out.accountPatch?.status).toBe("cooldown");
    }
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
