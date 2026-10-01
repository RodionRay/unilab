import {describe, expect, it} from 'vitest';
import {createTestD1} from '../helpers/d1-sqlite';
import {
  MAX_STOP_WORDS,
  addFeedbackExample,
  applyProjectPatch,
  defaultProjectFromSettings,
  defaultProjectId,
  ensureDefaultProject,
  projectIdOf,
  projectPatchSchema,
  projectSchema,
  projectSignature,
  uuidv5,
} from '@/lib/leads/projects';
import {makeProject, NOW} from './fakes';

describe('uuidv5', () => {
  it('matches the RFC 4122 test vector', () => {
    expect(uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });

  it('gives each owner a stable, distinct version-5 default project id', () => {
    const a = defaultProjectId('owner-a');
    expect(defaultProjectId('owner-a')).toBe(a);
    expect(defaultProjectId('owner-b')).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('projectSchema', () => {
  it('fills the contract defaults', () => {
    const p = projectSchema.parse({name: 'P'});
    expect(p).toMatchObject({minScore: 50, scanDepthDays: 7, autoDraft: true, active: true, keywords: [], stopWords: []});
  });

  it('rejects over-limit lists and out-of-range numbers', () => {
    const many = (n: number) => Array.from({length: n}, (_, i) => `w${i}`);
    expect(projectSchema.safeParse({name: 'P', keywords: many(31)}).success).toBe(false);
    expect(projectSchema.safeParse({name: 'P', stopWords: many(51)}).success).toBe(false);
    expect(projectSchema.safeParse({name: 'P', goodExamples: many(11)}).success).toBe(false);
    expect(projectSchema.safeParse({name: 'P', minScore: 101}).success).toBe(false);
    expect(projectSchema.safeParse({name: 'P', scanDepthDays: 31}).success).toBe(false);
  });

  it('patch schema is partial and strict', () => {
    expect(projectPatchSchema.safeParse({minScore: 70}).success).toBe(true);
    expect(projectPatchSchema.safeParse({owner: 'x'}).success).toBe(false);
    expect(projectPatchSchema.safeParse({minScore: -1}).success).toBe(false);
  });

  it('applies a field patch without touching other fields', () => {
    const p = makeProject();
    const next = applyProjectPatch(p, {minScore: 70}, NOW);
    expect(next.minScore).toBe(70);
    expect(next.product).toBe(p.product);
    expect(next.updatedAt).toBe(new Date(NOW).toISOString());
  });
});

describe('defaultProjectFromSettings', () => {
  it('maps settings into the project card', () => {
    const p = defaultProjectFromSettings(
      {
        name: 'Uniseller',
        projectUrl: 'https://uniseller.io',
        product: 'Синхронизация остатков',
        audience: 'Селлеры',
        leadCriteria: 'Ищет учёт',
        avoidTopics: 'Вакансии',
        valueProps: 'Экономит время',
        tone: 'дружелюбно',
        cta: 'демо',
        keywords: 'остатки, мойсклад',
        minusKeywords: 'казино, таро',
        scanDepthDays: 90,
      },
      NOW,
    );
    expect(p).toMatchObject({
      name: 'Uniseller',
      url: 'https://uniseller.io',
      notLead: 'Вакансии',
      keywords: ['остатки', 'мойсклад'],
      stopWords: ['казино', 'таро'],
      scanDepthDays: 30,
      minScore: 50,
    });
  });

  it('drops stop words that are product words and caps the list at 50', () => {
    const minus = ['остатк', 'Синхронизация', ...Array.from({length: 70}, (_, i) => `junk${i}`)].join(', ');
    const p = defaultProjectFromSettings({product: 'Синхронизация остатков на WB', minusKeywords: minus}, NOW);
    expect(p.stopWords).not.toContain('остатк');
    expect(p.stopWords).not.toContain('синхронизация');
    expect(p.stopWords).toHaveLength(MAX_STOP_WORDS);
    expect(p.name).toBe('Основной проект');
  });

  it('survives empty or garbage settings', () => {
    expect(() => defaultProjectFromSettings({}, NOW)).not.toThrow();
    expect(() => defaultProjectFromSettings({keywords: 42, minusKeywords: null}, NOW)).not.toThrow();
  });
});

describe('project helpers', () => {
  it('reads a missing projectId as the default project', () => {
    expect(projectIdOf({}, 'o1')).toBe(defaultProjectId('o1'));
    expect(projectIdOf({projectId: ''}, 'o1')).toBe(defaultProjectId('o1'));
    expect(projectIdOf({projectId: 'p-2'}, 'o1')).toBe('p-2');
  });

  it('signature follows judge fields only', () => {
    const p = makeProject();
    expect(projectSignature({...p, tone: 'строго', cta: 'x', autoDraft: false})).toBe(projectSignature(p));
    expect(projectSignature({...p, leadCriteria: 'другое'})).not.toBe(projectSignature(p));
    expect(projectSignature({...p, goodExamples: ['a']})).not.toBe(projectSignature(p));
  });

  it('feedback adds FIFO examples (≤10, ≤300 chars) and never touches stop words', () => {
    let p = makeProject();
    for (let i = 0; i < 12; i++) p = addFeedbackExample(p, 'good', `пример ${i}`);
    expect(p.goodExamples).toHaveLength(10);
    expect(p.goodExamples[0]).toBe('пример 2');
    expect(p.goodExamples[9]).toBe('пример 11');
    p = addFeedbackExample(p, 'bad', 'x'.repeat(500));
    expect(p.badExamples[0]).toHaveLength(300);
    p = addFeedbackExample(p, 'bad', 'x'.repeat(500));
    expect(p.badExamples).toHaveLength(1);
    expect(p.stopWords).toEqual(['казино']);
  });
});

describe('ensureDefaultProject', () => {
  it('lazily creates the default project once and never overwrites it', async () => {
    const {db, sqlite} = createTestD1();
    const first = await ensureDefaultProject(db, 'o1', {name: 'Shop', product: 'p'}, NOW);
    expect(first.id).toBe(defaultProjectId('o1'));
    expect(first.project.name).toBe('Shop');
    const second = await ensureDefaultProject(db, 'o1', {name: 'Changed'}, NOW);
    expect(second.project.name).toBe('Shop');
    const rows = sqlite.prepare("SELECT owner, kind FROM records WHERE kind='project'").all();
    expect(rows).toEqual([{owner: 'o1', kind: 'project'}]);
  });
});
