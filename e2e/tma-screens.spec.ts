/**
 * Screenshot capture for design rounds (not a pixel diff): every screen at 360/390/430 × light/dark,
 * plus the states at 390. Output: TMA_SHOTS_DIR (default .sites-runtime/tma-shots).
 */
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import * as fx from "./fixtures/data";
import { installTelegram, mockApi, tmaUrl, type ApiOptions, type Scheme, type TelegramOptions } from "./fixtures/tma";

const OUT = process.env.TMA_SHOTS_DIR ?? path.join(process.cwd(), ".sites-runtime/tma-shots");
const HEIGHT = 844;

async function boot(page: Page, width: number, tg: TelegramOptions, api: ApiOptions = {}, hash = "") {
  await page.setViewportSize({ width, height: HEIGHT });
  await page.clock.setFixedTime(fx.NOW);
  await installTelegram(page, tg);
  await mockApi(page, api);
  await page.goto(tmaUrl(hash));
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

for (const width of [360, 390, 430]) {
  for (const scheme of ["light", "dark"] as Scheme[]) {
    test(`screens ${width} ${scheme}`, async ({ page }) => {
      const p = `${width}-${scheme}`;
      await boot(page, width, { scheme });
      await expect(page.getByTestId("inbox-row").first()).toBeVisible();
      await shot(page, `${p}-inbox`);

      await page.getByTestId("inbox-row").filter({ hasText: "Анна Петрова" }).click();
      await expect(page.getByRole("heading", { name: "Анна Петрова" })).toBeVisible();
      await shot(page, `${p}-lead-new`);
      await page.evaluate(() => (window as unknown as { __tgBackTap(): void }).__tgBackTap());

      await page.getByTestId("inbox-row").filter({ hasText: "Мария Лебедева" }).click();
      await expect(page.getByTestId("bubble-failed")).toBeVisible();
      await shot(page, `${p}-lead-conversation`);
      await page.evaluate(() => (window as unknown as { __tgBackTap(): void }).__tgBackTap());

      for (const [tab, name] of [
        ["Аккаунты", "accounts"],
        ["Задачи", "tasks"],
        ["Сводка", "overview"],
      ] as const) {
        await page.getByRole("button", { name: new RegExp(tab) }).click();
        await expect(page.getByRole("heading", { name: tab })).toBeVisible();
        await page.waitForTimeout(100);
        await shot(page, `${p}-${name}`);
      }
    });
  }
}

test.describe("states 390", () => {
  for (const scheme of ["light", "dark"] as Scheme[]) {
    test(`states ${scheme}`, async ({ page }) => {
      const p = `390-${scheme}`;
      await boot(page, 390, { scheme }, { feed: (view) => (view === "inbox" ? { status: 200, body: fx.inboxEmpty } : undefined) });
      await expect(page.getByText("Новых лидов нет")).toBeVisible();
      await shot(page, `${p}-state-empty`);

      await page.getByRole("button", { name: /Задачи/ }).click();
      await expect(page.getByRole("heading", { name: "Задачи" })).toBeVisible();
    });

    test(`state loading ${scheme}`, async ({ page }) => {
      await boot(page, 390, { scheme }, { delayMs: 4000 });
      await page.waitForTimeout(400);
      await shot(page, `390-${scheme}-state-loading`);
    });

    test(`state error ${scheme}`, async ({ page }) => {
      await boot(page, 390, { scheme }, { feed: (view) => (view === "inbox" ? { status: 500, body: { error: "Сервер не ответил вовремя. Повторите через минуту." } } : undefined) });
      await expect(page.getByText("Не удалось загрузить")).toBeVisible();
      await shot(page, `390-${scheme}-state-error`);
    });

    test(`state blocked lead ${scheme}`, async ({ page }) => {
      await boot(page, 390, { scheme, startParam: `lead_${fx.LEAD_OLEG}` });
      await expect(page.getByRole("heading", { name: "Олег Кравец" })).toBeVisible();
      await shot(page, `390-${scheme}-state-lead-blocked`);
    });

    test(`gates ${scheme}`, async ({ page }) => {
      await boot(page, 390, { scheme, initData: "" });
      await expect(page.getByRole("heading", { name: "Откройте из бота" })).toBeVisible();
      await shot(page, `390-${scheme}-gate-outside`);
    });

    test(`gate expired ${scheme}`, async ({ page }) => {
      await boot(page, 390, { scheme }, { session: { status: 401, body: { error: "expired", code: "init_data_expired" } } });
      await expect(page.getByRole("heading", { name: /Сессия истекла/ })).toBeVisible();
      await shot(page, `390-${scheme}-gate-expired`);
    });

    test(`gate not linked ${scheme}`, async ({ page }) => {
      await boot(page, 390, { scheme }, { session: { status: 403, body: { error: "Не подключено", code: "not_linked", botLink: fx.BOT_LINK } } });
      await expect(page.getByRole("heading", { name: /не подключён/ })).toBeVisible();
      await shot(page, `390-${scheme}-gate-not-linked`);
    });
  }
});
