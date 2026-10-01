import {describe, expect, it} from 'vitest';
import {buildDraftPrompt, buildGroupJudgePrompt, DRAFT_THREAD_LIMIT} from '@/lib/leads/prompt';
import {generateDraft} from '@/lib/leads/draft';
import type {ChatPrompt} from '@/lib/ai-client';
import {makeMessage, makeProject} from './fakes';

const replies = Array.from({length: 15}, (_, i) => ({
  text: `реплика ${i}`,
  from: i % 2 ? ('us' as const) : ('client' as const),
  at: `2026-10-01T10:${String(i).padStart(2, '0')}:00Z`,
}));

const lead = {name: 'Иван', message: 'Ищу сервис учёта остатков', source: 'Селлеры WB', replies};

describe('buildDraftPrompt (REQ-17)', () => {
  it('uses the project card and only the last 12 thread entries', () => {
    const p = buildDraftPrompt('dm_continue', makeProject({tone: 'на ты', cta: 'созвон'}), lead);
    expect(DRAFT_THREAD_LIMIT).toBe(12);
    expect(p.user).not.toContain('реплика 2"');
    expect(p.user).toContain('реплика 3');
    expect(p.user).toContain('реплика 14');
    expect(p.system + p.user).toContain('на ты');
    expect(p.system + p.user).toContain('созвон');
    expect(p.system).toMatch(/недоверенн/i);
  });

  it('gives each kind its own instruction', () => {
    const project = makeProject();
    const kinds = ['group_reply', 'dm_first', 'dm_continue'] as const;
    const systems = kinds.map((k) => buildDraftPrompt(k, project, lead).system);
    expect(new Set(systems).size).toBe(3);
    expect(systems[0]).toMatch(/групп/i);
    expect(systems[1]).toMatch(/перв/i);
  });
});

describe('buildGroupJudgePrompt', () => {
  it('lists messages as escaped JSON data and caps examples at 10', () => {
    const many = Array.from({length: 14}, (_, i) => `пример ${i}`);
    const project = {...makeProject(), goodExamples: many, badExamples: many};
    const p = buildGroupJudgePrompt(project, [makeMessage(1, {message: 'a <b> "c"'})]);
    expect(p.user).toContain('\\u003cb>');
    expect(p.system + p.user).not.toContain('пример 10');
  });
});

describe('generateDraft', () => {
  it('returns the cleaned model text', async () => {
    let seen: ChatPrompt | null = null;
    const text = async (prompt: ChatPrompt) => {
      seen = prompt;
      return '  «Здравствуйте, Иван! Подскажу по остаткам.»  ';
    };
    const draft = await generateDraft('dm_first', makeProject(), lead, text);
    expect(draft).toBe('Здравствуйте, Иван! Подскажу по остаткам.');
    expect(seen).not.toBeNull();
  });

  it('throws on an empty answer and caps length', async () => {
    await expect(generateDraft('dm_first', makeProject(), lead, async () => '   ')).rejects.toThrow();
    const long = await generateDraft('group_reply', makeProject(), lead, async () => 'x'.repeat(5000));
    expect(long.length).toBeLessThanOrEqual(1500);
  });
});
