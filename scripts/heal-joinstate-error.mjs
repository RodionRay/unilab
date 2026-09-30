#!/usr/bin/env node
/**
 * Локальная починка битых joinStateError в SQLite (.data или D1 persist).
 * Usage: node scripts/heal-joinstate-error.mjs
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const candidates = [
  join(process.cwd(), ".data", "uniseller.sqlite"),
  ...[
    join(
      process.cwd(),
      ".wrangler/state/v3/d1/miniflare-D1DatabaseObject",
    ),
  ].flatMap((dir) => {
    try {
      const { readdirSync } = require("node:fs");
      return readdirSync(dir)
        .filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite")
        .map((f) => join(dir, f));
    } catch {
      return [];
    }
  }),
];

function sanitize(v) {
  if (v == null) return "";
  if (typeof v === "object") return "";
  return String(v).slice(0, 500);
}

let total = 0;
for (const path of candidates) {
  if (!existsSync(path)) continue;
  const db = new Database(path);
  const has = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='records'")
    .get();
  if (!has) {
    db.close();
    continue;
  }
  const rows = db.prepare("SELECT id, data FROM records WHERE kind='group'").all();
  let fixed = 0;
  const upd = db.prepare("UPDATE records SET data=? WHERE id=?");
  for (const row of rows) {
    let g;
    try {
      g = JSON.parse(row.data);
    } catch {
      continue;
    }
    const raw = g.joinStateError;
    const next = sanitize(raw);
    const bad =
      raw != null &&
      (typeof raw === "object" ||
        (typeof raw === "string" && raw.length > 500));
    if (!bad) continue;
    g.joinStateError = next;
    if (typeof g.joinState === "object") {
      g.joinState = "";
      g.joinStateAt = "";
    }
    upd.run(JSON.stringify(g), row.id);
    fixed++;
  }
  db.close();
  console.log(`${path}: fixed ${fixed}/${rows.length} groups`);
  total += fixed;
}
console.log(`Done. Total fixed: ${total}`);
