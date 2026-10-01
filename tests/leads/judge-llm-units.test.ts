import {afterEach, describe, expect, it, vi} from 'vitest';
import {z} from 'zod';
import {judgeLlm} from '@/lib/processes/lead-scan';
import {judgeMessages} from '@/lib/leads/judge';
import {judgeDmSenders} from '@/lib/leads/dm-judge';
import type {JudgeLlm} from '@/lib/leads/types';
import {makeMessage, makeProject, dm} from './fakes';
import {groupDmSenders} from '@/lib/leads/dm-judge';

const llmText = (content: string) => Response.json({choices: [{message: {content}}]});

describe('judge LLM retry cap gets the unit count explicitly (no prompt parsing)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('the retry reserves exactly the units passed by the caller', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++n === 1 ? new Response('down', {status: 503}) : llmText('{"ok":true}'))));
    const gate = vi.fn(async () => true);
    const llm = judgeLlm('sk-test', gate);
    // A prompt with no <data> block: the count can only come from the argument.
    const out = await llm!(z.object({ok: z.boolean()}), {system: 's', user: 'u'}, 7);
    expect(out).toEqual({ok: true});
    expect(gate).toHaveBeenCalledWith(7);
  });

  it('no room for the retry fails the call without a second request', async () => {
    const fetchMock = vi.fn(async () => new Response('down', {status: 503}));
    vi.stubGlobal('fetch', fetchMock);
    const llm = judgeLlm('sk-test', async () => false);
    await expect(llm!(z.object({}), {system: 's', user: 'u'}, 3)).rejects.toThrow(/daily judge cap/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('group and DM judges pass their batch sizes', async () => {
    const units: number[] = [];
    const llm: JudgeLlm = async (_schema, _prompt, count) => {
      units.push(count);
      throw new Error('stop');
    };
    await judgeMessages(makeProject(), [makeMessage(1), makeMessage(2), makeMessage(3)], llm);
    await judgeDmSenders([{id: 'p1', project: makeProject()}], groupDmSenders([dm('1', 'Нужен сервис'), dm('2', 'Ищу склад')]), llm);
    expect(units).toEqual([3, 2]);
  });
});
