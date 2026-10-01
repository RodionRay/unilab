import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/users", () => ({ listUserIdsForCron: async () => [] }));

import { POST } from "@/app/api/cron/auto-rescan/route";

const GOOD = "c".repeat(40);
const ENV_KEYS = ["CRON_SECRET", "SESSION_SECRET", "TG_WORKER_TOKEN", "ADMIN_EMAIL", "APP_URL"];
const saved: Record<string, string | undefined> = {};

async function misconfigured(res: Response) {
  const body = (await res.json()) as { error?: string };
  return res.status === 503 && body.error !== "Нет пользователей для обхода";
}

function call(auth?: string, url = "https://app.test/api/cron/auto-rescan") {
  return POST(
    new Request(url, {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
    }),
  );
}

describe("cron auto-rescan auth", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns 503 when CRON_SECRET is missing, even if other secrets exist", async () => {
    process.env.SESSION_SECRET = "s".repeat(40);
    process.env.TG_WORKER_TOKEN = "t".repeat(40);
    expect(await misconfigured(await call(`Bearer ${"s".repeat(40)}`))).toBe(true);
    expect(await misconfigured(await call(`Bearer ${"t".repeat(40)}`))).toBe(true);
  });

  it("returns 503 when CRON_SECRET is shorter than 32 chars", async () => {
    process.env.CRON_SECRET = "short-secret";
    expect(await misconfigured(await call("Bearer short-secret"))).toBe(true);
  });

  it("returns 401 without or with a wrong bearer", async () => {
    process.env.CRON_SECRET = GOOD;
    expect((await call()).status).toBe(401);
    expect((await call(`Bearer ${"x".repeat(40)}`)).status).toBe(401);
    expect((await call(`Bearer ${GOOD}x`)).status).toBe(401);
  });

  it("passes auth with the right bearer", async () => {
    process.env.CRON_SECRET = GOOD;
    const res = await call(`Bearer ${GOOD}`);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Нет пользователей для обхода");
  });

  it("calls APP_URL, never the origin from the request Host header", async () => {
    process.env.CRON_SECRET = GOOD;
    process.env.SESSION_SECRET = "s".repeat(40);
    process.env.ADMIN_EMAIL = "admin@example.com";
    process.env.APP_URL = "http://127.0.0.1:5173";
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return Response.json({ ok: true, data: [] });
    }));
    try {
      await call(`Bearer ${GOOD}`, "https://evil.test/api/cron/auto-rescan");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(new URL(u).origin).toBe("http://127.0.0.1:5173");
  });
});
