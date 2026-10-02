import { getSessionUser, readEnv } from "@/lib/auth";
import { database } from "@/lib/server-store";
import { trustedClientIp } from "@/lib/security/client-ip";
import { resolveWorkspaceContext } from "@/lib/staff";
import { linkRequestSchema } from "@/lib/tma/contract";
import { isSameOriginRequest, readJsonObject, tmaError, tmaJson } from "@/lib/tma/http";
import { handleLinkRequest } from "@/lib/tma/link-api";

export const dynamic = "force-dynamic";

/** POST /api/tma/link — web (cookie session; Origin or Sec-Fetch-Site must prove same origin; no tma bearer). */
export async function POST(req: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user?.userId) return tmaError(401, "session_expired", { error: "Войдите в рабочее пространство" });
  if (!isSameOriginRequest(req)) return tmaError(403, "forbidden", { error: "Недопустимый источник запроса" });
  const parsed = linkRequestSchema.safeParse(await readJsonObject(req, 2048));
  if (!parsed.success) return tmaError(400, "bad_request");
  try {
    const db = database();
    const ctx = await resolveWorkspaceContext(user.userId);
    const result = await handleLinkRequest(db, ctx, parsed.data, { appUrl: readEnv("APP_URL"), clientIp: trustedClientIp(req) });
    const headers: Record<string, string> = result.retryAfterSec ? { "Retry-After": String(result.retryAfterSec) } : {};
    return tmaJson(result.body, result.status, headers);
  } catch (e) {
    console.error("[tma] link:", String((e as Error)?.message || e).slice(0, 300));
    return tmaError(503, "workspace_unavailable", { error: "Сервис временно недоступен. Повторите попытку." });
  }
}
