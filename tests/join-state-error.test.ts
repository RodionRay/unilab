import { describe, expect, it } from "vitest";
import { sanitizeJoinStateError } from "@/lib/processes/join-flow";

describe("joinStateError · общая sanitize", () => {
  it("принимает строку и режет длиннее 500", () => {
    expect(sanitizeJoinStateError("ok")).toBe("ok");
    expect(sanitizeJoinStateError("x".repeat(600)).length).toBe(500);
  });

  it("чистит null/object (битый JSON от старого set_group_join_state)", () => {
    expect(sanitizeJoinStateError(null)).toBe("");
    expect(sanitizeJoinStateError({ _def: "zod" })).toBe("");
    expect(sanitizeJoinStateError(undefined)).toBe("");
  });
});
