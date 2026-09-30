import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/users", () => ({
  listUserIdsForCron: async () => [{ userId: "u1", email: "u1@example.com", name: "U1" }],
}));

import { POST } from "@/app/api/cron/auto-rescan/route";

const SECRET = "c".repeat(40);
const ITEMS = Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, name: `Группа ${i}` }));

type JoinAnswer = (id: string) => { status: number; body: Record<string, unknown> };

/** Fake /api/workspace behind the cron: records join concurrency and the rescan summary. */
function stubWorkspace(answer: JoinAnswer) {
  const state = { inflight: 0, maxInflight: 0, joins: [] as string[], summary: "" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init || init.method !== "POST") {
        return Response.json({ records: [{ kind: "settings", data: {} }] });
      }
      const body = JSON.parse(String(init.body || "{}"));
      if (body.action === "rescan_groups") {
        return Response.json({
          ok: true,
          groupIds: [],
          total: 0,
          rejoinItems: ITEMS,
          joinStats: { joinsToday: 7, capToday: 120, readyNow: 5, auto: 6, review: 3, skip: 40 },
        });
      }
      if (body.action === "join_group") {
        state.joins.push(body.id);
        state.inflight++;
        state.maxInflight = Math.max(state.maxInflight, state.inflight);
        await new Promise((r) => setTimeout(r, 25));
        state.inflight--;
        const a = answer(body.id);
        return Response.json(a.body, { status: a.status });
      }
      if (body.action === "mark_auto_rescan") state.summary = String(body.summary || "");
      return Response.json({ ok: true });
    }),
  );
  return state;
}

function tick() {
  return POST(
    new Request("https://app.test/api/cron/auto-rescan", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    }),
  );
}

describe("cron auto-rescan: parallel joins", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("SESSION_SECRET", "s".repeat(40));
    vi.stubEnv("ADMIN_EMAIL", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("joins several groups at once (one per account), in the server's priority order", async () => {
    const s = stubWorkspace(() => ({ status: 200, body: { ok: true } }));

    const data = (await (await tick()).json()) as { joined: number };

    expect(s.maxInflight).toBeGreaterThan(1);
    expect(s.maxInflight).toBeLessThanOrEqual(4);
    expect(s.joins.slice(0, 4).sort()).toEqual(["g0", "g1", "g2", "g3"]);
    expect(data.joined).toBe(6);
  });

  it("stops launching joins when the farm is exhausted or everybody is paced", async () => {
    const s = stubWorkspace(() => ({ status: 429, body: { error: "лимит", farmExhausted: true, limitReached: true } }));

    await tick();

    expect(s.joins.length).toBeLessThanOrEqual(4);
  });

  it("keeps going after a per-account FloodWait (another account takes the next group)", async () => {
    const s = stubWorkspace((id) =>
      id === "g0"
        ? { status: 429, body: { error: "FloodWait 50с", flood: true, pace: true, retryOther: true, waitSec: 30 } }
        : { status: 200, body: { ok: true } },
    );

    await tick();

    expect(s.joins).toHaveLength(6);
  });

  it("logs throughput: joins today against the farm cap and the parked queue", async () => {
    const s = stubWorkspace(() => ({ status: 200, body: { ok: true } }));

    await tick();

    expect(s.summary).toMatch(/за сутки 7\/120/);
    expect(s.summary).toMatch(/на подтверждении 3/);
  });
});
