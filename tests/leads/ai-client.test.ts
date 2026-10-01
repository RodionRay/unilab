import {afterEach, describe, expect, it, vi} from 'vitest';
import {z} from 'zod';
import {AI_JSON_TIMEOUT_MS, AiJsonError, aiChatJson, jsonLlmFrom, parseAiJson} from '@/lib/ai-client';

const schema = z.object({ok: z.boolean()});

function chatResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({choices: [{message: {content}}]}), {status});
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('aiChatJson', () => {
  it('asks for json_object with a 35 s timeout and validates the answer', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn(async () => chatResponse('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    const out = await aiChatJson(schema, {apiKey: 'k', system: 's', user: 'u'});
    expect(out).toEqual({ok: true});
    expect(AI_JSON_TIMEOUT_MS).toBe(35000);
    expect(timeout).toHaveBeenCalledWith(35000);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.response_format).toEqual({type: 'json_object'});
    expect(body.messages[0]).toEqual({role: 'system', content: 's'});
  });

  it('retries once on an invalid answer, then succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(chatResponse('{"ok":"yes"}')).mockResolvedValueOnce(chatResponse('{"ok":false}'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(aiChatJson(schema, {apiKey: 'k', system: 's', user: 'u'})).resolves.toEqual({ok: false});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws AiJsonError after the retry on HTTP errors', async () => {
    const fetchMock = vi.fn(async () => new Response('rate limit', {status: 429}));
    vi.stubGlobal('fetch', fetchMock);
    const err = await aiChatJson(schema, {apiKey: 'k', system: 's', user: 'u', retries: 1}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiJsonError);
    expect((err as AiJsonError).attempts).toBe(2);
    expect(String((err as Error).message)).toContain('429');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('parseAiJson', () => {
  it('strips markdown fences and rejects non-JSON', () => {
    expect(parseAiJson(schema, '```json\n{"ok":true}\n```')).toEqual({ok: true});
    expect(() => parseAiJson(schema, 'hello')).toThrow(AiJsonError);
    expect(() => parseAiJson(schema, '{"ok":1}')).toThrow(/schema/i);
  });
});

describe('jsonLlmFrom beforeRetry', () => {
  it('runs the hook before each retry; a throwing hook stops without a second call', async () => {
    const text = vi.fn(async () => 'not json');
    const hook = vi.fn(async () => {
      throw new Error('cap');
    });

    await expect(jsonLlmFrom(text, 1, hook)(schema, {system: 's', user: 'u'})).rejects.toThrow('cap');

    expect(text).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith({system: 's', user: 'u'});
  });

  it('a passing hook lets the retry run', async () => {
    const text = vi.fn().mockResolvedValueOnce('bad').mockResolvedValueOnce('{"ok":true}');
    const hook = vi.fn(async () => {});

    await expect(jsonLlmFrom(text, 1, hook)(schema, {system: 's', user: 'u'})).resolves.toEqual({ok: true});
    expect(hook).toHaveBeenCalledTimes(1);
  });
});

