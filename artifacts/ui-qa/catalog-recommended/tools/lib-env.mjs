// Shared helpers for the UI-QA stand tools: repo root + gitignored .env reader (values never logged).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(TOOLS_DIR, "../../../..");

export function readDotEnv(path = join(REPO, ".env")) {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/** Minimal `--key value` / `--flag` parser. */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}
