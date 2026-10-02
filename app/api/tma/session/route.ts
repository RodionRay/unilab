import { database } from "@/lib/server-store";
import { trustedClientIp } from "@/lib/security/client-ip";
import { consumeRateLimits } from "@/lib/security/rate-limit";
import { TMA_INIT_DATA_MAX_BYTES, sessionRequestSchema } from "@/lib/tma/contract";
import { TMA_SESSION_RATE_LIMITS, exchangeWithinWsKeyLimit } from "@/lib/tma/exchange";
import { readJsonObject, tmaError, tmaJson } from "@/lib/tma/http";

export const dynamic = "force-dynamic";

/** POST /api/tma/session {wsKey, initData} → SessionResponse (bearer, no cookie). initData is never logged. */
export async function POST(req: Request): Promise<Response> {
  const raw = await readJsonObject(req, TMA_INIT_DATA_MAX_BYTES + 1024);
  const parsed = sessionRequestSchema.safeParse(raw);
  if (!parsed.success) return tmaError(400, "bad_request");
  try {
    const limit = await consumeRateLimits([[TMA_SESSION_RATE_LIMITS.perIp, trustedClientIp(req)]]);
    if (!limit.allowed) return tmaError(429, "rate_limited", { retryAfterSec: limit.retryAfterSec });
    const result = await exchangeWithinWsKeyLimit(database(), parsed.data);
    if (!result.ok) return tmaError(result.status, result.code, { botLink: result.botLink, retryAfterSec: result.retryAfterSec });
    return tmaJson(result.body);
  } catch (e) {
    console.error("[tma] session:", String((e as Error)?.message || e).slice(0, 300));
    return tmaError(503, "workspace_unavailable", { error: "Сервис временно недоступен. Повторите попытку." });
  }
}
