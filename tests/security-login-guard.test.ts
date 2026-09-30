import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestD1 } from "./helpers/d1-raw";

const db = createTestD1();
vi.mock("@/lib/server-store", () => ({ database: () => db }));

import { hashPassword } from "@/lib/auth";
import { createUser } from "@/lib/users";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as register } from "@/app/api/auth/register/route";

const ADMIN = "boss@example.com";
const ADMIN_PW = `admin-${randomUUID()}`;
const DB_PW = `db-${randomUUID()}`;
const NEW_PW = `new-${randomUUID()}`;
const ENV_KEYS = ["SESSION_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD_HASH"];
const saved: Record<string, string | undefined> = {};
let ipSeq = 0;

function post(
  handler: (req: Request) => Promise<Response>,
  path: string,
  body: Record<string, string>,
  ip = `198.51.100.${++ipSeq % 250}`,
) {
  return handler(
    new Request(`https://app.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify(body),
    }),
  );
}

function sessionSubject(res: Response): string | null {
  const m = /uniseller_session=([^.;]+)\./.exec(res.headers.get("set-cookie") || "");
  if (!m) return null;
  return (JSON.parse(Buffer.from(m[1]!, "base64url").toString("utf8")) as { sub: string }).sub;
}

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.SESSION_SECRET = "s".repeat(48);
  process.env.ADMIN_EMAIL = ADMIN;
  process.env.ADMIN_PASSWORD_HASH = await hashPassword(ADMIN_PW);
  await createUser({
    email: ADMIN,
    passwordHash: await hashPassword(DB_PW),
    name: "Shadow",
  });
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("admin cannot be shadowed by a DB user", () => {
  it("rejects the DB password for the admin email", async () => {
    const res = await post(login, "/api/auth/login", { email: ADMIN, password: DB_PW });
    expect(res.status).toBe(401);
  });

  it("accepts the env admin credentials", async () => {
    const res = await post(login, "/api/auth/login", { email: ADMIN, password: ADMIN_PW });
    expect(res.status).toBe(200);
    expect(sessionSubject(res)).toBe("admin");
  });

  it("refuses to register the admin email", async () => {
    await db.prepare("DELETE FROM users WHERE email=?").bind(ADMIN).run();
    const res = await post(register, "/api/auth/register", {
      email: "Boss@Example.com",
      password: NEW_PW,
    });
    expect(res.status).toBe(409);
    expect(sessionSubject(res)).toBeNull();
  });
});

describe("login and register rate limits", () => {
  it("limits failed guesses per email from one IP", async () => {
    const ip = "203.0.113.101";
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await post(
        login,
        "/api/auth/login",
        { email: "target@example.com", password: `guess-${i}` },
        ip,
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("does not lock the owner out when an attacker exhausts guesses from another IP", async () => {
    const email = "victim@example.com";
    await createUser({ email, passwordHash: await hashPassword(DB_PW), name: "V" });
    for (let i = 0; i < 11; i++) {
      await post(login, "/api/auth/login", { email, password: `attack-${i}` }, "203.0.113.102");
    }
    expect(
      (await post(login, "/api/auth/login", { email, password: DB_PW }, "203.0.113.102")).status,
    ).toBe(429);
    expect(
      (await post(login, "/api/auth/login", { email, password: DB_PW }, "203.0.113.103")).status,
    ).toBe(200);
  });

  it("caps attempts per email across all IPs", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 101; i++) {
      const res = await post(login, "/api/auth/login", {
        email: "distributed@example.com",
        password: `guess-${i}`,
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 100).every((s) => s === 401)).toBe(true);
    expect(statuses[100]).toBe(429);
  });

  it("counts parallel guesses before the slow password check", async () => {
    const email = "raced@example.com";
    await createUser({ email, passwordHash: await hashPassword(DB_PW), name: "R" });
    const responses = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        post(login, "/api/auth/login", { email, password: `race-${i}` }, "203.0.113.104"),
      ),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(20);
  });

  it("does not block repeated successful logins", async () => {
    const email = "busy@example.com";
    await createUser({ email, passwordHash: await hashPassword(DB_PW), name: "Busy" });
    const statuses: number[] = [];
    for (let i = 0; i < 15; i++) {
      statuses.push(
        (await post(login, "/api/auth/login", { email, password: DB_PW }, "203.0.113.105")).status,
      );
    }
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it("resets the email+IP failure count after a successful login", async () => {
    const email = "forgetful@example.com";
    const ip = "203.0.113.106";
    await createUser({ email, passwordHash: await hashPassword(DB_PW), name: "F" });
    for (let i = 0; i < 9; i++) {
      await post(login, "/api/auth/login", { email, password: `wrong-${i}` }, ip);
    }
    expect((await post(login, "/api/auth/login", { email, password: DB_PW }, ip)).status).toBe(200);
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push(
        (await post(login, "/api/auth/login", { email, password: `again-${i}` }, ip)).status,
      );
    }
    expect(statuses.every((s) => s === 401)).toBe(true);
    // Guessing from this IP is exhausted again; the owner's other networks are unaffected.
    expect((await post(login, "/api/auth/login", { email, password: DB_PW }, ip)).status).toBe(429);
  });

  it("limits attempts per IP across emails", async () => {
    const ip = "203.0.113.7";
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await post(
        login,
        "/api/auth/login",
        { email: `spray-${i}@example.com`, password: "x" },
        ip,
      );
      statuses.push(res.status);
    }
    expect(statuses[19]).toBe(401);
    expect(statuses[20]).toBe(429);
    expect(
      (await post(login, "/api/auth/login", { email: "a@b.co", password: "x" }, ip)).headers.get(
        "retry-after",
      ),
    ).toMatch(/^\d+$/);
  });

  it("ignores X-Forwarded-For when keying by IP", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 20; i++) {
      await post(login, "/api/auth/login", { email: `xff-${i}@example.com`, password: "x" }, ip);
    }
    const res = await login(
      new Request("https://app.test/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": ip,
          "x-forwarded-for": "192.0.2.123",
        },
        body: JSON.stringify({ email: "xff-last@example.com", password: "x" }),
      }),
    );
    expect(res.status).toBe(429);
  });

  it("does not lump clients without a trusted IP into one shared bucket", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      const res = await login(
        new Request("https://app.test/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: `noip-${i}@example.com`, password: "x" }),
        }),
      );
      statuses.push(res.status);
    }
    expect(statuses.every((s) => s === 401)).toBe(true);
  });

  it("ignores cf-connecting-ip when TRUSTED_IP_HEADER=none", async () => {
    vi.stubEnv("TRUSTED_IP_HEADER", "none");
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 25; i++) {
        const res = await post(
          login,
          "/api/auth/login",
          { email: `spoof-${i}@example.com`, password: "x" },
          "203.0.113.77",
        );
        statuses.push(res.status);
      }
      expect(statuses.every((s) => s === 401)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("limits registrations per IP", async () => {
    const ip = "203.0.113.50";
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await post(
        register,
        "/api/auth/register",
        { email: `bad-${i}`, password: "x" },
        ip,
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
