#!/usr/bin/env node
import { randomBytes, pbkdf2Sync } from "node:crypto";

const ITERATIONS = 210_000;
const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/hash-password.mjs <password>");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
process.stdout.write(
  ["pbkdf2", String(ITERATIONS), salt.toString("base64url"), hash.toString("base64url")].join(":") +
    "\n",
);
