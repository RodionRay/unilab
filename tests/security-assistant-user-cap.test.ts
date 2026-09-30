import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestD1 } from "./helpers/d1-raw";

const db = createTestD1();
vi.mock("@/lib/server-store", () => ({ database: () => db, unseal: async () => "" }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getSessionUser: async () => ({ userId: "user-capped", email: "u@example.com" }),
}));

import { POST as assistant } from "@/app/api/assistant/route";

const AI_KEYS = ["AI_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "ASSISTANT_OPENAI_KEY"];
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of AI_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  db.raw.exec(
    "CREATE TABLE records (id text PRIMARY KEY, owner text, kind text, data text, created text, secret text)",
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 8, 30, 1, 0, 0));
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const k of AI_KEYS) if (saved[k] !== undefined) process.env[k] = saved[k];
});

function ask() {
  vi.setSystemTime(Date.now() + 21_000);
  return assistant(
    new Request("https://app.test/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Как настроить рассылку?", surface: "admin" }),
    }),
  );
}

describe("POST /api/assistant (signed-in daily cap)", () => {
  it("caps questions per user per day from ASSISTANT_USER_DAILY_LIMIT", async () => {
    vi.stubEnv("ASSISTANT_USER_DAILY_LIMIT", "3");
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await ask()).status);
    expect(statuses).toEqual([200, 200, 200, 429]);

    const blocked = await ask();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(((await blocked.json()) as { error: string }).error).toMatch(/лимит/i);
  });
});
