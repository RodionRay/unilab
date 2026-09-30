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

const OPENAI_BASE = "https://api.openai.com/v1";
const OPENAI_MODEL = "gpt-4o-mini";

/** A key together with the only endpoint it may be sent to. */
export type AssistantEndpoint = {
  provider: "openai" | "deepseek";
  apiKey: string;
  url: string;
  model: string;
};

function envValue(name: string): string {
  return (process.env[name] || "").trim();
}

function openAiEndpoint(apiKey: string): AssistantEndpoint {
  const base = (envValue("OPENAI_API_BASE") || OPENAI_BASE).replace(/\/$/, "");
  return {
    provider: "openai",
    apiKey,
    url: `${base}/chat/completions`,
    model: envValue("ASSISTANT_MODEL") || OPENAI_MODEL,
  };
}

function deepSeekEndpoint(apiKey: string): AssistantEndpoint {
  const { url, model } = resolveAiConfig();
  return { provider: "deepseek", apiKey, url, model };
}

/**
 * Pairs the assistant key with its provider: OpenAI keys go to OpenAI only, DeepSeek/AI keys to the
 * DeepSeek base (AI_API_BASE). An explicit key (the owner's project key) is a DeepSeek key.
 */
export function resolveAssistantEndpoint(
  explicitKey?: string | null,
): AssistantEndpoint | null {
  if (explicitKey !== undefined) {
    const key = (explicitKey || "").trim();
    return key ? deepSeekEndpoint(key) : null;
  }
  const openAiKey = envValue("ASSISTANT_OPENAI_KEY") || envValue("OPENAI_API_KEY");
  if (openAiKey) return openAiEndpoint(openAiKey);
  const deepSeekKey = envValue("AI_API_KEY") || envValue("DEEPSEEK_API_KEY");
  return deepSeekKey ? deepSeekEndpoint(deepSeekKey) : null;
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
  const endpoint = resolveAssistantEndpoint(options.apiKey);
  if (!endpoint) {
    return { reply: fallbackAssistantReply(input.message), source: "knowledge" };
  }

  const history = input.history
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content }));

  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(endpoint.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${endpoint.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: endpoint.model,
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
      console.warn(
        `[assistant] ${endpoint.provider} HTTP ${response.status}:`,
        (await response.text().catch(() => ""))
          .split(endpoint.apiKey)
          .join("***")
          .slice(0, 200),
      );
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
  } catch (e) {
    console.warn(
      `[assistant] ${endpoint.provider} request failed:`,
      String((e as Error)?.message || e).slice(0, 200),
    );
    return {
      reply: fallbackAssistantReply(input.message),
      source: "knowledge",
    };
  }
}
