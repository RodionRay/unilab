import { describe, expect, it } from "vitest";
import { safeRelativeReturnPath } from "@/lib/auth";
import { safeRelativeReturnPath as authPathsSafeReturn } from "@/lib/auth-paths";
import { GET as logoutGet } from "@/app/api/auth/logout/route";

const HOSTILE = [
  "/\\evil.com",
  "/\\/evil.com",
  "\\\\evil.com",
  "//evil.com",
  "https://evil.com",
  "/%5Cevil.com",
  // Dot-segment normalisation collapses these into a protocol-relative "//evil.com".
  "/.//evil.com",
  "/%2e//evil.com",
  "/%2E//evil.com",
  "/a/..//evil.com",
  "/a/%2e%2e//evil.com",
  "/./%2e/..//evil.com",
  "/.//evil.com/path?q=1#h",
];

describe("safeRelativeReturnPath", () => {
  it.each(HOSTILE)("keeps %s on-site", (value) => {
    const out = safeRelativeReturnPath(value);
    expect(out.startsWith("/")).toBe(true);
    expect(out.includes("\\")).toBe(false);
    expect(new URL(out, "https://app.test").origin).toBe("https://app.test");
  });

  it("rejects raw backslashes outright", () => {
    expect(safeRelativeReturnPath("/app\\x")).toBe("/");
  });

  it("keeps a normal relative path", () => {
    expect(safeRelativeReturnPath("/app/leads?x=1#h")).toBe("/app/leads?x=1#h");
  });
});

describe("safeRelativeReturnPath dot-segment bypass", () => {
  it.each([
    "/.//evil.com",
    "/%2e//evil.com",
    "/a/..//evil.com",
    "/a/%2e%2e//evil.com",
  ])("returns / for %s", (value) => {
    expect(safeRelativeReturnPath(value)).toBe("/");
  });

  it("still resolves harmless dot segments", () => {
    expect(safeRelativeReturnPath("/a/../app/leads")).toBe("/app/leads");
  });
});

describe("lib/auth-paths safeRelativeReturnPath", () => {
  it.each(HOSTILE)("keeps %s on-site", (value) => {
    const out = authPathsSafeReturn(value);
    expect(out.startsWith("//")).toBe(false);
    expect(new URL(out, "https://app.test").origin).toBe("https://app.test");
  });
});

describe("GET /api/auth/logout", () => {
  it.each(HOSTILE)("never redirects off-site for return_to=%s", async (value) => {
    const res = await logoutGet(
      new Request(
        `https://app.test/api/auth/logout?return_to=${encodeURIComponent(value)}`,
      ),
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") || "");
    expect(location.origin).toBe("https://app.test");
    expect(res.headers.get("set-cookie")).toMatch(/uniseller_session=;/);
  });
});
