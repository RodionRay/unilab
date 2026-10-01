import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Web settings block «Telegram-приложение» (components/product/tma-link-panel.tsx), REQ-L1/L4/N2 UI side.
 * /app is behind requireUser (lib/auth.ts): the server must run with SESSION_SECRET = TMA_E2E_SESSION_SECRET
 * (`npm start -- --port <p> --var SESSION_SECRET:<secret>`, then TMA_E2E_REUSE=1). The test signs a session
 * cookie with it exactly like lib/auth.ts::createSessionToken. All /api/* calls are mocked with page.route.
 * TMA_SETTINGS_SHOTS=<dir> also writes screenshots of every state.
 */
const SECRET = process.env.TMA_E2E_SESSION_SECRET ?? "";
const SHOTS = process.env.TMA_SETTINGS_SHOTS ?? "";
const NOW = new Date("2026-10-01T09:00:00Z").getTime();
const USER = { id: "u-e2e-owner", email: "anna@example.test", name: "Анна Орлова" };
const APP_URL = "https://crm.unilab.example/tma/Wk3yQ9mZ2bX7pL4sT8vN";
const START_LINK = "https://t.me/unilab_leads_bot?start=link_Q2x9vT4mZp8RkY3wN6sLb0Hc";

test.skip(!SECRET, "TMA_E2E_SESSION_SECRET not set: /app needs a signed session cookie");

function sessionCookie(): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: USER.id, email: USER.email, name: USER.name, exp: Math.floor(Date.now() / 1000) + 3600 }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
}

type Link = { linked: boolean; tgUsername: string; dmNotices: boolean; dmError: string; appUrl: string; startLink?: string; expiresAt?: number };
type Reply = { status: number; body: unknown; headers?: Record<string, string> } | "abort";
type LinkHandler = (action: string, body: Record<string, unknown>) => Reply | undefined;
type Opts = { owner?: boolean; botToken?: string; link?: Partial<Link>; handler?: LinkHandler };

const UNLINKED: Link = { linked: false, tgUsername: "", dmNotices: false, dmError: "", appUrl: APP_URL };
const LINKED: Link = { linked: true, tgUsername: "anna_orlova", dmNotices: true, dmError: "", appUrl: APP_URL };

function workspacePayload(owner: boolean, botToken: string) {
  return {
    records: [
      {
        id: "s-1",
        kind: "settings",
        hasSecret: false,
        created: "2026-09-01T10:00:00Z",
        data: { scanDepthDays: 7, autoRescanEnabled: true, autoRescanMinutes: 30, profileName: "UniLab · Студия Орловой", profileAbout: "", profileContact: "@anna_orlova", notifyEnabled: true, notifyBotToken: owner ? botToken : "", notifyChatId: "-1002233445566" },
      },
    ],
    telegramConnected: true,
    ai: null,
    workspace: owner
      ? { isOwner: true, role: "owner", access: {}, ownerId: USER.id }
      : { isOwner: false, role: "viewer", access: { overview: true, leads: true, chats: true, notifications: true, settings: true }, ownerId: "u-owner" },
    me: { userId: USER.id, email: USER.email, name: USER.name },
  };
}

async function openSettings(page: Page, opts: Opts = {}): Promise<{ calls: Record<string, unknown>[]; link: Link }> {
  const owner = opts.owner ?? true;
  const link: Link = { ...UNLINKED, ...opts.link };
  const calls: Record<string, unknown>[] = [];
  await page.context().addCookies([{ name: "uniseller_session", value: sessionCookie(), domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
    if (url.pathname === "/api/tma/link") {
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      calls.push(body);
      const custom = opts.handler?.(String(body.action), body);
      if (custom === "abort") return route.abort("internetdisconnected");
      if (custom) return json(custom.status, custom.body, custom.headers);
      if (body.action === "create_code") return json(200, { ...link, startLink: START_LINK, expiresAt: Math.floor(Date.now() / 1000) + 600 });
      if (body.action === "set_dm_notices") link.dmNotices = body.enabled === true;
      if (body.action === "set_dm_notices" && body.enabled === true) link.dmError = "";
      if (body.action === "unlink") Object.assign(link, UNLINKED);
      return json(200, link);
    }
    if (url.pathname === "/api/workspace" && route.request().method() === "GET") return json(200, workspacePayload(owner, opts.botToken ?? "123456:AAE-test-token"));
    if (url.pathname === "/api/staff") return json(200, { members: [], invites: [] });
    return json(200, {});
  });
  await page.goto("/app?view=settings");
  await expect(page.getByRole("heading", { name: "Уведомления в Telegram" })).toBeVisible();
  return { calls, link };
}

const panel = (page: Page) => page.getByTestId("tma-link-panel");

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  const width = page.viewportSize()?.width ?? 0;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(500); // settings-card entry animation (0.45 s)
  // The sticky «Сохранить настройки» bar would cover the panel in an element shot; screenshots only.
  await page.addStyleTag({ content: ".settings-actions{position:static!important}" });
  await panel(page).screenshot({ path: path.join(SHOTS, `${width}-${name}.png`), animations: "disabled" });
  await panel(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, `${width}-${name}-viewport.png`), animations: "disabled" });
}

const actionsOf = (calls: Record<string, unknown>[], action: string) => calls.filter((c) => c.action === action);

test.describe("Telegram-приложение in settings", () => {
  test("sits right after the bot block and starts with a status check", async ({ page }) => {
    const { calls } = await openSettings(page);
    const titles = await page.locator(".settings-card h2").allTextContents();
    expect(titles.indexOf("Telegram-приложение")).toBe(titles.indexOf("Уведомления в Telegram") + 1);
    await expect(panel(page).getByRole("button", { name: "Подключить Telegram" })).toBeVisible();
    await expect(panel(page).getByText("Не подключено")).toBeVisible();
    expect(actionsOf(calls, "status")).toHaveLength(1);
    await shot(page, "1-not-linked");
  });

  test("no bot token (owner) → explains the bot block, no button, no API call", async ({ page }) => {
    const { calls } = await openSettings(page, { botToken: "" });
    await expect(panel(page).getByTestId("tma-no-bot")).toContainText("Уведомления в Telegram");
    await expect(panel(page).getByRole("button")).toHaveCount(0);
    expect(calls).toEqual([]);
    await shot(page, "0-no-bot");
  });

  test("connect → start link (new tab) + countdown → polls every 4 s → linked", async ({ page }) => {
    await page.clock.install({ time: NOW });
    let polls = 0;
    const { calls } = await openSettings(page, {
      handler: (action) => {
        if (action !== "status" || ++polls < 3) return undefined;
        return { status: 200, body: { ...LINKED } };
      },
    });
    await panel(page).getByRole("button", { name: "Подключить Telegram" }).click();
    const open = panel(page).getByRole("link", { name: /Открыть бота и подключить/ });
    await expect(open).toHaveAttribute("href", START_LINK);
    await expect(open).toHaveAttribute("target", "_blank");
    await expect(panel(page).getByTestId("tma-countdown")).toContainText("действует ещё 10 минут");
    await expect(panel(page).getByText("Ждём подтверждения", { exact: true })).toBeVisible();
    await shot(page, "2-pending");

    await page.clock.runFor(4000);
    await expect.poll(() => actionsOf(calls, "status").length).toBe(2);
    await page.clock.runFor(4000);
    await expect(panel(page).getByTestId("tma-linked")).toContainText("@anna_orlova");
    await expect(page.getByRole("status").filter({ hasText: "Telegram подключён: @anna_orlova" })).toHaveCount(1);
    await page.clock.runFor(12_000);
    expect(actionsOf(calls, "status")).toHaveLength(3);
  });

  test("code expires → polling stops, «Получить новую ссылку»", async ({ page }) => {
    await page.clock.install({ time: NOW });
    const { calls } = await openSettings(page);
    await panel(page).getByRole("button", { name: "Подключить Telegram" }).click();
    await expect(panel(page).getByTestId("tma-countdown")).toBeVisible();
    await page.clock.runFor(6 * 60_000);
    await expect(panel(page).getByTestId("tma-countdown")).toContainText("действует ещё 4 минуты");
    await page.clock.runFor(4 * 60_000 + 4000);
    await expect(panel(page).getByTestId("tma-expired")).toBeVisible();
    const after = actionsOf(calls, "status").length;
    await page.clock.runFor(20_000);
    expect(actionsOf(calls, "status")).toHaveLength(after);
    await expect(panel(page).getByRole("button", { name: "Получить новую ссылку" })).toBeEnabled();
    await shot(page, "3-expired");
  });

  test("hidden tab skips polls; visible again polls at once", async ({ page }) => {
    await page.clock.install({ time: NOW });
    const { calls } = await openSettings(page);
    await panel(page).getByRole("button", { name: "Подключить Telegram" }).click();
    await expect(panel(page).getByTestId("tma-countdown")).toBeVisible();
    const setVisibility = (state: string) =>
      page.evaluate((s) => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
        document.dispatchEvent(new Event("visibilitychange"));
      }, state);
    await setVisibility("hidden");
    await page.clock.runFor(16_000);
    expect(actionsOf(calls, "status")).toHaveLength(1);
    await setVisibility("visible");
    await expect.poll(() => actionsOf(calls, "status").length).toBe(2);
  });

  test("linked: switch toggles DM notices, appUrl link, unlink with confirm and re-link", async ({ page }) => {
    const { calls } = await openSettings(page, { link: { ...LINKED, dmNotices: false } });
    await expect(panel(page).getByText("Подключено", { exact: true })).toBeVisible();
    const sw = panel(page).getByRole("switch", { name: /Личные уведомления о горячих лидах и ответах/ });
    await expect(sw).not.toBeChecked();
    await sw.click();
    await expect(sw).toBeChecked();
    expect(actionsOf(calls, "set_dm_notices")).toEqual([{ action: "set_dm_notices", enabled: true }]);
    await expect(panel(page).getByRole("link", { name: /Открыть приложение/ })).toHaveAttribute("href", APP_URL);
    await shot(page, "4-linked");

    await panel(page).getByRole("button", { name: "Отключить" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Подключить снова можно в любой момент");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${page.viewportSize()?.width}-6-unlink-confirm.png`) });
    await dialog.getByRole("button", { name: "Оставить" }).click();
    expect(actionsOf(calls, "unlink")).toHaveLength(0);
    await panel(page).getByRole("button", { name: "Отключить" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Отключить" }).click();
    await expect(panel(page).getByRole("button", { name: "Подключить Telegram" })).toBeVisible();
    expect(actionsOf(calls, "unlink")).toEqual([{ action: "unlink" }]);
  });

  test("linked without public https and with a blocked bot: notes in words", async ({ page }) => {
    await openSettings(page, { link: { ...LINKED, appUrl: "", dmNotices: false, dmError: "Forbidden: bot was blocked by the user" } });
    await expect(panel(page).getByRole("link", { name: /Открыть приложение/ })).toHaveCount(0);
    await expect(panel(page).getByTestId("tma-no-app-url")).toContainText("https");
    await expect(panel(page).getByRole("alert")).toContainText("Бот не может написать вам");
    await shot(page, "5-linked-no-app-dm-error");
  });

  test("rate limited → message with wait time + retry works", async ({ page }) => {
    let limited = true;
    const { calls } = await openSettings(page, {
      handler: (action) =>
        action === "create_code" && limited
          ? { status: 429, body: { error: "Слишком много попыток", code: "rate_limited" }, headers: { "Retry-After": "540" } }
          : undefined,
    });
    await panel(page).getByRole("button", { name: "Подключить Telegram" }).click();
    await expect(panel(page).getByTestId("tma-error")).toContainText("Повторите через 9 минут");
    await shot(page, "7-rate-limited");
    limited = false;
    await panel(page).getByRole("button", { name: "Повторить" }).click();
    await expect(panel(page).getByRole("link", { name: /Открыть бота и подключить/ })).toBeVisible();
    expect(actionsOf(calls, "create_code")).toHaveLength(2);
  });

  test("network failure on load → inline error, retry recovers", async ({ page }) => {
    let down = true;
    await openSettings(page, { handler: () => (down ? "abort" : undefined) });
    await expect(panel(page).getByTestId("tma-error")).toContainText("Нет связи с сервером");
    await shot(page, "8-network");
    down = false;
    await panel(page).getByRole("button", { name: "Повторить" }).click();
    await expect(panel(page).getByRole("button", { name: "Подключить Telegram" })).toBeVisible();
  });

  test("forbidden → server text inline", async ({ page }) => {
    await openSettings(page, {
      handler: (action) => (action === "create_code" ? { status: 403, body: { error: "Недопустимый источник запроса", code: "forbidden" } } : undefined),
    });
    await panel(page).getByRole("button", { name: "Подключить Telegram" }).click();
    await expect(panel(page).getByTestId("tma-error")).toContainText("Недопустимый источник запроса");
  });

  test("viewer with settings access: token hidden → asks the server; 409 no bot → explanation", async ({ page }) => {
    await openSettings(page, {
      owner: false,
      handler: (action) =>
        action === "create_code" ? { status: 409, body: { error: "Сначала подключите Telegram-бота уведомлений", code: "workspace_unavailable" } } : undefined,
    });
    await panel(page).getByRole("button", { name: "Подключить Telegram" }).click();
    await expect(panel(page).getByTestId("tma-no-bot")).toBeVisible();
  });

  test("touch targets ≥44 px and no horizontal scroll at 390", async ({ page }) => {
    await openSettings(page, { link: LINKED });
    for (const el of await panel(page).locator("button, a").all()) {
      const box = await el.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const sw = await panel(page).locator("label[for=tma-dm-switch]").boundingBox();
    expect(sw?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("desktop 1440 screenshots", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  test.skip(!SHOTS, "screenshots only");

  test("every state at 1440", async ({ page }) => {
    await page.clock.install({ time: NOW });
    await openSettings(page);
    await shot(page, "1-not-linked");
    await panel(page).getByRole("button", { name: "Подключить Telegram" }).click();
    await expect(panel(page).getByTestId("tma-countdown")).toBeVisible();
    await shot(page, "2-pending");
  });

  test("linked states at 1440", async ({ page }) => {
    await openSettings(page, { link: LINKED });
    await shot(page, "4-linked");
  });

  test("linked note states at 1440", async ({ page }) => {
    await openSettings(page, { link: { ...LINKED, appUrl: "", dmNotices: false, dmError: "Forbidden: bot was blocked by the user" } });
    await shot(page, "5-linked-no-app-dm-error");
  });

  test("no bot at 1440", async ({ page }) => {
    await openSettings(page, { botToken: "" });
    await shot(page, "0-no-bot");
  });

  test("before: existing bot block (LEAD) at 1440", async ({ page }) => {
    await openSettings(page);
    await page.waitForTimeout(500);
    await page.addStyleTag({ content: ".settings-actions{position:static!important}" });
    const bot = page.locator(".settings-card", { has: page.getByRole("heading", { name: "Уведомления в Telegram" }) });
    await bot.screenshot({ path: path.join(SHOTS, "1440-lead-bot-block.png"), animations: "disabled" });
  });
});

test("before: existing bot block (LEAD) at 390", async ({ page }) => {
  test.skip(!SHOTS, "screenshots only");
  await openSettings(page);
  await page.waitForTimeout(500);
  const bot = page.locator(".settings-card", { has: page.getByRole("heading", { name: "Уведомления в Telegram" }) });
  await bot.screenshot({ path: path.join(SHOTS, "390-lead-bot-block.png"), animations: "disabled" });
});
