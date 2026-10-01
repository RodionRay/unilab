import { describe, expect, it } from "vitest";
import {
  TME_LIVE_RECHECK_MS,
  TME_UNKNOWN_RETRY_MS,
  classifyTmePage,
  isDeadTmePage,
  probeTmeUsername,
  probeableUsername,
  tmeMissingMessage,
  tmeProbeDue,
  type TmeFetch,
} from "@/lib/tme-probe";

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
/** Real dead username: no tgme_page_title, no tgme_page_extra, a plain «Send Message» button. */
const MISSING = `<html><head><meta property="og:title" content="Telegram: Contact @ozonbusiness"></head><body>
<div class="tgme_page_wrap"><div class="tgme_page"><div class="tgme_page_icon"></div><div class="tgme_page_description"></div>
<div class="tgme_page_action"><a class="tgme_action_button_new" href="tg://resolve?domain=ozonbusiness">Send Message</a></div></div></div></body></html>`;
const ADDLIST = `<html><head><meta property="og:title" content="Telegram Chats"></head><body><div class="tgme_page">
<div class="tgme_page_action"><a class="tgme_action_button_new shine" href="tg://addlist?slug=abc">View Chats</a></div></div></body></html>`;
/** Restricted / scam-marked channel: page markup, no audience line, not a DM button. */
const RESTRICTED = page("Some Channel", "", "View in Telegram");
const OG_ONLY = '<html><head><meta property="og:title" content="Telegram: Contact @x"></head><body></body></html>';
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

  it("an addlist page, a restricted channel and an og:title-only page are unknown, never dead", () => {
    expect(classifyTmePage(ADDLIST)).toBe("unknown");
    expect(classifyTmePage(RESTRICTED)).toBe("unknown");
    expect(classifyTmePage(OG_ONLY)).toBe("unknown");
    expect(classifyTmePage(LIVE_CHAT)).toBe("live");
    expect(classifyTmePage(MISSING)).toBe("dead");
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

  it("does not follow redirects: a 3xx (t.me root → telegram.org) is unknown", async () => {
    let redirect = "";
    const root: TmeFetch = async (_url, init) => {
      redirect = String(init.redirect);
      return new Response(null, { status: 302, headers: { location: "https://telegram.org/" } });
    };
    expect(await probeTmeUsername("some_chat", { fetchImpl: root })).toBe("unknown");
    expect(redirect).toBe("manual");
  });

  it("reads at most 256 KB of the body (an endless page does not hang)", async () => {
    let pulled = 0;
    const endless: TmeFetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(ctrl) {
            pulled++;
            ctrl.enqueue(new TextEncoder().encode(pulled === 1 ? MISSING : " ".repeat(64 * 1024)));
          },
        }),
      );
    expect(await probeTmeUsername("ozonbusiness", { fetchImpl: endless, attempts: 1 })).toBe("dead");
    expect(pulled).toBeLessThan(10);
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
  it("only public usernames are probeable; reserved t.me paths never are", () => {
    expect(probeableUsername("https://t.me/OzonBusiness")).toBe("ozonbusiness");
    for (const path of ["addlist/abcdef", "share/url?url=x", "proxy?server=x", "addstickers/pack1", "contact/abc123", "login/abc", "setlanguage/ru", "s/channel", "c/12345/6", "iv?url=x"]) {
      expect(probeableUsername(`https://t.me/${path}`)).toBeNull();
    }
    expect(probeableUsername("https://t.me/+AbCdEf123")).toBeNull();
    expect(probeableUsername("https://t.me/joinchat/AbCdEf123")).toBeNull();
  });

  it("an unknown probe waits 30 minutes, a live one 7 days; dead is final", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    const at = (ms: number) => new Date(now - ms).toISOString();
    expect(tmeProbeDue({}, now)).toBe(true);
    expect(tmeProbeDue({ tmeProbe: "unknown", tmeProbeAt: at(TME_UNKNOWN_RETRY_MS - 1000) }, now)).toBe(false);
    expect(tmeProbeDue({ tmeProbe: "unknown", tmeProbeAt: at(TME_UNKNOWN_RETRY_MS + 1000) }, now)).toBe(true);
    expect(tmeProbeDue({ tmeProbe: "live", tmeProbeAt: at(1000) }, now)).toBe(false);
    expect(tmeProbeDue({ tmeProbe: "live", tmeProbeAt: at(TME_LIVE_RECHECK_MS + 1000) }, now)).toBe(true);
    expect(TME_LIVE_RECHECK_MS).toBe(7 * 24 * 60 * 60_000);
    expect(TME_UNKNOWN_RETRY_MS).toBe(30 * 60_000);
  });

  it("states plainly that the chat does not exist", () => {
    expect(tmeMissingMessage("ozonbusiness")).toBe("Чат @ozonbusiness не существует в Telegram");
  });
});
