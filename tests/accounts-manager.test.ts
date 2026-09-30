import { describe, expect, it } from "vitest";
import {
  accountAvatarColor,
  accountLimitsUsage,
  accountUpdatedAt,
  applyQuotaCooldownIfExhausted,
  canPollDmInbox,
  cooldownRemainingShort,
  isAccountUsable,
  isDayLimitCooldown,
  relativeTimeRu,
  withDayLimitCooldown,
  withFrozenStatus,
  withSpamblockStatus,
} from "@/lib/telegram-accounts";

describe("менеджер аккаунтов · helpers", () => {
  it("считает дневные лимиты used/limit", () => {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const u = accountLimitsUsage({
      limits: { invite: 30, message: 10, chat: 10, memberInvite: 40 },
      joinsToday: 2,
      joinsDay: day,
      messagesToday: 0,
      messagesDay: day,
      memberInvitesToday: 1,
      memberInviteDay: day,
    });
    expect(u).toMatchObject({
      joins: 2,
      messages: 0,
      memberInvites: 1,
      inviteLimit: 30,
      messageLimit: 10,
    });
  });

  it("форматирует остаток отлёжки и относительное время", () => {
    const now = Date.parse("2026-09-18T12:00:00.000Z");
    expect(
      cooldownRemainingShort(new Date(now + 5 * 3600_000).toISOString(), now),
    ).toMatch(/5 час/);
    expect(cooldownRemainingShort("", now)).toBe("");
    expect(
      relativeTimeRu(new Date(now - 39 * 60_000).toISOString(), now),
    ).toMatch(/39 минут назад/);
  });

  it("выбирает самое свежее обновление и цвет аватара", () => {
    expect(
      accountUpdatedAt(
        { checkingAt: "2026-09-18T10:00:00.000Z", lastJoinAt: "2026-09-17T10:00:00.000Z" },
        "2026-09-01T00:00:00.000Z",
      ),
    ).toBe("2026-09-18T10:00:00.000Z");
    expect(accountAvatarColor("a")).toMatch(/^#/);
    expect(accountAvatarColor("a")).toBe(accountAvatarColor("a"));
  });

  it("spamblock/cooldown: inbox можно, отправку нельзя", () => {
    expect(isAccountUsable({ status: "spamblock" })).toBe(false);
    expect(canPollDmInbox({ status: "spamblock" })).toBe(true);
    expect(canPollDmInbox({ status: "cooldown" })).toBe(true);
    expect(canPollDmInbox({ status: "unauthorized" })).toBe(false);
    expect(canPollDmInbox({ status: "active" })).toBe(true);
  });

  it("отлёжка только по лимиту/спаму/заморозке — не по cooldownUntil без статуса", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    // Старый фейл коннекта: active + cooldownUntil — аккаунт рабочий
    expect(isAccountUsable({ status: "active", cooldownUntil: future })).toBe(true);
    expect(isDayLimitCooldown({ status: "active", cooldownUntil: future })).toBe(false);
    expect(isAccountUsable({ status: "disconnected", cooldownUntil: future })).toBe(false);

    const limited = withDayLimitCooldown(
      { status: "active", limits: { invite: 1 }, joinsToday: 1, joinsDay: "2099-01-01" },
      "invite",
    );
    expect(limited.status).toBe("cooldown");
    expect(limited.cooldownReason).toBe("day_invite");
    expect(isDayLimitCooldown(limited)).toBe(true);
    expect(isAccountUsable(limited)).toBe(false);

    const spam = withSpamblockStatus({ status: "active" }, "PEER_FLOOD");
    expect(spam.status).toBe("spamblock");
    expect(isAccountUsable(spam)).toBe(false);

    const frozen = withFrozenStatus({ status: "active" });
    expect(frozen.status).toBe("frozen");
    expect(frozen.cooldownUntil).toBe("");
    expect(isAccountUsable(frozen)).toBe(false);
  });

  it("applyQuotaCooldownIfExhausted ставит отлёжку при исчерпании лимита", () => {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const out = applyQuotaCooldownIfExhausted({
      status: "active",
      limits: { invite: 2, message: 40, chat: 40, memberInvite: 40 },
      joinsToday: 2,
      joinsDay: day,
    });
    expect(out.status).toBe("cooldown");
    expect(String(out.error)).toMatch(/вступлений/);
  });

  it("сбрасывает осиротевший cooldownUntil без status=cooldown", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const out = applyQuotaCooldownIfExhausted({
      status: "active",
      cooldownUntil: future,
      cooldownReason: "legacy_flood",
      limits: { invite: 40, message: 40, chat: 40, memberInvite: 40 },
    });
    expect(out.status).toBe("active");
    expect(out.cooldownUntil).toBe("");
    expect(isAccountUsable(out)).toBe(true);
  });

  it("отлёжка по комментариям и инвайтам рассылки", () => {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const chat = applyQuotaCooldownIfExhausted({
      status: "active",
      limits: { invite: 40, message: 40, chat: 2, memberInvite: 40 },
      chatsToday: 2,
      chatsDay: day,
    });
    expect(chat.status).toBe("cooldown");
    expect(String(chat.cooldownReason)).toBe("day_chat");

    const invites = applyQuotaCooldownIfExhausted({
      status: "active",
      limits: { invite: 40, message: 40, chat: 40, memberInvite: 3 },
      memberInvitesToday: 3,
      memberInviteDay: day,
    });
    expect(invites.status).toBe("cooldown");
    expect(String(invites.cooldownReason)).toBe("day_memberInvite");
  });

  it("day_chat / day_memberInvite ставят cooldownReason и блокируют аккаунт", () => {
    const chat = withDayLimitCooldown({ status: "active" }, "chat");
    expect(chat.status).toBe("cooldown");
    expect(chat.cooldownReason).toBe("day_chat");
    expect(String(chat.error)).toMatch(/комментариев/i);
    expect(isAccountUsable(chat)).toBe(false);

    const member = withDayLimitCooldown({ status: "active" }, "memberInvite");
    expect(member.status).toBe("cooldown");
    expect(member.cooldownReason).toBe("day_memberInvite");
    expect(String(member.error)).toMatch(/инвайт/i);
    expect(isAccountUsable(member)).toBe(false);
  });

  it("isDayLimitCooldown: только status=cooldown + живой таймер", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const past = new Date(Date.now() - 3600_000).toISOString();
    expect(isDayLimitCooldown({ status: "cooldown", cooldownUntil: future })).toBe(true);
    expect(isDayLimitCooldown({ status: "active", cooldownUntil: future })).toBe(false);
    expect(isDayLimitCooldown({ status: "cooldown", cooldownUntil: past })).toBe(false);
    expect(isDayLimitCooldown({ status: "cooldown", cooldownUntil: "" })).toBe(false);
  });
});
