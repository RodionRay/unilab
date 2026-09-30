import {
  ADMIN_USER_ID,
  createSessionToken,
  getAdminEmail,
  readEnv,
  sessionCookieName,
} from "@/lib/auth";
import { listUserIdsForCron } from "@/lib/users";
import { constantTimeEqual } from "@/lib/security/secret-compare";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Стена тика меньше AbortSignal воркера (300с), чтобы не ловить abort. */
const TICK_BUDGET_MS = 210_000;
const SCAN_TIMEOUT_MS = 150_000;
const BOOT_TIMEOUT_MS = 20_000;
const MAX_SCANS_AUTO = 6;
const MAX_SCANS_FORCE = 10;

function reply(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

const MIN_CRON_SECRET_LENGTH = 32;

/** Dedicated secret only: never reuse SESSION_SECRET / TG_WORKER_TOKEN. */
function cronSecret(): string | null {
  const secret = readEnv("CRON_SECRET");
  return secret && secret.length >= MIN_CRON_SECRET_LENGTH ? secret : null;
}

async function bearerMatches(req: Request, secret: string): Promise<boolean> {
  const auth = req.headers.get("authorization") || "";
  return constantTimeEqual(auth, `Bearer ${secret}`);
}

function isAbort(e: unknown) {
  const msg = String((e as Error)?.message || e);
  const name = String((e as Error)?.name || "");
  return (
    name === "TimeoutError" ||
    name === "AbortError" ||
    /aborted|timeout/i.test(msg)
  );
}

async function workspace(
  origin: string,
  cookie: string,
  body: Record<string, unknown>,
  timeoutMs: number,
) {
  const res = await fetch(`${origin}/api/workspace`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: `${sessionCookieName()}=${cookie}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(5_000, timeoutMs)),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `workspace ${res.status}`) as Error & {
      status?: number;
      data?: any;
    };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * Круглосуточный автообход лидов — вызывается tg-worker'ом, без открытого кабинета.
 * Только сканирует уже вступившие группы, с бюджетом времени; остаток — следующим тиком.
 * Не вступает и не переназначает аккаунты: такие группы пропускаются и попадают в журнал обхода.
 */
export async function POST(req: Request) {
  const secret = cronSecret();
  if (!secret) {
    return reply({ error: "CRON_SECRET не настроен (минимум 32 символа)" }, 503);
  }
  if (!(await bearerMatches(req, secret))) {
    return reply({ error: "Unauthorized" }, 401);
  }

  const origin = new URL(req.url).origin;
  const force =
    new URL(req.url).searchParams.get("force") === "1" ||
    (await req
      .clone()
      .json()
      .then((b: any) => b?.force === true)
      .catch(() => false));

  const started = Date.now();
  const left = () => TICK_BUDGET_MS - (Date.now() - started);

  const owners: { userId: string; email: string; name: string }[] = [];
  const adminEmail = getAdminEmail();
  if (adminEmail) {
    owners.push({
      userId: ADMIN_USER_ID,
      email: adminEmail,
      name: "Администратор",
    });
  }
  try {
    owners.push(...(await listUserIdsForCron()));
  } catch {
    /* таблицы пользователей ещё не созданы */
  }
  if (!owners.length) {
    return reply({ error: "Нет пользователей для обхода" }, 503);
  }

  const ticks: Record<string, unknown>[] = [];
  for (const owner of owners.slice(0, 3)) {
    if (left() < 80_000) break;
    const cookie = await createSessionToken({
      userId: owner.userId,
      email: owner.email,
      displayName: owner.name,
    });
    const one = await tickOwner(origin, cookie, force, left);
    ticks.push({ owner: owner.userId, ...one });
  }

  const sum = (key: string) =>
    ticks.reduce((n, t) => n + (Number((t as any)[key]) || 0), 0);

  return reply({
    ok: ticks.every((t) => t.ok !== false),
    ticks,
    scanned: sum("scanned"),
    added: sum("added"),
    due: sum("due"),
    more: ticks.some((t) => !!(t as any).more),
    ms: Date.now() - started,
    at: new Date().toISOString(),
  });
}

async function tickOwner(
  origin: string,
  cookie: string,
  force: boolean,
  left: () => number,
) {
  const started = Date.now();
  const opTimeout = (cap: number) => Math.min(cap, Math.max(8_000, left() - 8_000));
  try {
    const boot = await fetch(`${origin}/api/workspace`, {
      headers: {
        Cookie: `${sessionCookieName()}=${cookie}`,
        Origin: origin,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(BOOT_TIMEOUT_MS),
    });
    const bootData: any = await boot.json().catch(() => ({}));
    if (!boot.ok) {
      return {
        ok: false,
        error: bootData.error || "Не удалось загрузить кабинет",
      };
    }
    const settingsRow = (bootData.records || []).find(
      (r: any) => r.kind === "settings",
    );
    const settings = settingsRow?.data || {};
    if (!force && settings.autoRescanEnabled === false) {
      return {
        ok: true,
        skipped: true,
        reason: "autoRescanDisabled",
      };
    }

    const scanLimit = force ? MAX_SCANS_FORCE : MAX_SCANS_AUTO;
    const pack = await workspace(
      origin,
      cookie,
      {
        action: "rescan_groups",
        force,
        limit: scanLimit,
      },
      25_000,
    );

    let stoppedEarly = false;
    let needJoin = Number(pack.needJoin) || 0;
    let unavailable = Number(pack.unavailableTotal) || 0;
    const errors: string[] = [];
    const groupErrors: string[] = (Array.isArray(pack.unavailable) ? pack.unavailable : [])
      .slice(0, 3)
      .map((u: any) => `${String(u?.name || "группа").slice(0, 40)}: ${String(u?.error || "аккаунт недоступен").slice(0, 80)}`);

    const ids: string[] = Array.isArray(pack.groupIds) ? pack.groupIds : [];
    let scanned = 0;
    let added = 0;
    let skipped = 0;

    for (const id of ids) {
      if (left() < 90_000) {
        stoppedEarly = true;
        break;
      }
      try {
        const r = await workspace(
          origin,
          cookie,
          { action: "scan_group", id, force },
          opTimeout(SCAN_TIMEOUT_MS),
        );
        if (r?.skipped) {
          skipped++;
          continue;
        }
        scanned++;
        added += Number(r?.added) || 0;
      } catch (e) {
        const data = (e as any)?.data;
        // Ошибка одной группы (нужно вступить / аккаунт недоступен) — пропуск с записью в журнал
        if (data?.needJoin) {
          needJoin++;
          continue;
        }
        if (data?.accountDead || data?.accountFrozen || data?.accountCooldown) {
          unavailable++;
          groupErrors.push(String(data?.error || "аккаунт недоступен").slice(0, 120));
          continue;
        }
        errors.push(String((e as Error).message || e).slice(0, 120));
        if (isAbort(e)) {
          stoppedEarly = true;
          break;
        }
        if (errors.length >= 4) {
          stoppedEarly = true;
          break;
        }
      }
    }

    try {
      await workspace(origin, cookie, { action: "poll_dm_replies" }, 90_000);
    } catch {
      /* ответы в ЛС — следующим тиком */
    }

    const logged = [...groupErrors, ...errors];
    const summary =
      `Автообход: просканировано ${scanned}, лидов +${added}` +
      (needJoin ? `, пропущено (нужно вступить вручную) ${needJoin}` : "") +
      (unavailable ? `, аккаунт группы недоступен ${unavailable}` : "") +
      (logged.length ? ` · ошибки: ${logged.slice(0, 3).join(" | ")}` : "");
    try {
      await workspace(
        origin,
        cookie,
        { action: "mark_auto_rescan", summary, hasErrors: logged.length > 0 },
        12_000,
      );
    } catch {
      /* */
    }

    const due = Number(pack.total) || ids.length;
    const more = stoppedEarly || due > ids.length;
    return {
      ok: true,
      scanned,
      added,
      skipped,
      needJoin,
      unavailable,
      due,
      queued: ids.length,
      remaining: Math.max(0, due - scanned - skipped),
      more,
      ms: Date.now() - started,
      errors: errors.slice(0, 5),
    };
  } catch (e) {
    return {
      ok: false,
      error: String((e as Error).message || e).slice(0, 400),
      timeout: isAbort(e),
      ms: Date.now() - started,
    };
  }
}

export async function GET(req: Request) {
  return POST(req);
}
