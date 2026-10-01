import {jsonLlmFrom, type ChatPrompt, type JsonLlm} from '@/lib/ai-client';
import {projectSchema, type ProjectData} from '@/lib/leads/projects';
import type {DmMessage} from '@/lib/leads/dm-judge';
import type {ScanMessage} from '@/lib/leads/types';

export type ScriptedAnswer = string | Error | ((prompt: ChatPrompt) => string);

/** Text LLM that replays answers in order; JSON parsing/retry goes through the real `jsonLlmFrom`. */
export function scriptedLlm(answers: ScriptedAnswer[], retries = 1): {llm: JsonLlm; calls: ChatPrompt[]} {
  const queue = [...answers];
  const calls: ChatPrompt[] = [];
  const text = async (prompt: ChatPrompt): Promise<string> => {
    calls.push(prompt);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next === undefined) throw new Error('no scripted answer');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(prompt) : next;
  };
  return {llm: jsonLlmFrom(text, retries), calls};
}

/** Ids of the items listed in a judge prompt (`"id":"…"` inside the JSON data block). */
export function idsInPrompt(prompt: ChatPrompt): string[] {
  const block = prompt.user.slice(prompt.user.indexOf('<data>'), prompt.user.indexOf('</data>'));
  return [...block.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1] ?? '');
}

export type FakeVerdict = {isLead: boolean; score: number; reason?: string; projectId?: string | null};

/** Answers every listed id with `pick(id)`. */
export function answerAll(pick: (id: string) => FakeVerdict): (prompt: ChatPrompt) => string {
  return (prompt) =>
    JSON.stringify({
      verdicts: idsInPrompt(prompt).map((id) => {
        const v = pick(id);
        return {id, reason: 'ok', ...v};
      }),
    });
}

export function makeProject(over: Partial<ProjectData> = {}): ProjectData {
  return projectSchema.parse({
    name: 'Uniseller',
    product: 'Сервис синхронизации остатков и цен для селлеров маркетплейсов',
    audience: 'Селлеры WB и Ozon',
    leadCriteria: 'Ищет сервис для учёта остатков',
    notLead: 'Реклама, вакансии',
    keywords: ['остатки', 'мойсклад'],
    stopWords: ['казино'],
    ...over,
  });
}

export const NOW = Date.parse('2026-10-01T12:00:00.000Z');

export function makeMessage(id: string | number, over: Partial<ScanMessage> = {}): ScanMessage {
  return {
    tgMsgId: String(id),
    message: `Подскажите сервис для остатков, сообщение номер ${id}`,
    name: `User ${id}`,
    date: new Date(NOW - 60_000).toISOString(),
    senderId: `u${id}`,
    senderUsername: '',
    senderAccessHash: '',
    messageKind: 'group',
    peerId: '-100500',
    replyToMsgId: '',
    ...over,
  };
}

/** Deterministic PRNG (mulberry32) for property-style loops. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let dmSeq = 0;

export function dm(userId: string, text: string, over: Partial<DmMessage> = {}): DmMessage {
  dmSeq += 1;
  return {
    userId,
    username: `user${userId}`,
    name: `Name ${userId}`,
    text,
    messageId: String(1000 + dmSeq),
    at: new Date(NOW - 60_000 + dmSeq).toISOString(),
    accountId: 'acc1',
    ...over,
  };
}
