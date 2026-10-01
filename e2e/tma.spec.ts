import { expect, test, type Page } from "@playwright/test";
import * as fx from "./fixtures/data";
import { installTelegram, mockApi, tapBackButton, tapMainButton, tgSpy, tmaUrl, type ApiCall, type ApiOptions, type TelegramOptions } from "./fixtures/tma";

async function open(page: Page, tg: TelegramOptions = {}, api: ApiOptions = {}, hash = ""): Promise<ApiCall[]> {
  await page.clock.setFixedTime(fx.NOW);
  await installTelegram(page, tg);
  const calls = await mockApi(page, api);
  await page.goto(tmaUrl(hash));
  return calls;
}

const actions = (calls: ApiCall[], name: string) => calls.filter((c) => c.path === "/api/workspace" && c.body?.action === name);

test.describe("shell", () => {
  test("boots inside Telegram: SDK lifecycle, bearer only in memory, inbox renders", async ({ page }) => {
    const calls = await open(page);
    await expect(page.getByRole("heading", { name: "Входящие" })).toBeVisible();
    await expect(page.getByTestId("inbox-row")).toHaveCount(10);

    const spy = await tgSpy(page);
    expect(spy.calls).toEqual(expect.arrayContaining(["ready", "expand", "disableVerticalSwipes"]));

    const sessionCall = calls.find((c) => c.path === "/api/tma/session");
    expect(sessionCall?.body).toEqual({ wsKey: fx.WS_KEY, initData: fx.INIT_DATA });
    const feedCalls = calls.filter((c) => c.path === "/api/tma/feed");
    expect(feedCalls.length).toBeGreaterThan(0);
    for (const c of feedCalls) expect(c.auth).toBe(`Bearer ${fx.TOKEN}`);

    const stored = await page.evaluate(() => ({
      local: JSON.stringify({ ...localStorage }),
      session: JSON.stringify({ ...sessionStorage }),
      cookie: document.cookie,
    }));
    expect(stored.local).not.toContain(fx.TOKEN);
    expect(stored.session).not.toContain(fx.TOKEN);
    expect(stored.cookie).not.toContain(fx.TOKEN);
  });

  test("skips disableVerticalSwipes below Bot API 7.7", async ({ page }) => {
    await open(page, { version: "7.0" });
    await expect(page.getByRole("heading", { name: "Входящие" })).toBeVisible();
    const spy = await tgSpy(page);
    expect(spy.calls).toContain("ready");
    expect(spy.calls).not.toContain("disableVerticalSwipes");
  });

  test("outside Telegram shows «Откройте из бота» and calls no API", async ({ page }) => {
    await page.route("https://telegram.org/js/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
    const calls = await mockApi(page);
    await page.goto(tmaUrl());
    await expect(page.getByRole("heading", { name: "Откройте из бота" })).toBeVisible();
    await page.waitForTimeout(300);
    expect(calls).toEqual([]);
  });

  test("empty initData is treated as outside Telegram", async ({ page }) => {
    const calls = await open(page, { initData: "" });
    await expect(page.getByRole("heading", { name: "Откройте из бота" })).toBeVisible();
    expect(calls).toEqual([]);
  });

  test("expired bearer → «Сессия истекла» with a close button", async ({ page }) => {
    await open(page, {}, { feed: (view) => (view === "inbox" ? { status: 401, body: { error: "Сессия истекла", code: "session_expired" } } : undefined) });
    await expect(page.getByRole("heading", { name: "Сессия истекла — откройте заново из бота" })).toBeVisible();
    await page.getByRole("button", { name: "Закрыть" }).click();
    expect((await tgSpy(page)).closed).toBe(true);
  });

  test("stale initData at exchange → same expired screen", async ({ page }) => {
    await open(page, {}, { session: { status: 401, body: { error: "expired", code: "init_data_expired" } } });
    await expect(page.getByRole("heading", { name: "Сессия истекла — откройте заново из бота" })).toBeVisible();
  });

  test("not linked → instructions + bot link through openTelegramLink", async ({ page }) => {
    await open(page, {}, { session: { status: 403, body: { error: "Не подключено", code: "not_linked", botLink: fx.BOT_LINK } } });
    await expect(page.getByRole("heading", { name: "Telegram не подключён к рабочему пространству" })).toBeVisible();
    await expect(page.getByText("Подключить Telegram")).toBeVisible();
    await page.getByRole("button", { name: "Открыть бота" }).click();
    expect((await tgSpy(page)).links).toEqual([fx.BOT_LINK]);
  });

  test("follows themeChanged: light → dark", async ({ page }) => {
    await open(page, { scheme: "light" });
    const root = page.locator(".tma-root");
    await expect(root).not.toHaveClass(/dark/);
    const bgLight = await root.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bgLight).toBe("rgb(255, 255, 255)");
    await page.evaluate(() => (window as unknown as { __tgSetScheme(s: string): void }).__tgSetScheme("dark"));
    await expect(root).toHaveClass(/dark/);
    await expect.poll(() => root.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(0, 0, 0)");
  });

  test("/tma responses may be framed by Telegram Web only; other pages stay DENY", async ({ request }) => {
    const tma = await request.get(tmaUrl());
    expect(tma.headers()["x-frame-options"]).toBeUndefined();
    expect(tma.headers()["content-security-policy"]).toBe("frame-ancestors https://web.telegram.org https://*.telegram.org");
    const login = await request.get("/login");
    expect(login.headers()["x-frame-options"]).toBe("DENY");
    expect(login.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
  });
});

test.describe("inbox", () => {
  test("filters and cursor pagination", async ({ page }) => {
    const calls = await open(page);
    await expect(page.getByTestId("inbox-row")).toHaveCount(10);
    await page.getByRole("button", { name: "Показать ещё" }).click();
    await expect(page.getByTestId("inbox-row")).toHaveCount(12);
    expect(calls.some((c) => c.path === "/api/tma/feed" && c.query.cursor === "c2")).toBe(true);
    await expect(page.getByRole("button", { name: "Показать ещё" })).toHaveCount(0);

    await page.getByRole("radio", { name: /Горячие/ }).click();
    await expect(page.getByTestId("inbox-row")).toHaveCount(3);
    expect(calls.some((c) => c.query.view === "inbox" && c.query.filter === "hot")).toBe(true);
    await expect(page.locator('[data-testid="inbox-row"][data-hot]')).toHaveCount(3);
  });

  test("empty filter offers «Показать все»", async ({ page }) => {
    await open(page, {}, { feed: (view, q) => (view === "inbox" && q.filter === "conversations" ? { status: 200, body: fx.inboxEmpty } : undefined) });
    await page.getByRole("radio", { name: "Диалоги" }).click();
    await expect(page.getByText("Диалогов пока нет")).toBeVisible();
    await page.getByRole("button", { name: "Показать все" }).click();
    await expect(page.getByTestId("inbox-row")).toHaveCount(10);
  });

  test("load error shows retry, retry recovers", async ({ page }) => {
    let fail = true;
    await open(page, {}, { feed: (view) => (view === "inbox" && fail ? { status: 500, body: { error: "База недоступна" } } : undefined) });
    await expect(page.getByText("Не удалось загрузить")).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Повторить" }).click();
    await expect(page.getByTestId("inbox-row")).toHaveCount(10);
  });

  test("offline → «Нет соединения» state", async ({ page, context }) => {
    await open(page);
    await expect(page.getByTestId("inbox-row")).toHaveCount(10);
    await context.setOffline(true);
    await expect(page.getByText("Нет соединения — показаны последние загруженные данные")).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText("Нет соединения — показаны последние загруженные данные")).toHaveCount(0);
  });
});

test.describe("lead", () => {
  test("open → mark viewed → send via MainButton (double tap = one POST) → back", async ({ page }) => {
    const calls = await open(page, {}, { delayMs: 150 });
    await page.getByTestId("inbox-row").filter({ hasText: "Анна Петрова" }).click();
    await expect(page.getByRole("heading", { name: "Анна Петрова" })).toBeVisible();
    await expect(page.getByLabel("Ответ лиду")).toHaveValue(fx.ANNA_DRAFT);

    let spy = await tgSpy(page);
    expect(spy.back.visible).toBe(true);
    expect(spy.main).toMatchObject({ visible: true, text: "Отправить", active: true, color: "#ffa92c" });
    await expect.poll(() => actions(calls, "mark_lead_viewed").length).toBe(1);
    expect(actions(calls, "mark_lead_viewed")[0]?.body?.id).toBe(fx.LEAD_ANNA);

    await tapMainButton(page, 2);
    await expect(page.getByLabel("Ответ лиду")).toHaveValue("");
    const sends = actions(calls, "send_lead_message");
    expect(sends).toHaveLength(1);
    expect(sends[0]?.body).toMatchObject({ id: fx.LEAD_ANNA, mode: "dm", text: fx.ANNA_DRAFT });
    expect(String(sends[0]?.body?.clientMsgId)).toMatch(/^tma:[0-9a-f-]{36}$/);
    expect(sends[0]?.auth).toBe(`Bearer ${fx.TOKEN}`);
    spy = await tgSpy(page);
    expect(spy.calls).toContain("main.showProgress");
    expect(spy.calls).toContain("haptic:success");
    expect(spy.main.active).toBe(false);

    await tapBackButton(page);
    await expect(page.getByRole("heading", { name: "Входящие" })).toBeVisible();
    spy = await tgSpy(page);
    expect(spy.main.visible).toBe(false);
    expect(spy.back.visible).toBe(false);
  });

  test("retry after a failed send reuses the same clientMsgId", async ({ page }) => {
    const calls = await open(page, {}, {
      action: (a, _b, nth) => (a === "send_lead_message" && nth === 1 ? { status: 503, body: { error: "Не удалось отправить сообщение. Повторите попытку." } } : undefined),
    });
    await page.getByTestId("inbox-row").filter({ hasText: "Анна Петрова" }).click();
    await expect(page.getByLabel("Ответ лиду")).toHaveValue(fx.ANNA_DRAFT);
    await tapMainButton(page);
    await expect(page.getByText("Не удалось отправить сообщение. Повторите попытку.")).toBeVisible();
    expect((await tgSpy(page)).calls).toContain("haptic:error");
    await tapMainButton(page);
    await expect(page.getByLabel("Ответ лиду")).toHaveValue("");
    const sends = actions(calls, "send_lead_message");
    expect(sends).toHaveLength(2);
    expect(sends[0]?.body?.clientMsgId).toBe(sends[1]?.body?.clientMsgId);
  });

  test("MainButton is inactive for an empty reply and when the lead can't be answered", async ({ page }) => {
    await open(page);
    await page.getByTestId("inbox-row").filter({ hasText: "Анна Петрова" }).click();
    await page.getByLabel("Ответ лиду").fill("   ");
    await expect.poll(async () => (await tgSpy(page)).main.active).toBe(false);
    await tapBackButton(page);
    await page.getByTestId("inbox-row").filter({ hasText: "Олег Кравец" }).click();
    await expect(page.getByText("Дневной лимит сообщений на всех рабочих аккаунтах исчерпан")).toBeVisible();
    await expect.poll(async () => (await tgSpy(page)).main.active).toBe(false);
    await expect(page.getByLabel("Ответ лиду")).toBeDisabled();
  });

  test("AI-черновик asks the server for a draft", async ({ page }) => {
    const calls = await open(page, {}, {
      action: (a) => (a === "draft" ? { status: 200, body: { ok: true, draft: "Мария, пришлю два кейса магазинов одежды сегодня до 18:00." } } : undefined),
    });
    await page.getByTestId("inbox-row").filter({ hasText: "Мария Лебедева" }).click();
    await expect(page.getByLabel("Ответ лиду")).toHaveValue("");
    await page.getByRole("button", { name: "AI-черновик" }).click();
    await expect(page.getByLabel("Ответ лиду")).toHaveValue("Мария, пришлю два кейса магазинов одежды сегодня до 18:00.");
    expect(actions(calls, "draft")[0]?.body).toEqual({ action: "draft", id: fx.LEAD_MARIA });
  });

  test("history shows delivery statuses and the failure reason", async ({ page }) => {
    await open(page);
    await page.getByTestId("inbox-row").filter({ hasText: "Мария Лебедева" }).click();
    await expect(page.getByTestId("bubble-failed")).toHaveCount(1);
    await expect(page.getByText("Не доставлено: Аккаунт на отлежке — отправка недоступна")).toBeVisible();
    await expect(page.getByTestId("bubble-sent")).toHaveCount(4);
  });

  test("deep link #lead=<id> opens the lead directly (REQ-M6)", async ({ page }) => {
    await open(page, {}, {}, `#lead=${fx.LEAD_MARIA}&tgWebAppVersion=8.0`);
    await expect(page.getByRole("heading", { name: "Мария Лебедева" })).toBeVisible();
    expect((await tgSpy(page)).back.visible).toBe(true);
  });

  test("start_param lead_<id> opens the lead directly", async ({ page }) => {
    await open(page, { startParam: `lead_${fx.LEAD_OLEG}` });
    await expect(page.getByRole("heading", { name: "Олег Кравец" })).toBeVisible();
  });
});

test.describe("accounts and tasks", () => {
  test("accounts: problems first, «Проверить» calls check_account and reloads", async ({ page }) => {
    const calls = await open(page);
    await page.getByRole("button", { name: /Аккаунты/ }).click();
    const sections = page.locator("[data-screen=accounts] section h2");
    await expect(sections.first()).toHaveText("Требуют внимания");
    const before = calls.filter((c) => c.query.view === "accounts").length;
    const row = page.getByTestId("account-row").filter({ hasText: "Ольга | маркетинг" });
    await expect(row.getByText("Telegram ограничил сообщения незнакомым")).toBeVisible();
    await row.getByRole("button", { name: "Проверить" }).click();
    await expect.poll(() => actions(calls, "check_account").length).toBe(1);
    expect(actions(calls, "check_account")[0]?.body).toEqual({ action: "check_account", id: "11111111-aaaa-4bbb-8ccc-000000000002" });
    await expect.poll(() => calls.filter((c) => c.query.view === "accounts").length).toBe(before + 1);
  });

  test("tasks: pause asks showConfirm; «Отмена» sends nothing", async ({ page }) => {
    const calls = await open(page, { confirmAnswer: false });
    await page.getByRole("button", { name: /Задачи/ }).click();
    const row = page.getByTestId("task-row").filter({ hasText: "Осенняя рассылка" });
    await expect(row.getByText("120 из 400 сообщений")).toBeVisible();
    await row.getByRole("button", { name: "Пауза" }).click();
    await expect.poll(async () => (await tgSpy(page)).confirms.length).toBe(1);
    await page.waitForTimeout(200);
    expect(actions(calls, "pause_mailing")).toHaveLength(0);
  });

  test("tasks: confirmed pause posts pause_mailing", async ({ page }) => {
    const calls = await open(page, { confirmAnswer: true });
    await page.getByRole("button", { name: /Задачи/ }).click();
    const row = page.getByTestId("task-row").filter({ hasText: "Осенняя рассылка" });
    await row.getByRole("button", { name: "Пауза" }).click();
    await expect.poll(() => actions(calls, "pause_mailing").length).toBe(1);
    expect(actions(calls, "pause_mailing")[0]?.body).toEqual({ action: "pause_mailing", id: fx.TASK_MAILING });
    expect((await tgSpy(page)).confirms[0]).toContain("Осенняя рассылка — онлайн-школы");
  });

  test("overview: numbers + tap-through to tabs; badges on the tab bar", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /Сводка/ }).click();
    await expect(page.getByText("24", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Аккаунты/ }).getByLabel("проблем: 3")).toBeVisible();
    await expect(page.getByRole("button", { name: /Входящие/ }).getByLabel("непрочитанных: 4")).toBeVisible();
    await page.getByRole("button", { name: /6 аккаунтов/ }).click();
    await expect(page.getByRole("heading", { name: "Аккаунты" })).toBeVisible();
  });
});

for (const width of [360, 390, 430]) {
  test(`no horizontal scroll at ${width}px on every screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page);
    const noOverflow = async () => {
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(o.sw).toBeLessThanOrEqual(o.cw);
    };
    await expect(page.getByTestId("inbox-row").first()).toBeVisible();
    await noOverflow();
    for (const tab of ["Аккаунты", "Задачи", "Сводка"]) {
      await page.getByRole("button", { name: new RegExp(tab) }).click();
      await expect(page.getByRole("heading", { name: tab })).toBeVisible();
      await noOverflow();
    }
    await page.getByRole("button", { name: /Входящие/ }).click();
    await page.getByTestId("inbox-row").filter({ hasText: "Мария Лебедева" }).click();
    await expect(page.getByRole("heading", { name: "Мария Лебедева" })).toBeVisible();
    await noOverflow();
  });
}
