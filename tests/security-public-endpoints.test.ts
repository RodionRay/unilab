import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestD1 } from "./helpers/d1-raw";

const db = createTestD1();
vi.mock("@/lib/server-store", () => ({ database: () => db, unseal: async () => "" }));

import { POST as contact } from "@/app/api/contact/route";
import { POST as assistant } from "@/app/api/assistant/route";

const AI_KEYS = ["AI_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "ASSISTANT_OPENAI_KEY", "CONTACT_BOT_TOKEN"];
const saved: Record<string, string | undefined> = {};
const T0 = Date.UTC(2026, 8, 30, 1, 0, 0);

beforeAll(() => {
  for (const k of AI_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  db.raw.exec(
    "CREATE TABLE records (id text PRIMARY KEY, owner text, kind text, data text, created text, secret text)",
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterAll(() => {
  vi.useRealTimers();
  for (const k of AI_KEYS) if (saved[k] !== undefined) process.env[k] = saved[k];
});

async function globalCount(): Promise<number> {
  const row = await db
    .prepare("SELECT count FROM rate_limits WHERE key LIKE 'assistant-anon-global:%'")
    .bind()
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

function ask(headers: Record<string, string>) {
  return assistant(
    new Request("https://app.test/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ message: "Что такое UniLab?", surface: "site" }),
    }),
  );
}

describe("POST /api/contact rate limit", () => {
  it("allows 5 messages per IP per hour, then 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await contact(
        new Request("https://app.test/api/contact", {
          method: "POST",
          headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.20" },
          body: JSON.stringify({
            name: "Ivan",
            email: "ivan@example.com",
            message: "Нужна помощь с настройкой",
          }),
        }),
      );
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

describe("POST /api/assistant (public widget)", () => {
  it("without a trusted IP uses only the global quota, not a shared cooldown", async () => {
    const before = await globalCount();
    expect((await ask({ "x-forwarded-for": "192.0.2.1" })).status).toBe(200);
    expect((await ask({ "x-forwarded-for": "192.0.2.2" })).status).toBe(200);
    expect(await globalCount()).toBe(before + 2);
    const guards = await db
      .prepare("SELECT count(*) AS n FROM records WHERE id LIKE 'assistant-guard:ip:%'")
      .bind()
      .first<{ n: number }>();
    expect(Number(guards?.n)).toBe(0);
  });

  it("caps anonymous questions per IP per day", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      vi.setSystemTime(Date.now() + 21_000);
      statuses.push((await ask({ "cf-connecting-ip": "203.0.113.30" })).status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it("a blocked IP neither drains the global quota nor skips the cooldown", async () => {
    const before = await globalCount();
    vi.setSystemTime(Date.now() + 21_000);
    expect((await ask({ "cf-connecting-ip": "203.0.113.30" })).status).toBe(429);
    const again = await ask({ "cf-connecting-ip": "203.0.113.30" });
    expect(again.status).toBe(429);
    expect(((await again.json()) as { error: string }).error).toMatch(/Подождите/);
    expect(await globalCount()).toBe(before);
  });

  it("caps anonymous questions globally per day", async () => {
    let last = 0;
    for (let i = 0; i < 520 && last !== 429; i++) {
      vi.setSystemTime(Date.now() + 21_000);
      last = (await ask({ "cf-connecting-ip": `198.51.100.${i % 25}` })).status;
    }
    expect(last).toBe(429);
    expect((await ask({ "cf-connecting-ip": "192.0.2.200" })).status).toBe(429);
  });
});
