import { z } from "zod";
import { resolveAiConfig } from "@/lib/ai-client";
import {
  buildAssistantSystemPrompt,
  fallbackAssistantReply,
} from "@/lib/product-knowledge";

export const assistantMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
});

export const assistantRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z.array(assistantMessageSchema).max(12).default([]),
  surface: z.enum(["admin", "site"]).default("site"),
});

export type AssistantRequest = z.infer<typeof assistantRequestSchema>;

export const ASSISTANT_RATE_WINDOW_MS = 20_000;

export function canAskAssistant(
  lastAt: string | null | undefined,
  now = new Date(),
  windowMs = ASSISTANT_RATE_WINDOW_MS,
): boolean {
  if (!lastAt) return true;
  const t = Date.parse(lastAt);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t >= windowMs;
}

export function resolveAssistantApiKey(): string | null {
  const key =
    process.env.ASSISTANT_OPENAI_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.AI_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    "";
  return key.trim() || null;
}

function extractChatReply(result: unknown): string {
  const r = result as {
    choices?: Array<{ message?: { content?: string }; text?: string }>;
  };
  const text =
    r.choices?.[0]?.message?.content || r.choices?.[0]?.text || "";
  return String(text).trim();
}

export async function generateAssistantReply(
  input: AssistantRequest,
  options: {
    apiKey?: string | null;
    productContext?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<{ reply: string; source: "openai" | "knowledge" }> {
  const apiKey =
    options.apiKey === undefined ? resolveAssistantApiKey() : options.apiKey;
  if (!apiKey) {
    return { reply: fallbackAssistantReply(input.message), source: "knowledge" };
  }

  const history = input.history
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content }));

  const { url, model } = resolveAiConfig();
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ASSISTANT_MODEL || model,
        temperature: 0.3,
        max_tokens: 700,
        messages: [
          {
            role: "system",
            content: buildAssistantSystemPrompt(options.productContext),
          },
          ...history,
          { role: "user", content: input.message },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!response.ok) {
      return {
        reply: fallbackAssistantReply(input.message),
        source: "knowledge",
      };
    }
    const result = await response.json();
    const reply = extractChatReply(result);
    if (!reply) {
      return {
        reply: fallbackAssistantReply(input.message),
        source: "knowledge",
      };
    }
    return { reply, source: "openai" };
  } catch {
    return {
      reply: fallbackAssistantReply(input.message),
      source: "knowledge",
    };
  }
}
