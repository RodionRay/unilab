import Database from "better-sqlite3";
import type { D1LikeDatabase } from "@/lib/db";

/** In-memory SQLite behind the D1 subset the app uses (prepare/bind/first/all/run). */
export function createTestD1(): D1LikeDatabase & { raw: Database.Database } {
  const raw = new Database(":memory:");
  return {
    raw,
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          const stmt = () => raw.prepare(sql);
          return {
            async all() {
              return { results: stmt().all(...values) as Record<string, unknown>[] };
            },
            async first<T = Record<string, unknown>>() {
              const s = stmt();
              if (!s.reader) {
                s.run(...values);
                return null;
              }
              return ((s.get(...values) as T | undefined) ?? null) as T | null;
            },
            async run() {
              const s = stmt();
              if (s.reader) {
                s.all(...values);
                return { meta: { changes: 0 } };
              }
              const info = s.run(...values);
              return { meta: { changes: info.changes } };
            },
          };
        },
      };
    },
  };
}
