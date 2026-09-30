import { readEnv } from "@/lib/auth";

/** DeepSeek подключён в коде. Настройки провайдера в UI не нужны. */

const DEEPSEEK_BASE = "https://api.deepseek.com";
const DEEPSEEK_MODEL = "deepseek-chat";

export type AiSettings = {
  provider?: string;
  apiBase?: string;
  model?: string;
};

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

export async function aiChatText(opts: {
  apiKey: string;
  settings?: AiSettings;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const { url, model } = resolveAiConfig(opts.settings);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 1200,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(
      `DeepSeek ${response.status}: ${(err || response.statusText).slice(0, 240)}`,
    );
  }
  const result: any = await response.json();
  const text =
    result.choices?.[0]?.message?.content ||
    result.choices?.[0]?.text ||
    "";
  return String(text).trim();
}

export function envAiApiKey(): string {
  return (
    readEnv("AI_API_KEY") ||
    readEnv("DEEPSEEK_API_KEY") ||
    ""
  );
}
