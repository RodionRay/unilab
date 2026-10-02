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

/** Mocks the Telegram edge; returns the captured send requests. */
async function mockTelegramEdge(page: Page) {
  const sent: { id: string; text: string; mode: string; reply: Reply }[] = [];
  let records: Lead[] = [];
  await page.route("**/api/workspace", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      const res = await route.fetch();
      const body = (await res.json()) as { records?: Lead[]; telegramConnected?: boolean };
      // the server keeps sent messages: replay them on refresh like the real send handler would
      for (const s of sent) {
        const lead = body.records?.find((r) => r.id === s.id);
        if (lead) lead.data = { ...lead.data, replies: [...(lead.data.replies || []), s.reply], conversationOpen: true };
      }
      records = body.records || [];
      return route.fulfill({ response: res, json: { ...body, telegramConnected: true } });
    }
    const payload = (req.postDataJSON() || {}) as Record<string, unknown>;
    if (payload.action === "mark_lead_viewed") return route.fulfill({ json: { ok: true } });
    if (payload.action === "send_lead_message") {
      const id = String(payload.id);
      const reply: Reply = {
        text: String(payload.text), mode: String(payload.mode), at: new Date().toISOString(), ok: true, error: "",
        messageId: "9001", link: "", chatId: "", from: "us", status: "sent", sendKey: String(payload.clientMsgId || ""),
      };
      sent.push({ id, text: reply.text, mode: String(payload.mode), reply });
      const current = records.find((x) => x.id === id)?.data;
      const lead = { ...(current || {}), replies: [...(current?.replies || []), reply], conversationOpen: true, draft: reply.text };
      return route.fulfill({ json: { ok: true, lead, mode: payload.mode, link: "", messageId: "9001", rotatedAccount: false, accountId: String(current?.accountId || "") } });
    }
    // other worker-bound actions (inbox polling, auto-rescan) answer like an offline worker
    if (payload.action && payload.action !== "save" && payload.action !== "draft") {
      return route.fulfill({ status: 503, json: { error: "e2e: Telegram worker offline" } });
    }
    return route.continue();
  });
  return sent;
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
  });
});
