import { describe, expect, it } from "vitest";
import { sessionCookieOptions } from "@/lib/auth";

describe("sessionCookieOptions secure flag", () => {
  it("is secure by default and for public hosts", () => {
    expect(sessionCookieOptions().secure).toBe(true);
    expect(sessionCookieOptions(60, "https://unilab.example/api/auth/login").secure).toBe(true);
    expect(sessionCookieOptions(60, "http://unilab.example/api/auth/login").secure).toBe(true);
  });

  it("is not secure only on localhost / 127.0.0.1", () => {
    expect(sessionCookieOptions(60, "http://localhost:3000/api/auth/login").secure).toBe(false);
    expect(sessionCookieOptions(60, "http://127.0.0.1:8787/x").secure).toBe(false);
  });

  it("keeps httpOnly and SameSite=Lax", () => {
    const o = sessionCookieOptions(60, "https://unilab.example/");
    expect(o).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 });
  });
});
