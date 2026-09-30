import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestD1 } from "./helpers/d1-raw";

const db = createTestD1();
vi.mock("@/lib/server-store", () => ({ database: () => db }));

import { TELEGRAM_AUTH_MAX_AGE_SEC, verifyTelegramAuth } from "@/lib/oauth";
import { GET as providersGet } from "@/app/api/auth/providers/route";
import { GET as telegramGet } from "@/app/api/auth/telegram/route";

const BOT_TOKEN = "123456:TEST-bot-token";
const ENV = {
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  TELEGRAM_BOT_USERNAME: "unilab_test_bot",
  SESSION_SECRET: "s".repeat(48),
};
const saved: Record<string, string | undefined> = {};

function signed(fields: Record<string, string>): Record<string, string> {
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = createHash("sha256").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return { ...fields, hash };
}

function widgetPayload(ageSec: number) {
  return signed({
    id: "777",
    first_name: "Ivan",
    username: "ivan",
    auth_date: String(Math.floor(Date.now() / 1000) - ageSec),
  });
}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterEach(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("verifyTelegramAuth", () => {
  it("accepts a fresh, correctly signed payload", async () => {
    await expect(verifyTelegramAuth(widgetPayload(10))).resolves.toEqual({
      id: "777",
      name: "Ivan",
    });
  });

  it("uses a 5 minute replay window", async () => {
    expect(TELEGRAM_AUTH_MAX_AGE_SEC).toBe(300);
    await expect(verifyTelegramAuth(widgetPayload(240))).resolves.toBeTruthy();
    await expect(verifyTelegramAuth(widgetPayload(360))).rejects.toThrow(/устарела/);
  });

  it("rejects auth_date far in the future", async () => {
    await expect(verifyTelegramAuth(widgetPayload(-600))).rejects.toThrow();
  });

  it("rejects a tampered payload", async () => {
    const data = { ...widgetPayload(10), id: "1" };
    await expect(verifyTelegramAuth(data)).rejects.toThrow(/подпись/);
  });
});

async function stateFromProviders() {
  const res = await providersGet(new Request("https://app.test/api/auth/providers"));
  const body = (await res.json()) as { telegramState?: string };
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0] || "";
  return { state: body.telegramState || "", cookie };
}

function callback(params: Record<string, string>, cookie?: string) {
  const qs = new URLSearchParams(params).toString();
  return telegramGet(
    new Request(`https://app.test/api/auth/telegram?${qs}`, {
      headers: cookie ? { cookie } : {},
    }),
  );
}

describe("GET /api/auth/telegram state binding", () => {
  it("rejects a bare signed payload with no state at all", async () => {
    const res = await callback(widgetPayload(5));
    expect(res.headers.get("location")).toContain("/login?error=");
  });

  it("rejects a valid Telegram payload without the state cookie (login CSRF)", async () => {
    const { state } = await stateFromProviders();
    const res = await callback({ ...widgetPayload(5), state, return_to: "/app" });
    expect(res.headers.get("location")).toContain("/login?error=");
    expect(res.headers.get("set-cookie") || "").not.toContain("uniseller_session=ey");
  });

  it("rejects a state that does not match the cookie", async () => {
    const { cookie } = await stateFromProviders();
    const res = await callback({ ...widgetPayload(5), state: "forged" }, cookie);
    expect(res.headers.get("location")).toContain("/login?error=");
  });

  it("logs in when state matches the cookie set by the login page", async () => {
    const { state, cookie } = await stateFromProviders();
    expect(state).not.toBe("");
    const res = await callback(
      { ...widgetPayload(5), state, return_to: "/app/leads" },
      cookie,
    );
    expect(res.headers.get("location")).toBe("https://app.test/app/leads");
    expect(res.headers.get("set-cookie")).toMatch(/uniseller_session=[^;]+\./);
  });
});
