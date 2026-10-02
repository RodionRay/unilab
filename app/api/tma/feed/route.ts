import { database } from "@/lib/server-store";
import { feedQuerySchema } from "@/lib/tma/contract";
import { resolveTmaActor } from "@/lib/tma/actor";
import { buildFeed } from "@/lib/tma/feed";
import { tmaError, tmaJson } from "@/lib/tma/http";
import { readTmaBearer } from "@/lib/tma/session";

export const dynamic = "force-dynamic";

/** GET /api/tma/feed?view=… — bearer only (no cookie), re-checked per request (REQ-A5). */
export async function GET(req: Request): Promise<Response> {
  const token = readTmaBearer(req);
  if (!token) return tmaError(401, "session_expired");
  const db = database();
  const actor = await resolveTmaActor(db, token);
  if (!actor) return tmaError(401, "session_expired");
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const query = feedQuerySchema.safeParse(params);
  if (!query.success) return tmaError(400, "bad_request");
  try {
    const result = await buildFeed(db, actor, query.data);
    if (!result.ok) return tmaError(result.status, result.code, { error: result.error });
    return tmaJson(result.body);
  } catch (e) {
    console.error("[tma] feed:", String((e as Error)?.message || e).slice(0, 300));
    return tmaError(503, "unavailable", { error: "Не удалось загрузить данные. Повторите попытку." });
  }
}
