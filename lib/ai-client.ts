import type { z } from "zod";
import { readEnv } from "@/lib/auth";

/** DeepSeek подключён в коде. Настройки провайдера в UI не нужны. */

const DEEPSEEK_BASE = "https://api.deepseek.com";
const DEEPSEEK_MODEL = "deepseek-chat";
const TEXT_TIMEOUT_MS = 90000;
/** Judge / JSON calls (lead core v2 REQ-8): one call never blocks a scan longer than this. */
export const AI_JSON_TIMEOUT_MS = 35000;

export type AiSettings = {
  provider?: string;
  apiBase?: string;
  model?: string;
};

export type ChatPrompt = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
};

/** Raw text completion; injected into lib/leads so tests run without network. */
export type TextLlm = (prompt: ChatPrompt) => Promise<string>;

/** Completion parsed and validated by `schema`; throws AiJsonError when it cannot be. */
export type JsonLlm = <T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  prompt: ChatPrompt,
) => Promise<T>;

export class AiJsonError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
  ) {
    super(message);
    this.name = "AiJsonError";
  }
}

export function resolveAiConfig(_settings?: AiSettings) {
  const apiBase = (
    readEnv("AI_API_BASE") ||
    DEEPSEEK_BASE
  ).replace(/\/$/, "");
  const model = readEnv("AI_MODEL") || DEEPSEEK_MODEL;
  return {
    provider: "deepseek" as const,
    apiBase,
    model,
    url: `${apiBase}/chat/completions`,
  };
}

type ChatRequest = ChatPrompt & {
  apiKey: string;
  settings?: AiSettings;
  timeoutMs: number;
  json: boolean;
};

async function postChat(req: ChatRequest): Promise<string> {
  const { url, model } = resolveAiConfig(req.settings);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${req.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: req.temperature ?? 0.3,
      max_tokens: req.maxTokens ?? 1200,
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    }),
    signal: AbortSignal.timeout(req.timeoutMs),
  });
  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(
      `DeepSeek ${response.status}: ${(err || response.statusText).slice(0, 240)}`,
    );
  }
  const result = (await response.json()) as {
    choices?: { message?: { content?: unknown }; text?: unknown }[];
  };
  const text =
    result.choices?.[0]?.message?.content ||
    result.choices?.[0]?.text ||
    "";
  return String(text).trim();
}

export async function aiChatText(opts: {
  apiKey: string;
  settings?: AiSettings;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  return postChat({ ...opts, timeoutMs: TEXT_TIMEOUT_MS, json: false });
}

const FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

/** Parses a model answer as JSON (markdown fence tolerated) and validates it; never returns unvalidated data. */
export function parseAiJson<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  text: string,
  attempts = 1,
): T {
  const body = text.trim().replace(FENCE_RE, "$1");
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new AiJsonError("AI: answer is not valid JSON", attempts);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue ? `${issue.path.join(".")}: ${issue.message}` : "";
    throw new AiJsonError(`AI: answer fails the schema (${where})`.slice(0, 240), attempts);
  }
  return parsed.data;
}

/** JSON LLM over any text LLM: a call error or an invalid answer is retried `retries` times. */
export function jsonLlmFrom(text: TextLlm, retries = 1): JsonLlm {
  return async (schema, prompt) => {
    let lastError = "";
    const attempts = retries + 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return parseAiJson(schema, await text(prompt), attempt);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    throw new AiJsonError(lastError.slice(0, 240), attempts);
  };
}

/** DeepSeek text LLM in JSON mode (`response_format: json_object`). */
export function deepseekJsonText(opts: {
  apiKey: string;
  settings?: AiSettings;
  timeoutMs?: number;
}): TextLlm {
  return (prompt) =>
    postChat({
      ...prompt,
      apiKey: opts.apiKey,
      settings: opts.settings,
      timeoutMs: opts.timeoutMs ?? AI_JSON_TIMEOUT_MS,
      json: true,
    });
}

export async function aiChatJson<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  opts: ChatPrompt & {
    apiKey: string;
    settings?: AiSettings;
    timeoutMs?: number;
    retries?: number;
  },
): Promise<T> {
  const text = deepseekJsonText(opts);
  return jsonLlmFrom(text, opts.retries ?? 1)(schema, opts);
}

export function envAiApiKey(): string {
  return (
    readEnv("AI_API_KEY") ||
    readEnv("DEEPSEEK_API_KEY") ||
    ""
  );
}
