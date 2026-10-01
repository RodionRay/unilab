import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";
import { SECURITY_HEADERS, TMA_FRAME_ANCESTORS } from "@/lib/security/headers";
// vinext does not export its matcher publicly; this is the exact function the server runs on every response.
import { matchHeaders } from "../node_modules/vinext/dist/config/config-matchers.js";

type Header = { key: string; value: string };

async function headersFor(pathname: string): Promise<Header[]> {
  const rules = ((await nextConfig.headers?.()) ?? []).map((r) => ({ source: r.source, headers: r.headers }));
  const ctx = { headers: new Headers(), cookies: {}, query: new URLSearchParams(), host: "localhost" };
  return matchHeaders(pathname, rules, ctx) as Header[];
}

function valuesOf(headers: Header[], key: string): string[] {
  return headers.filter((h) => h.key.toLowerCase() === key.toLowerCase()).map((h) => h.value);
}

describe("security headers: Telegram Mini App exception", () => {
  it.each(["/tma/AbCdEfGhIjKlMnOp1234", "/tma/AbCdEfGhIjKlMnOp1234/", "/tma"])(
    "lets Telegram Web frame %s and sends no X-Frame-Options",
    async (path) => {
      const headers = await headersFor(path);
      expect(valuesOf(headers, "X-Frame-Options")).toEqual([]);
      expect(valuesOf(headers, "Content-Security-Policy")).toEqual([TMA_FRAME_ANCESTORS]);
      expect(TMA_FRAME_ANCESTORS).toBe("frame-ancestors https://web.telegram.org https://*.telegram.org");
      expect(valuesOf(headers, "X-Content-Type-Options")).toEqual(["nosniff"]);
      expect(valuesOf(headers, "Strict-Transport-Security")).toHaveLength(1);
    },
  );

  it.each([
    "/",
    "/app",
    "/app/settings",
    "/api/workspace",
    "/api/tma/session",
    "/api/tma/feed",
    "/login",
    "/t",
    "/tm",
    "/tmax",
    "/tmabc/x",
    "/x/tma/y",
    "/TMAX",
  ])("keeps exactly SECURITY_HEADERS on %s", async (path) => {
    const headers = await headersFor(path);
    expect(headers).toEqual([...SECURITY_HEADERS]);
    expect(valuesOf(headers, "X-Frame-Options")).toEqual(["DENY"]);
    expect(valuesOf(headers, "Content-Security-Policy")).toEqual(["frame-ancestors 'none'"]);
  });
});
