import { describe, expect, it } from "vitest";
import { isDeadTmePage, probeTmeUsername, probeableUsername, tmeMissingMessage, type TmeFetch } from "@/lib/tme-probe";

/** Trimmed real t.me markup (2026-10-01), only the parts the parser reads. */
function page(title: string, extra: string, button: string): string {
  return `<!DOCTYPE html><html><head><meta property="og:title" content="${title}">
<meta property="og:description" content=""></head><body><div class="tgme_page_wrap"><div class="tgme_page">
<div class="tgme_page_title"><span dir="auto">${title}</span></div>${extra}
<div class="tgme_page_action"><a class="tgme_action_button_new shine" href="tg://resolve?domain=x">${button}</a></div>
</div></div></body></html>`;
}

const LIVE_CHAT = page("OZON чат поставщиков", '<div class="tgme_page_extra">6 569 members, 879 online</div>', "View in Telegram");
const LIVE_CHANNEL = page("Telegram News", '<div class="tgme_page_extra">9 429 480 subscribers</div>', "View in Telegram");
const MISSING = page("Telegram: Contact @ozonbusiness", "", "Send Message");
const BOT = page("BotFather", '<div class="tgme_page_extra">7 618 841 monthly users</div>', "Start Bot");
const USER = page("Some Person", '<div class="tgme_page_extra">@some_person</div>', "Send Message");

describe("isDeadTmePage", () => {
  it("a live chat and a live channel are not dead", () => {
    expect(isDeadTmePage(LIVE_CHAT)).toBe(false);
    expect(isDeadTmePage(LIVE_CHANNEL)).toBe(false);
  });

  it("a non-existent username is dead", () => {
    expect(isDeadTmePage(MISSING)).toBe(true);
  });

  it("a user or bot page is dead for joining (no members line)", () => {
    expect(isDeadTmePage(BOT)).toBe(true);
    expect(isDeadTmePage(USER)).toBe(true);
  });

  it("an unrecognisable page (captcha, error, empty) is never dead", () => {
    expect(isDeadTmePage("")).toBe(false);
    expect(isDeadTmePage("<html><body>502 Bad Gateway</body></html>")).toBe(false);
  });
});

describe("probeTmeUsername", () => {
  const answer = (html: string, status = 200): TmeFetch => async () => new Response(html, { status });

  it("maps pages to live / dead", async () => {
    expect(await probeTmeUsername("ozon_mplace", { fetchImpl: answer(LIVE_CHAT) })).toBe("live");
    expect(await probeTmeUsername("ozonbusiness", { fetchImpl: answer(MISSING) })).toBe("dead");
  });

  it("network failure and non-200 are unknown, after one retry", async () => {
    let calls = 0;
    const failing: TmeFetch = async () => {
      calls++;
      throw new Error("ECONNRESET");
    };
    expect(await probeTmeUsername("x_chat", { fetchImpl: failing })).toBe("unknown");
    expect(calls).toBe(2);
    expect(await probeTmeUsername("x_chat", { fetchImpl: answer("rate limited", 429) })).toBe("unknown");
  });

  it("retries once and uses the second answer", async () => {
    let calls = 0;
    const flaky: TmeFetch = async () => {
      calls++;
      if (calls === 1) throw new Error("timeout");
      return new Response(MISSING);
    };
    expect(await probeTmeUsername("ozonbusiness", { fetchImpl: flaky })).toBe("dead");
  });
});

describe("helpers", () => {
  it("only public usernames are probeable", () => {
    expect(probeableUsername("https://t.me/OzonBusiness")).toBe("ozonbusiness");
    expect(probeableUsername("https://t.me/+AbCdEf123")).toBeNull();
    expect(probeableUsername("https://t.me/joinchat/AbCdEf123")).toBeNull();
  });

  it("states plainly that the chat does not exist", () => {
    expect(tmeMissingMessage("ozonbusiness")).toBe("Чат @ozonbusiness не существует в Telegram");
  });
});
