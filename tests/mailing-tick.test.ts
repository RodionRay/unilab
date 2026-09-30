import { describe, expect, it } from "vitest";
import { interpretMailingSendResult } from "@/lib/processes/mailing-tick";

describe("рассылка · интерпретация send", () => {
  it("FloodWait / Too many requests — rate_limit, аккаунт не трогаем", () => {
    const out = interpretMailingSendResult(
      { ok: false, error: "FloodWait 90", waitSec: 90 },
      { status: "active" },
      "dm",
    );
    expect(out.kind).toBe("rate_limit");
    if (out.kind === "rate_limit") expect(out.waitSec).toBeGreaterThanOrEqual(90);
  });

  it("PEER_FLOOD / write-ban → spamblock", () => {
    const peer = interpretMailingSendResult(
      { ok: false, status: "spamblock", error: "PEER_FLOOD" },
      { status: "active" },
      "dm",
    );
    expect(peer.kind).toBe("spamblock");

    const ban = interpretMailingSendResult(
      {
        ok: false,
        error:
          "You're banned from sending messages in superroups/channels (caused by SendMessageRequest)",
      },
      { status: "active" },
      "chat",
    );
    expect(ban.kind).toBe("spamblock");
    if (ban.kind === "spamblock") {
      expect(ban.accountPatch.cooldownReason).toBe("spamblock");
    }
  });

  it("frozen → frozen", () => {
    const out = interpretMailingSendResult(
      { ok: false, status: "frozen", error: "FROZEN" },
      { status: "active" },
      "dm",
    );
    expect(out.kind).toBe("frozen");
  });

  it("ok бампит message/chat и может увести в дневную отлёжку", () => {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const dm = interpretMailingSendResult(
      { ok: true },
      {
        status: "active",
        limits: { invite: 40, message: 1, chat: 40, memberInvite: 40 },
        messagesToday: 0,
        messagesDay: day,
      },
      "dm",
    );
    expect(dm.kind).toBe("ok");
    if (dm.kind === "ok") {
      expect(dm.wentDayCooldown).toBe(true);
      expect(dm.bumped.status).toBe("cooldown");
    }

    const chat = interpretMailingSendResult(
      { ok: true },
      {
        status: "active",
        limits: { invite: 40, message: 40, chat: 1, memberInvite: 40 },
        chatsToday: 0,
        chatsDay: day,
      },
      "chat",
    );
    expect(chat.kind).toBe("ok");
    if (chat.kind === "ok") {
      expect(chat.wentDayCooldown).toBe(true);
    }
  });
});
