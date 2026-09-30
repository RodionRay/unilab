import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

describe("next.config security headers", () => {
  it("applies baseline security headers to every path", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(rules.map((r) => r.source)).toEqual(["/", "/:path*"]);
    const all = rules.find((r) => r.source === "/:path*");
    const byKey = Object.fromEntries((all?.headers ?? []).map((h) => [h.key, h.value]));
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(byKey["Strict-Transport-Security"]).toMatch(/^max-age=\d{7,}/);
    expect(byKey["Permissions-Policy"]).toContain("camera=()");
  });
});
