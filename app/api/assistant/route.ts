import { getSessionUser } from "@/lib/auth";
import { envAiApiKey } from "@/lib/ai-client";
import { database, unseal } from "@/lib/server-store";
import {
  assistantRequestSchema,
  canAskAssistant,
  generateAssistantReply,
} from "@/lib/assistant-chat";
import { trustedClientIp } from "@/lib/security/client-ip";
import {
  RATE_LIMITS,
  assistantUserDailyRule,
  consumeRateLimit,
  consumeRateLimits,
  tooManyRequests,
} from "@/lib/security/rate-limit";
import { z } from "zod";

export const dynamic = "force-dynamic";

function reply(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function dailyCapReached(limit: number, retryAfterSec: number) {
  return Response.json(
    {
      error: `Дневной лимит вопросов ассистенту исчерпан (${limit} в сутки). Попробуйте завтра.`,
    },
    {
      status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSec) },
    },
  );
}

/**
 * Cooldown record id, or null when the client cannot be told apart (anonymous
 * without a trusted IP): a shared key would make every such visitor wait on
 * each other; the global daily quota bounds them instead.
 */
function cooldownKey(req: Request, owner: string | null): string | null {
  if (owner) return "assistant-guard:user:" + owner;
  const ip = trustedClientIp(req);
  return ip ? "assistant-guard:ip:" + ip : null;
}

type RecordRow = { created?: string; data?: string; secret?: string | null };

async function loadOwnerProduct(
  owner: string,
): Promise<{ product?: string; apiKey?: string }> {
  const fromEnv = envAiApiKey() || undefined;
  try {
    const db = database();
    const config = await db
      .prepare("SELECT * FROM records WHERE owner=? AND kind=? LIMIT 1")
      .bind(owner, "settings")
      .first<RecordRow>();
    if (!config) return { apiKey: fromEnv };
    const data = JSON.parse(config.data || "{}") as { product?: string };
    const sealedKey = config.secret
      ? await unseal(config.secret, owner).catch(() => undefined)
      : undefined;
    return { product: data.product, apiKey: fromEnv || sealedKey };
  } catch {
    return { apiKey: fromEnv };
  }
}

export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) {
      return reply({ error: "Недопустимый источник запроса" }, 403);
    }
    const bodyText = await req.text();
    if (bodyText.length > 20_000)
      return reply({ error: "Слишком большой запрос" }, 413);
    const parsed = assistantRequestSchema.parse(JSON.parse(bodyText));

    const user = await getSessionUser().catch(() => null);
    const owner = user?.userId || null;
    const guardId = cooldownKey(req, owner);
    const now = new Date();

    let db: ReturnType<typeof database> | null = null;
    try {
      db = database();
    } catch {
      db = null;
    }

    if (db) {
      if (guardId) {
        const guardRow = await db
          .prepare("SELECT created FROM records WHERE id=?")
          .bind(guardId)
          .first<RecordRow>();
        if (!canAskAssistant(guardRow?.created, now)) {
          return reply(
            { error: "Подождите несколько секунд перед следующим вопросом." },
            429,
          );
        }
        // Start the cooldown before the quota check so a blocked client cannot hammer it.
        await db
          .prepare(
            "INSERT INTO records(id,owner,kind,data,created) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET created=excluded.created",
          )
          .bind(guardId, owner || "public", "ai_guard", "{}", now.toISOString())
          .run();
      }
      // The site widget is public: anonymous use has a per-IP and a global daily cap.
      // Per-IP first: an IP over its cap must not spend the shared global quota.
      if (!owner) {
        const quota = await consumeRateLimits([
          [RATE_LIMITS.assistantAnonPerIp, trustedClientIp(req)],
          [RATE_LIMITS.assistantAnonGlobal, "all"],
        ]);
        if (!quota.allowed) return tooManyRequests(quota.retryAfterSec);
      } else {
        const rule = assistantUserDailyRule();
        const quota = await consumeRateLimit(rule, owner);
        if (!quota.allowed) return dailyCapReached(rule.limit, quota.retryAfterSec);
      }
    }

    const owned = owner
      ? await loadOwnerProduct(owner)
      : { apiKey: envAiApiKey() || undefined };
    const result = await generateAssistantReply(parsed, {
      apiKey: owned.apiKey ?? null,
      productContext: owned.product,
    });

    return reply({
      ok: true,
      reply: result.reply,
      source: result.source,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return reply(
        {
          error:
            "Проверьте сообщение: " +
            e.issues.map((i) => i.path.join(".")).join(", "),
        },
        400,
      );
    }
    if (e instanceof SyntaxError)
      return reply({ error: "Некорректный запрос" }, 400);
    return reply(
      { error: "Ассистент временно недоступен. Попробуйте позже." },
      503,
    );
  }
}
