import { env } from "cloudflare:workers";

export type D1LikeStatement = {
  all(): Promise<{ results: Record<string, unknown>[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
};

export type D1LikeDatabase = {
  prepare(sql: string): {
    bind(...values: unknown[]): D1LikeStatement;
  };
  /** D1 batch: the statements run in order inside one transaction — all apply or none. */
  batch(statements: D1LikeStatement[]): Promise<{ meta: { changes: number } }[]>;
};

/** Runtime DB for vinext/workerd — Cloudflare D1 (local file under .wrangler/state). */
export function getDatabase(): D1LikeDatabase {
  if (!env.DB) {
    throw new Error("Хранилище недоступно (D1 binding DB)");
  }
  return env.DB as unknown as D1LikeDatabase;
}

export async function pingDatabase(): Promise<boolean> {
  try {
    const row = await getDatabase().prepare("SELECT 1 AS ok").bind().first();
    return Boolean(row);
  } catch {
    return false;
  }
}
