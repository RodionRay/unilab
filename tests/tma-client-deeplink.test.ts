import { describe, expect, it } from "vitest";
import { deepLinkLeadId } from "@/lib/tma/client";

const ID = "3f2a9c1e-7b4d-4e8a-9c3b-1d2e3f4a5b6c";

describe("REQ-M6 · deepLinkLeadId", () => {
  it("reads ?lead= from the query (bot notice links) even when Telegram fills the hash", () => {
    expect(deepLinkLeadId("#tgWebAppData=user%3D1&tgWebAppVersion=8.0", undefined, `?lead=${ID}`)).toBe(ID);
  });
  it("keeps #lead= and start_param lead_<id> working", () => {
    expect(deepLinkLeadId(`#lead=${ID}`, undefined)).toBe(ID);
    expect(deepLinkLeadId("", `lead_${ID}`)).toBe(ID);
  });
  it("ignores non-uuid values", () => {
    expect(deepLinkLeadId("#lead=../../x", "lead_1", "?lead=%27or%201")).toBeNull();
  });
});
