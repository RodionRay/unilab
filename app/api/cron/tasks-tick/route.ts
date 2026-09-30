import {
  ADMIN_USER_ID,
  createSessionToken,
  getAdminEmail,
  readEnv,
  sessionCookieName,
} from "@/lib/auth";
import { listUserIdsForCron } from "@/lib/users";
import { constantTimeEqual } from "@/lib/security/secret-compare";
import { selfOrigin } from "@/lib/security/self-origin";
import { database } from "@/lib/server-store";
import {
  TICK_ACTIONS,
  listDueTasks,
  runDueTicks,
  type DueTask,
  type TickOutcome,
} from "@/lib/processes/tasks-tick-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Whole run; the worker loop's fetch timeout (server.mjs) is above this. */
const TICK_BUDGET_MS = 200_000;
/** One tick call; a slower tick finishes server-side under its lock. */
const CALL_TIMEOUT_MS = 90_000;
const MIN_START_MS = 15_000;
/** Parallel ticks — below the worker's default 4 Python slots. */
const CONCURRENCY = 3;
const MIN_CRON_SECRET_LENGTH = 32;

function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Dedicated secret only (same guard as /api/cron/auto-rescan). */
function cronSecret(): string | null {
  const secret = readEnv("CRON_SECRET");
  return secret && secret.length >= MIN_CRON_SECRET_LENGTH ? secret : null;
}

type OwnerIdentity = { email: string; name: string };

async function ownerIdentities(): Promise<Map<string, OwnerIdentity>> {
  const map = new Map<string, OwnerIdentity>();
  const adminEmail = getAdminEmail();
  if (adminEmail) map.set(ADMIN_USER_ID, { email: adminEmail, name: "Администратор" });
  try {
    for (const u of await listUserIdsForCron()) map.set(u.userId, { email: u.email, name: u.name });
  } catch {
    /* таблицы пользователей ещё не созданы — только администратор */
  }
  return map;
}

function describeError(e: unknown): string {
  const err = e as Error | null;
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "tick continues server-side";
  return String(err?.message || e).slice(0, 160);
}

/**
 * Ticks due invite / mailing / audience tasks of every owner — tasks run with the
 * browser closed; scheduled ones resume at nextAt. Called by the tg-worker loop.
 */
export async function POST(req: Request) {
  const secret = cronSecret();
  if (!secret) return reply({ error: "CRON_SECRET не настроен (минимум 32 символа)" }, 503);
  const auth = req.headers.get("authorization") || "";
  if (!(await constantTimeEqual(auth, `Bearer ${secret}`))) return reply({ error: "Unauthorized" }, 401);

  const started = Date.now();
  const origin = selfOrigin(req.url, readEnv("APP_URL"));
  const listed = await listDueTasks(database());
  if (!listed.length) return reply({ ok: true, due: 0, ticked: 0, skipped: 0, more: false, ms: Date.now() - started });

  // Sessions only for active users (+ admin): a task left behind by a deleted user is not ticked.
  const identities = await ownerIdentities();
  const due = listed.filter((t) => identities.has(t.owner));
  const cookies = new Map<string, Promise<string>>();
  const cookieFor = (owner: string) => {
    let c = cookies.get(owner);
    if (!c) {
      const who = identities.get(owner)!;
      c = createSessionToken({ userId: owner, email: who.email, displayName: who.name });
      cookies.set(owner, c);
    }
    return c;
  };

  const tick = async (task: DueTask, timeoutMs: number): Promise<TickOutcome> => {
    try {
      const res = await fetch(`${origin}/api/workspace`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          Cookie: `${sessionCookieName()}=${await cookieFor(task.owner)}`,
        },
        body: JSON.stringify({ action: TICK_ACTIONS[task.kind], id: task.id }),
        signal: AbortSignal.timeout(Math.max(5_000, timeoutMs)),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; task?: { status?: string } };
      return { task, ok: res.ok, note: res.ok ? String(data.task?.status || "") : String(data.error || res.status) };
    } catch (e) {
      return { task, ok: false, note: describeError(e) };
    }
  };

  const run = await runDueTicks({
    tasks: due,
    tick,
    budgetMs: TICK_BUDGET_MS,
    callTimeoutMs: CALL_TIMEOUT_MS,
    minStartMs: MIN_START_MS,
    concurrency: CONCURRENCY,
  });
  return reply({
    ok: run.outcomes.every((o) => o.ok),
    due: due.length,
    ticked: run.outcomes.length,
    skipped: listed.length - due.length,
    more: run.more,
    results: run.outcomes.map((o) => ({ kind: o.task.kind, id: o.task.id, ok: o.ok, note: o.note })),
    ms: Date.now() - started,
    at: new Date().toISOString(),
  });
}
