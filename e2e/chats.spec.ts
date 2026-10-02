import { expect, test, type Page } from "@playwright/test";

/**
 * «Переписки» journey (spec docs/project/specs/tg-chat-ui.md, REQ-1/5/7/8/10/12).
 * Needs the synthetic seed (scripts/seed-demo-chats.mjs) in the target cabinet: at least one unread chat.
 * No Telegram worker runs in e2e, so the network edge is mocked: the worker flag in GET /api/workspace,
 * send_lead_message (same success shape as app/api/workspace/route.ts) and mark_lead_viewed (keeps the seed unread
 * for the next run). Everything else hits the real server.
 */
const EMAIL = process.env.E2E_EMAIL || "admin@uniseller.local";
const PASSWORD = process.env.E2E_PASSWORD || "demo-pass-123";

type Reply = Record<string, unknown> & { text: string; from: string; at: string };
type Lead = { id: string; kind: string; data: Record<string, unknown> & { replies?: Reply[] } };

async function login(page: Page, baseURL: string) {
  const res = await page.request.post("/api/auth/login", { data: { email: EMAIL, password: PASSWORD }, headers: { origin: baseURL } });
  expect(res.ok(), `login ${res.status()}`).toBeTruthy();
}

type EdgeOptions = {
  /** Worker flag in GET /api/workspace (false = «Telegram не подключён»). */
  connected?: boolean;
  /** Pretend the signed-in user is a staff viewer (read-only role). */
  viewer?: boolean;
  /** Delay before the send answers, to observe the pending clock. */
  sendDelayMs?: number;
  /** Telegram error for the first send (the next one succeeds). */
  failFirstWith?: string;
};

/** Mocks the Telegram edge; returns the captured send / mark-viewed requests. */
async function mockTelegramEdge(page: Page, opts: EdgeOptions = {}) {
  const sent: { id: string; text: string; mode: string; reply: Reply }[] = [];
  const markViewed: string[] = [];
  let records: Lead[] = [];
  let failNext = opts.failFirstWith ?? "";
  await page.route("**/api/workspace", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      const res = await route.fetch();
      const body = (await res.json()) as { records?: Lead[]; telegramConnected?: boolean; workspace?: Record<string, unknown> };
      // the server keeps sent (and failed) messages: replay them on refresh like the real send handler would
      for (const s of sent) {
        const lead = body.records?.find((r) => r.id === s.id);
        if (lead) lead.data = { ...lead.data, replies: [...(lead.data.replies || []), s.reply], conversationOpen: true };
      }
      records = body.records || [];
      const workspace = opts.viewer
        ? { ...(body.workspace || {}), isOwner: false, role: "viewer", ownerId: "e2e-owner", access: { overview: true, notifications: true, leads: true, chats: true } }
        : body.workspace;
      return route.fulfill({ response: res, json: { ...body, workspace, telegramConnected: opts.connected ?? true } });
    }
    const payload = (req.postDataJSON() || {}) as Record<string, unknown>;
    if (payload.action === "mark_lead_viewed") {
      markViewed.push(String(payload.id));
      return route.fulfill({ json: { ok: true } });
    }
    if (payload.action === "send_lead_message") {
      if (opts.sendDelayMs) await new Promise((r) => setTimeout(r, opts.sendDelayMs));
      const id = String(payload.id);
      const error = failNext;
      failNext = "";
      const reply: Reply = {
        text: String(payload.text), mode: String(payload.mode), at: new Date().toISOString(), ok: !error, error,
        messageId: error ? "" : "9001", link: "", chatId: "", from: "us", status: error ? "failed" : "sent",
        sendKey: String(payload.clientMsgId || ""),
      };
      sent.push({ id, text: reply.text, mode: String(payload.mode), reply });
      const current = records.find((x) => x.id === id)?.data;
      const lead = { ...(current || {}), replies: [...(current?.replies || []), reply], conversationOpen: true, draft: reply.text };
      // same shapes as app/api/workspace/route.ts send_lead_message (success / Telegram failure)
      if (error) return route.fulfill({ status: 502, json: { ok: false, error, busy: false, lead, rotatedAccount: false } });
      return route.fulfill({ json: { ok: true, lead, mode: payload.mode, link: "", messageId: "9001", rotatedAccount: false, accountId: String(current?.accountId || "") } });
    }
    // other worker-bound actions (inbox polling, auto-rescan) answer like an offline worker
    if (payload.action && payload.action !== "save" && payload.action !== "draft") {
      return route.fulfill({ status: 503, json: { error: "e2e: Telegram worker offline" } });
    }
    return route.continue();
  });
  return Object.assign(sent, { markViewed });
}

async function openChats(page: Page, baseURL: string, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await login(page, baseURL);
}

test.describe("Переписки", () => {
  test("desktop: open unread chat → divider → Shift+Enter newline → Enter sends → bubble appears", async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, baseURL!);
    const sent = await mockTelegramEdge(page);
    await page.goto("/app?view=chats");

    const unread = page.locator("[data-chat-item][data-unread]").first();
    await expect(unread, "seed an unread chat: scripts/seed-demo-chats.mjs").toBeVisible();
    await unread.click();

    await expect(page.locator("[data-chat-thread]")).toBeVisible();
    await expect(page.locator("[data-unread-divider]")).toBeVisible();
    await expect(page.locator("[data-unread-divider]")).toHaveText("Непрочитанные сообщения");

    const composer = page.locator("[data-chat-composer]");
    await composer.fill("");
    await composer.pressSequentially("Строка один");
    await composer.press("Shift+Enter");
    await composer.pressSequentially("Строка два");
    await expect(composer).toHaveValue("Строка один\nСтрока два");
    expect(sent).toHaveLength(0);

    await composer.press("Enter");
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ text: "Строка один\nСтрока два", mode: "dm" });

    const bubble = page.locator('[data-chat-msg][data-side="out"]', { hasText: "Строка два" });
    await expect(bubble).toBeVisible();
    await expect(bubble).toHaveAttribute("data-status", "sent");
    await expect(composer).toHaveValue("");
  });

  test("mobile 390: list → chat full screen → back to list", async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, baseURL!);
    await mockTelegramEdge(page);
    await page.goto("/app?view=chats");

    const first = page.locator("[data-chat-item]").first();
    await expect(first).toBeVisible();
    await first.click();

    await expect(page.locator("[data-chat-thread]")).toBeVisible();
    await expect(page.locator("[data-chat-item]").first()).toBeHidden();
    const back = page.locator("[data-chat-back]");
    await expect(back).toBeVisible();
    await back.click();

    await expect(page.locator("[data-chat-thread]")).toHaveCount(0);
    await expect(page.locator("[data-chat-item]").first()).toBeVisible();
    // focus returns to the row that was opened; Esc also closes the full-screen chat
    // (an opened «Новые» chat moves to «Просмотренные», so focus lands on the row now in its slot)
    await expect(page.locator("[data-chat-item]:focus")).toHaveCount(1);
    await page.locator("[data-chat-item]:focus").click();
    await expect(page.locator(".chat-header-name")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-chat-thread]")).toHaveCount(0);
  });

  test("pending: the clock tick shows while Telegram answers, then ✓", async ({ page, baseURL }) => {
    await openChats(page, baseURL!);
    const sent = await mockTelegramEdge(page, { sendDelayMs: 1500 });
    await page.goto("/app?view=chats");
    await page.locator("[data-chat-item]").first().click();

    const composer = page.locator("[data-chat-composer]");
    await composer.fill("Проверка часов");
    await composer.press("Enter");

    const bubble = page.locator('[data-chat-msg][data-side="out"]', { hasText: "Проверка часов" });
    await expect(bubble).toHaveAttribute("data-status", "pending");
    await expect(page.locator("[data-chat-send]")).toBeDisabled();
    await expect(bubble).toHaveAttribute("data-status", "sent");
    await expect(bubble).toHaveCount(1);
    expect(sent).toHaveLength(1);
  });

  test("failed: plain-language reason, «Повторить» resends the same text and mode", async ({ page, baseURL }) => {
    await openChats(page, baseURL!);
    const sent = await mockTelegramEdge(page, { failFirstWith: "PEER_FLOOD" });
    await page.goto("/app?view=chats");
    await page.locator("[data-chat-item]").first().click();

    const composer = page.locator("[data-chat-composer]");
    await composer.fill("Повтор после ошибки");
    await composer.press("Enter");

    const failed = page.locator('[data-chat-msg][data-status="failed"]', { hasText: "Повтор после ошибки" });
    await expect(failed).toBeVisible();
    await expect(failed).toContainText("Telegram временно ограничил этот аккаунт");
    await expect(failed).not.toContainText("PEER_FLOOD");

    await composer.fill("");
    await failed.locator("[data-chat-retry]").click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toMatchObject({ text: "Повтор после ошибки", mode: sent[0]!.mode });
    await expect(page.locator('[data-chat-msg][data-status="sent"]', { hasText: "Повтор после ошибки" })).toBeVisible();
  });

  test("Telegram not connected: send and AI disabled, notice links to accounts", async ({ page, baseURL }) => {
    await openChats(page, baseURL!);
    const sent = await mockTelegramEdge(page, { connected: false });
    await page.goto("/app?view=chats");
    await page.locator("[data-chat-item]").first().click();

    await expect(page.getByText("Telegram не подключён.")).toBeVisible();
    await page.locator("[data-chat-composer]").fill("Не уйдёт");
    await expect(page.locator("[data-chat-send]")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Черновик AI" })).toBeDisabled();
    await page.locator("[data-chat-composer]").press("Enter");
    expect(sent).toHaveLength(0);
    await page.getByRole("button", { name: "Настроить аккаунты" }).last().click();
    await expect(page.locator("[data-chats-panel]")).toHaveCount(0);
  });

  test("viewer: read-only composer, no mark-viewed request", async ({ page, baseURL }) => {
    await openChats(page, baseURL!);
    const sent = await mockTelegramEdge(page, { viewer: true });
    await page.goto("/app?view=chats");
    await page.locator("[data-chat-item]").first().click();

    await expect(page.getByText("Режим наблюдателя: читать можно, отправка недоступна.")).toBeVisible();
    await expect(page.locator("[data-chat-composer]")).toBeDisabled();
    await expect(page.locator("[data-chat-send]")).toBeDisabled();
    expect(sent.markViewed).toHaveLength(0);
  });
});
