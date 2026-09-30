import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestD1 } from "./helpers/d1-raw";

const db = createTestD1();
vi.mock("@/lib/server-store", () => ({ database: () => db }));

import {
  OAuthEmailTakenError,
  createUser,
  findOAuthUser,
  linkOAuth,
  upsertOAuthUser,
} from "@/lib/users";

describe("upsertOAuthUser account linking", () => {
  beforeAll(async () => {
    await createUser({ email: "victim@example.com", passwordHash: "pbkdf2:1:a:b", name: "Victim" });
    await createUser({ email: "oauthonly@example.com", name: "OAuth only" });
  });

  it("refuses to link a verified OAuth email to an account with a password", async () => {
    await expect(
      upsertOAuthUser({
        provider: "google",
        providerUserId: "g-attacker",
        email: "Victim@example.com",
        emailVerified: true,
        name: "Attacker",
      }),
    ).rejects.toBeInstanceOf(OAuthEmailTakenError);
    expect(await findOAuthUser("google", "g-attacker")).toBeNull();
  });

  it("never links by an unverified provider email (VK/Yandex)", async () => {
    const user = await upsertOAuthUser({
      provider: "yandex",
      providerUserId: "y-1",
      email: "oauthonly@example.com",
      emailVerified: false,
      name: "Someone",
    });
    expect(user.email).toBeNull();
    const owner = await db
      .prepare("SELECT id FROM users WHERE email=?")
      .bind("oauthonly@example.com")
      .first<{ id: string }>();
    expect(user.id).not.toBe(owner?.id);
  });

  it("does not store an unverified email on a new account", async () => {
    const user = await upsertOAuthUser({
      provider: "vk",
      providerUserId: "vk-1",
      email: "fresh-vk@example.com",
      emailVerified: false,
      name: "VK user",
    });
    expect(user.email).toBeNull();
  });

  it("links a verified email to an existing OAuth-only account", async () => {
    const user = await upsertOAuthUser({
      provider: "google",
      providerUserId: "g-owner",
      email: "oauthonly@example.com",
      emailVerified: true,
      name: "Owner",
    });
    expect(user.email).toBe("oauthonly@example.com");
  });

  it("keeps existing oauth_accounts links working", async () => {
    const victim = await db
      .prepare("SELECT id FROM users WHERE email=?")
      .bind("victim@example.com")
      .first<{ id: string }>();
    await linkOAuth(victim!.id, "google", "g-victim");
    const user = await upsertOAuthUser({
      provider: "google",
      providerUserId: "g-victim",
      email: "victim@example.com",
      emailVerified: true,
      name: "Victim",
    });
    expect(user.id).toBe(victim!.id);
  });
});
