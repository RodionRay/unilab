import { database } from "@/lib/server-store";
import { trustedClientIp } from "@/lib/security/client-ip";
import { consumeRateLimits } from "@/lib/security/rate-limit";
import { TMA_INIT_DATA_MAX_BYTES, sessionRequestSchema } from "@/lib/tma/contract";
import { TMA_SESSION_RATE_LIMITS, exchangeInitData } from "@/lib/tma/exchange";
import { readJsonObject, tmaError, tmaJson } from "@/lib/tma/http";

export const dynamic = "force-dynamic";

/** POST /api/tma/session {wsKey, initData} → SessionResponse (bearer, no cookie). initData is never logged. */
export async function POST(req: Request): Promise<Response> {
  const raw = await readJsonObject(req, TMA_INIT_DATA_MAX_BYTES + 1024);
  const parsed = sessionRequestSchema.safeParse(raw);
  if (!parsed.success) return tmaError(400, "bad_request");
  try {
    const limit = await consumeRateLimits([
      [TMA_SESSION_RATE_LIMITS.perIp, trustedClientIp(req)],
      [TMA_SESSION_RATE_LIMITS.perWsKey, parsed.data.wsKey],
    ]);
    if (!limit.allowed) return tmaError(429, "rate_limited", { retryAfterSec: limit.retryAfterSec });
    const result = await exchangeInitData(database(), parsed.data);
    if (!result.ok) return tmaError(result.status, result.code, { botLink: result.botLink });
    return tmaJson(result.body);
  } catch (e) {
    console.error("[tma] session:", String((e as Error)?.message || e).slice(0, 300));
    return tmaError(503, "workspace_unavailable", { error: "Сервис временно недоступен. Повторите попытку." });
  }
}
