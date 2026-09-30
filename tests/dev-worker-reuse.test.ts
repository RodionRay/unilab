import { describe, expect, it } from "vitest";
import { workerReuseVerdict } from "../scripts/dev-worker-reuse.mjs";

describe("dev-local worker reuse", () => {
  it("reuses a live worker when all shared secrets came from config", () => {
    expect(workerReuseVerdict("ours", [])).toBe("reuse");
  });

  it("treats a live worker as stale when CRON_SECRET was generated this run", () => {
    expect(workerReuseVerdict("ours", ["CRON_SECRET"])).toBe("stale");
  });

  it("keeps stale and foreign probes as they are", () => {
    expect(workerReuseVerdict("stale", [])).toBe("stale");
    expect(workerReuseVerdict("foreign", ["CRON_SECRET"])).toBe("foreign");
  });
});
