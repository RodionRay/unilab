import {describe, expect, it} from 'vitest';
import {filterMessages, findStopWord, normalizeScanMessage, type FilterContext} from '@/lib/leads/filter';
import {activeAiRejects, rememberAiRejects} from '@/lib/leads/reject-memory';
import {leadMessageFingerprint} from '@/lib/lead-filter';
import {makeMessage, NOW} from './fakes';

const DAY = 24 * 60 * 60 * 1000;

function ctx(over: Partial<FilterContext> = {}): FilterContext {
  return {
    now: NOW,
    scanDepthDays: 7,
    groupId: 'g1',
    knownFingerprints: new Set<string>(),
    tombstones: [],
    aiRejects: {},
    stopWords: ['казино'],
    ...over,
  };
}

const old = new Date(NOW - 8 * DAY).toISOString();

describe('filterMessages order (REQ-6)', () => {
  it('empty id wins over every later step', () => {
    const r = filterMessages([makeMessage('', {message: 'ok', date: old})], ctx());
    expect(r.counts).toMatchObject({skippedErrorApp: 1, old: 0, short: 0});
  });

  it('old wins over short, short over duplicate, duplicate over stopword', () => {
    const known = new Set([leadMessageFingerprint('', 'g1', '3')]);
    const r = filterMessages(
      [
        makeMessage(1, {message: 'коротко', date: old}),
        makeMessage(2, {message: 'коротко'}),
        makeMessage(3, {message: 'казино казино казино казино'}),
        makeMessage(4, {message: 'играю в казино каждый день'}),
        makeMessage(5),
      ],
      ctx({knownFingerprints: known}),
    );
    expect(r.counts).toEqual({skippedErrorApp: 0, old: 1, short: 1, duplicate: 1, stopword: 1});
    expect(r.passed.map((m) => m.tgMsgId)).toEqual(['5']);
  });

  it('counts every drop and keeps at most 3 truncated samples per step', () => {
    const msgs = Array.from({length: 5}, (_, i) => makeMessage(i + 1, {message: `казино ${'x'.repeat(300)} ${i}`}));
    const r = filterMessages(msgs, ctx());
    expect(r.counts.stopword).toBe(5);
    expect(r.samples.stopword).toHaveLength(3);
    expect(r.samples.stopword?.[0]?.term).toBe('казино');
    expect(r.samples.stopword?.[0]?.text.length).toBeLessThanOrEqual(200);
  });

  it('treats a missing or unparseable date as fresh', () => {
    const r = filterMessages([makeMessage(1, {date: ''}), makeMessage(2, {date: 'garbage'})], ctx());
    expect(r.passed).toHaveLength(2);
  });
});

describe('duplicate step', () => {
  it('drops known fingerprints, tombstones, active AI rejects and same sender+text in the run', () => {
    const r = filterMessages(
      [
        makeMessage(1),
        makeMessage(2),
        makeMessage(3),
        makeMessage(4, {senderId: 'same', message: 'Нужен сервис учёта остатков срочно'}),
        makeMessage(5, {senderId: 'same', message: 'нужен   сервис учёта остатков СРОЧНО'}),
        makeMessage(6),
        makeMessage(6),
      ],
      ctx({
        knownFingerprints: new Set([leadMessageFingerprint('', 'g1', '1')]),
        tombstones: ['2'],
        aiRejects: {'3': new Date(NOW + DAY).toISOString()},
      }),
    );
    expect(r.counts.duplicate).toBe(5);
    expect(r.passed.map((m) => m.tgMsgId)).toEqual(['4', '6']);
    expect(r.samples.duplicate?.map((s) => s.reason)).toEqual(['known', 'tombstone', 'ai_reject']);
  });
});

describe('findStopWord (word-start, ru/en)', () => {
  it('matches only at a word start', () => {
    expect(findStopWord('Это наш канал', ['нал'])).toBe('');
    expect(findStopWord('Нужна работа', ['бот'])).toBe('');
    expect(findStopWord('a robot here', ['bot'])).toBe('');
    expect(findStopWord('Казино!', ['казино'])).toBe('казино');
    expect(findStopWord('Crypto, guys', ['crypto'])).toBe('crypto');
  });

  it('normalizes ё and matches phrases across whitespace', () => {
    expect(findStopWord('Большой объём', ['объем'])).toBe('объем');
    expect(findStopWord('Куплю   аккаунт', ['куплю аккаунт'])).toBe('куплю аккаунт');
  });

  it('ignores too short terms and regex metacharacters are literal', () => {
    expect(findStopWord('ab cd', ['ab'])).toBe('');
    expect(findStopWord('a.b.c here', ['a.b'])).toBe('a.b');
    expect(findStopWord('axb here', ['a.b'])).toBe('');
  });
});

describe('normalizeScanMessage', () => {
  it('coerces worker payloads and blanks unknown kinds', () => {
    const m = normalizeScanMessage({tgMsgId: 12, message: 'hi', messageKind: 'channel', senderId: 7});
    expect(m).toMatchObject({tgMsgId: '12', message: 'hi', messageKind: '', senderId: '7', name: ''});
    expect(normalizeScanMessage(null).tgMsgId).toBe('');
  });
});

describe('AI-reject memory (ported from scan-flow semantics)', () => {
  it('keeps unexpired rejects under the same signature only', () => {
    const mem = rememberAiRejects({}, ['1', '2'], 'sig', NOW);
    expect(Object.keys(activeAiRejects(mem, 'sig', NOW + DAY))).toEqual(['1', '2']);
    expect(activeAiRejects(mem, 'other', NOW)).toEqual({});
    expect(activeAiRejects(mem, 'sig', NOW + 8 * DAY)).toEqual({});
    expect(activeAiRejects('garbage', 'sig', NOW)).toEqual({});
  });

  it('caps memory size keeping the newest entries', () => {
    const ids = Array.from({length: 1005}, (_, i) => String(i));
    const mem = rememberAiRejects({}, ids, 'sig', NOW);
    expect(Object.keys(mem.until)).toHaveLength(1000);
  });
});
