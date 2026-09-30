import { NextResponse } from "next/server";
import { database } from "@/lib/server-store";
import { readEnv } from "@/lib/auth";
import { contactTasks } from "@/components/marketing/content";
import { trustedClientIp } from "@/lib/security/client-ip";
import {
  RATE_LIMITS,
  consumeRateLimits,
  tooManyRequests,
} from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function ensureTable() {
  const db = database();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS contact_messages (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        email text NOT NULL,
        telegram text,
        company text,
        task text,
        message text NOT NULL,
        created text NOT NULL
      )`,
    )
    .bind()
    .run();
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) {
    return reply({ error: "Недопустимый источник запроса" }, 403);
  }
  try {
    const limit = await consumeRateLimits([
      [RATE_LIMITS.contactPerIp, trustedClientIp(req)],
    ]);
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec);
    const body = (await req.json()) as Record<string, string>;
    const name = String(body.name ?? "").trim().slice(0, 80);
    const email = String(body.email ?? "").trim().toLowerCase().slice(0, 120);
    const telegram = String(body.telegram ?? "").trim().slice(0, 64);
    const company = String(body.company ?? "").trim().slice(0, 120);
    const task = String(body.task ?? "").trim().slice(0, 40);
    const message = String(body.message ?? "").trim().slice(0, 4000);
    if (name.length < 2) return reply({ error: "Укажите имя" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply({ error: "Укажите корректный email" }, 400);
    }
    if (message.length < 10) {
      return reply({ error: "Опишите задачу чуть подробнее" }, 400);
    }
    const known = contactTasks.some((t) => t.id === task);
    await ensureTable();
    const id = crypto.randomUUID();
    const created = new Date().toISOString();
    await database()
      .prepare(
        `INSERT INTO contact_messages (id,name,email,telegram,company,task,message,created)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .bind(id, name, email, telegram, company, known ? task : "other", message, created)
      .run();

    const bot = readEnv("CONTACT_BOT_TOKEN");
    const chat = readEnv("CONTACT_CHAT_ID");
    if (bot && chat) {
      const text = [
        "UniLab · заявка с сайта",
        `Имя: ${name}`,
        `Email: ${email}`,
        telegram ? `Telegram: ${telegram}` : "",
        company ? `Компания: ${company}` : "",
        `Задача: ${task}`,
        message,
      ]
        .filter(Boolean)
        .join("\n");
      await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text }),
      }).catch(() => null);
    }

    return reply({ ok: true });
  } catch {
    return reply({ error: "Не удалось отправить заявку" }, 503);
  }
}
