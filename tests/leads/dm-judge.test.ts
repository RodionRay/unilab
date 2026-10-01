import {describe, expect, it} from 'vitest';
import {DM_MAX_SENDERS, groupDmSenders, judgeDmSenders} from '@/lib/leads/dm-judge';
import {answerAll, dm, idsInPrompt, makeProject, scriptedLlm} from './fakes';

const projects = [
  {id: 'p1', project: makeProject({name: 'Uniseller'})},
  {id: 'p2', project: makeProject({name: 'Фулфилмент', product: 'Склад фулфилмента', minScore: 70})},
];

describe('groupDmSenders', () => {
  it('groups messages by userId, oldest first, last message id as the unit id', () => {
    const senders = groupDmSenders([
      dm('1', 'второе', {messageId: '11', at: '2026-10-01T10:02:00Z'}),
      dm('2', 'привет', {messageId: '20'}),
      dm('1', 'первое', {messageId: '10', at: '2026-10-01T10:01:00Z'}),
    ]);
    expect(senders).toHaveLength(2);
    expect(senders[0]).toMatchObject({userId: '1', lastMessageId: '11', text: 'первое\nвторое'});
    expect(senders[0]?.messages).toHaveLength(2);
    expect(senders[1]?.userId).toBe('2');
  });

  it('drops messages without a userId', () => {
    expect(groupDmSenders([dm('', 'x')])).toEqual([]);
  });
});

describe('judgeDmSenders (REQ-15, REQ-16)', () => {
  it('judges all senders in one call with every active project card', async () => {
    const {llm, calls} = scriptedLlm([answerAll((id) => ({isLead: id === '1', score: 80, projectId: 'p1'}))]);
    const senders = groupDmSenders([dm('1', 'Нужен учёт остатков'), dm('1', 'для WB'), dm('2', 'Привет, как дела у вас')]);
    const r = await judgeDmSenders(projects, senders, llm);
    expect(calls).toHaveLength(1);
    expect(idsInPrompt(calls[0]!)).toEqual(['1', '2']);
    expect(calls[0]!.system + calls[0]!.user).toContain('Фулфилмент');
    expect(calls[0]!.system + calls[0]!.user).toContain('"p2"');
    expect(r.judged.map((j) => [j.sender.userId, j.verdict.projectId])).toEqual([
      ['1', 'p1'],
      ['2', 'p1'],
    ]);
  });

  it('senders over 20 are skipped, still one call', async () => {
    const {llm, calls} = scriptedLlm([answerAll(() => ({isLead: false, score: 0, projectId: null}))]);
    const senders = groupDmSenders(Array.from({length: DM_MAX_SENDERS + 1}, (_, i) => dm(String(i + 1), 'Нужен сервис учёта')));
    const r = await judgeDmSenders(projects, senders, llm);
    expect(calls).toHaveLength(1);
    expect(r.judged).toHaveLength(20);
    expect(r.unjudged).toEqual([expect.objectContaining({step: 'judgeSkipped', reason: 'sender_limit'})]);
  });

  it('unknown project ids read as null and missing senders as no verdict', async () => {
    const {llm} = scriptedLlm([JSON.stringify({verdicts: [{id: '1', projectId: 'nope', score: 99, reason: 'x'}]})]);
    const r = await judgeDmSenders(projects, groupDmSenders([dm('1', 'aaa'), dm('2', 'bbb')]), llm);
    expect(r.judged.map((j) => j.verdict.projectId)).toEqual([null, null]);
    expect(r.judged[1]?.verdict.reason).toBe('нет вердикта');
  });

  it('a failed call marks every sender judgeError; no key marks them judgeSkipped', async () => {
    const {llm} = scriptedLlm(['broken']);
    const senders = groupDmSenders([dm('1', 'aaa'), dm('2', 'bbb')]);
    const failed = await judgeDmSenders(projects, senders, llm);
    expect(failed.unjudged.map((u) => u.step)).toEqual(['judgeError', 'judgeError']);
    expect(failed.error).not.toBe('');
    const skipped = await judgeDmSenders(projects, senders, null);
    expect(skipped.unjudged.map((u) => u.reason)).toEqual(['no_ai_key', 'no_ai_key']);
    const capped = await judgeDmSenders(projects, senders, llm, {gate: async () => false});
    expect(capped.unjudged.map((u) => u.reason)).toEqual(['daily_cap', 'daily_cap']);
  });

  it('no active project means nothing to judge against', async () => {
    const {llm, calls} = scriptedLlm([answerAll(() => ({isLead: true, score: 99, projectId: 'p1'}))]);
    const r = await judgeDmSenders([], groupDmSenders([dm('1', 'aaa')]), llm);
    expect(calls).toHaveLength(0);
    expect(r.unjudged[0]?.reason).toBe('no_project');
  });
});
