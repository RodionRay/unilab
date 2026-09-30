import { NextResponse } from "next/server";
import {
  ADMIN_USER_ID,
  adminAuthConfigured,
  authConfigured,
  createSessionToken,
  getAdminEmail,
  sessionCookieName,
  sessionCookieOptions,
  verifyAdminPassword,
  verifyPasswordHash,
  type SessionPayload,
} from "@/lib/auth";
import { trustedClientIp } from "@/lib/security/client-ip";
import {
  RATE_LIMITS,
  consumeRateLimits,
  resetRateLimit,
  tooManyRequests,
} from "@/lib/security/rate-limit";
import { findUserByEmail } from "@/lib/users";

export const dynamic = "force-dynamic";

const BAD_CREDENTIALS = "Неверный email или пароль";

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function signedIn(req: Request, user: SessionPayload) {
  const response = reply({ ok: true });
  response.cookies.set(
    sessionCookieName(),
    await createSessionToken(user),
    sessionCookieOptions(undefined, req.url),
  );
  return response;
}

/**
 * The admin email is resolved against env credentials only, before any DB
 * lookup, so a DB row with the same email can never shadow the admin.
 */
async function resolveUser(email: string, password: string): Promise<SessionPayload | null> {
  const adminEmail = getAdminEmail();
  if (adminEmail && email === adminEmail) {
    if (!adminAuthConfigured() || !(await verifyAdminPassword(password))) return null;
    return { userId: ADMIN_USER_ID, email: adminEmail, displayName: "Администратор" };
  }
  const dbUser = await findUserByEmail(email);
  if (!dbUser?.passwordHash) return null;
  if (!(await verifyPasswordHash(password, dbUser.passwordHash))) return null;
  return { userId: dbUser.id, email: dbUser.email || email, displayName: dbUser.name };
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) {
    return reply({ error: "Недопустимый источник запроса" }, 403);
  }

  try {
    if (!authConfigured()) {
      return reply({ error: "Авторизация не настроена на сервере" }, 503);
    }

    const body = (await req.json()) as { email?: string; password?: string };
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const password = String(body.password ?? "");
    if (!email || !password) return reply({ error: BAD_CREDENTIALS }, 401);

    // Counted before the slow password check so parallel guesses cannot race past.
    const ip = trustedClientIp(req);
    const guessSubject = ip ? `${email}|${ip}` : email;
    const limit = await consumeRateLimits([
      [RATE_LIMITS.loginPerIp, ip],
      [RATE_LIMITS.loginPerEmailIp, guessSubject],
      [RATE_LIMITS.loginPerEmail, email],
    ]);
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec);

    const user = await resolveUser(email, password);
    if (!user) return reply({ error: BAD_CREDENTIALS }, 401);
    await resetRateLimit(RATE_LIMITS.loginPerEmailIp, guessSubject);
    return signedIn(req, user);
  } catch {
    return reply({ error: "Не удалось выполнить вход" }, 503);
  }
}
