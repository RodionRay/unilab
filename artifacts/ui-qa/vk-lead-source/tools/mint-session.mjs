#!/usr/bin/env node
// Mint an admin session cookie exactly like lib/auth.ts::createSessionToken and write a Playwright storageState.
//   node mint-session.mjs --out <storage.json> [--host 127.0.0.1] [--ttl-hours 12]
// Reads SESSION_SECRET / ADMIN_EMAIL from the gitignored <repo>/.env; never prints the token.
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readDotEnv, parseArgs } from "./lib-env.mjs";

const ADMIN_USER_ID = "admin"; // lib/auth.ts::ADMIN_USER_ID
const COOKIE_NAME = "uniseller_session"; // lib/auth.ts::COOKIE_NAME

const args = parseArgs(process.argv.slice(2));
if (!args.out || args.out === true) {
  console.error("usage: node mint-session.mjs --out <storage.json> [--host 127.0.0.1] [--ttl-hours 12]");
  process.exit(2);
}
const env = readDotEnv();
const secret = env.SESSION_SECRET || "";
const email = (env.ADMIN_EMAIL || "").toLowerCase();
if (secret.length < 32) throw new Error("SESSION_SECRET in .env must be >= 32 chars");
if (!email) throw new Error("ADMIN_EMAIL missing in .env");

const exp = Math.floor(Date.now() / 1000) + Number(args["ttl-hours"] || 12) * 3600;
const payload = Buffer.from(JSON.stringify({ sub: ADMIN_USER_ID, email, name: "Администратор (тест)", exp }), "utf8").toString("base64url");
const sig = createHmac("sha256", secret).update(payload).digest("base64url");

const state = {
  cookies: [{
    name: COOKIE_NAME,
    value: `${payload}.${sig}`,
    domain: typeof args.host === "string" ? args.host : "127.0.0.1",
    path: "/",
    expires: exp,
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  }],
  origins: [],
};
mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, JSON.stringify(state, null, 2), { mode: 0o600 });
console.log(`storageState written: ${args.out} (expires ${new Date(exp * 1000).toISOString()})`);
