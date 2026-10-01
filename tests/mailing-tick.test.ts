import { describe, expect, it } from "vitest";
import {
  interpretMailingSendResult,
  isAmbiguousSendError,
  mailingPersonKey,
  notePeerMiss,
  untriedAccountIds,
} from "@/lib/processes/mailing-tick";

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

  it("REQ-M4: FloodWait пишет floodUntil аккаунту, статус не меняет", () => {
    const out = interpretMailingSendResult(
      { ok: false, status: "flood", error: "FloodWait 600с", waitSec: 600 },
      { status: "active" },
      "dm",
    );
    expect(out.kind).toBe("rate_limit");
    if (out.kind === "rate_limit") {
      expect(out.accountPatch.status).toBe("active");
      expect(Date.parse(String(out.accountPatch.floodUntil)) - Date.now()).toBeGreaterThan(590_000);
    }
  });

  it("REQ-M1: PEER_FLOOD c текстом «Too many requests» — спамблок, не FloodWait", () => {
    const out = interpretMailingSendResult(
      { ok: false, status: "spamblock", error: "PEER_FLOOD: Too many requests (caused by SendMessageRequest)" },
      { status: "active" },
      "dm",
    );
    expect(out.kind).toBe("spamblock");
  });

  it("классифицирует отказы получателя", () => {
    const fail = (error: string) => {
      const out = interpretMailingSendResult({ ok: false, error }, { status: "active" }, "dm");
      return out.kind === "fail" ? out.failKind : out.kind;
    };
    expect(fail("Не удалось открыть пользователя (нет access_hash)")).toBe("peer_miss");
    expect(fail("Пользователь ограничил личные сообщения")).toBe("permanent");
    expect(fail("AUTH_KEY_UNREGISTERED")).toBe("dead_account");
    expect(fail("USER_DEACTIVATED_BAN")).toBe("dead_account");
    expect(fail("USER_DEACTIVATED")).toBe("permanent");
    expect(fail("Internal server error")).toBe("retry");
  });

  it("REQ-M7: DM не уводит в отлёжку по исчерпанным вступлениям", () => {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const out = interpretMailingSendResult(
      { ok: true },
      { status: "active", limits: { invite: 1, message: 40 }, joinsToday: 1, joinsDay: day },
      "dm",
    );
    expect(out.kind === "ok" && out.bumped.status).toBe("active");
  });

  it("REQ-M5: промах peer — до N попыток или пока не перепробованы все живые аккаунты", () => {
    let st = notePeerMiss({}, "u:1", "a", ["a", "b", "c", "d"], 3);
    expect(st.permanent).toBe(false);
    expect(untriedAccountIds(st.state, "u:1", ["a", "b"])).toEqual(["b"]);
    st = notePeerMiss(st.state, "u:1", "b", ["a", "b", "c", "d"], 3);
    expect(st.permanent).toBe(false);
    st = notePeerMiss(st.state, "u:1", "c", ["a", "b", "c", "d"], 3);
    expect(st.permanent).toBe(true);

    const all = notePeerMiss({}, "u:2", "a", ["a"], 3);
    expect(all.permanent).toBe(true);
  });

  it("ключ человека для реестра: ЛС по userId/username, чат — по лиду", () => {
    expect(mailingPersonKey("dm", { userId: "5", username: "X", leadId: "L" })).toBe("dm:u:5");
    expect(mailingPersonKey("dm", { userId: "", username: "@Nick", leadId: "L" })).toBe("dm:un:nick");
    expect(mailingPersonKey("chat", { userId: "5", username: "", leadId: "L" })).toBe("chat:lead:L");
  });

  it("R1: таймаут/abort — неизвестный исход, 429 и прочее — не отправлено", () => {
    expect(isAmbiguousSendError(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe(true);
    expect(isAmbiguousSendError(Object.assign(new Error("a"), { name: "AbortError" }))).toBe(true);
    expect(isAmbiguousSendError(new Error("Воркер занят"))).toBe(false);
  });
});
