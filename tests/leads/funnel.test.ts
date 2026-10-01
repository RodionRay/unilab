import {describe, expect, it} from 'vitest';
import {createTestD1} from '../helpers/d1-sqlite';
import {
  MAX_RUNS,
  addSample,
  aggregateFunnel,
  dayKey,
  emptyCounts,
  mergeScanDay,
  readFunnel,
  scanDayId,
  upsertScanDay,
} from '@/lib/leads/funnel';
import type {FunnelSamples, ScanDelta} from '@/lib/leads/types';
import {NOW} from './fakes';

const DAY = 24 * 60 * 60 * 1000;

function delta(over: Partial<ScanDelta['counts']> = {}, samples: FunnelSamples = {}, run = 'run'): ScanDelta {
  return {counts: {...emptyCounts(), ...over}, samples, run};
}

describe('scan_day keys', () => {
  it('uses the UTC day and the contract id', () => {
    expect(dayKey(Date.parse('2026-10-01T23:59:59Z'))).toBe('2026-10-01');
    expect(scanDayId('p1', '2026-10-01')).toBe('scan-day:p1:2026-10-01');
  });
});

describe('mergeScanDay', () => {
  it('sums counters, keeps the last 3 samples per step and the last 20 runs', () => {
    let row = mergeScanDay(null, delta({fetched: 5, short: 2}, {short: [{text: 'a'}, {text: 'b'}]}, 'r0'), 'p1', '2026-10-01');
    row = mergeScanDay(row, delta({fetched: 3, short: 1}, {short: [{text: 'c'}, {text: 'd'}]}, 'r1'), 'p1', '2026-10-01');
    expect(row.counts.fetched).toBe(8);
    expect(row.counts.short).toBe(3);
    expect(row.samples.short?.map((s) => s.text)).toEqual(['b', 'c', 'd']);
    for (let i = 2; i < 30; i++) row = mergeScanDay(row, delta({}, {}, `r${i}`), 'p1', '2026-10-01');
    expect(row.runs).toHaveLength(MAX_RUNS);
    expect(row.runs.at(-1)).toBe('r29');
    expect(row).toMatchObject({projectId: 'p1', day: '2026-10-01'});
  });

  it('treats garbage stored data as an empty row and truncates texts', () => {
    const row = mergeScanDay(
      {counts: {fetched: 'x', short: -3}, samples: {short: 'bad'}, runs: 'no'},
      delta({fetched: 1}, {old: [{text: 'y'.repeat(500), reason: 'r'.repeat(500)}]}, 'z'.repeat(500)),
      'p1',
      'd',
    );
    expect(row.counts.fetched).toBe(1);
    expect(row.counts.short).toBe(0);
    expect(row.samples.old?.[0]?.text).toHaveLength(200);
    expect(row.samples.old?.[0]?.reason).toHaveLength(200);
    expect(row.runs[0]).toHaveLength(200);
  });
});

describe('addSample', () => {
  it('keeps the first 3 samples of a run, truncated', () => {
    const s: FunnelSamples = {};
    for (let i = 0; i < 5; i++) addSample(s, 'stopword', {text: `t${i}`.padEnd(300, '.'), term: 'казино'});
    expect(s.stopword).toHaveLength(3);
    expect(s.stopword?.[0]?.text).toHaveLength(200);
  });
});

describe('aggregateFunnel', () => {
  it('sums rows within the requested window only', () => {
    const today = dayKey(NOW);
    const yesterday = dayKey(NOW - DAY);
    const old = dayKey(NOW - 10 * DAY);
    const rows = [
      mergeScanDay(null, delta({fetched: 1}, {short: [{text: 'today'}]}, 'a'), 'p1', today),
      mergeScanDay(null, delta({fetched: 10}, {short: [{text: 'yday'}]}, 'b'), 'p1', yesterday),
      mergeScanDay(null, delta({fetched: 100}), 'p1', old),
    ];
    expect(aggregateFunnel(rows, 1, NOW).counts.fetched).toBe(1);
    const week = aggregateFunnel(rows, 7, NOW);
    expect(week.counts.fetched).toBe(11);
    expect(week.samples.short?.map((s) => s.text)).toEqual(['yday', 'today']);
    expect(week.runs).toEqual(['b', 'a']);
    expect(week.days).toBe(7);
  });
});

describe('upsertScanDay / readFunnel (D1 fake)', () => {
  it('creates then merges one row per project per day, owner-scoped', async () => {
    const {db, sqlite} = createTestD1();
    await upsertScanDay(db, 'o1', 'p1', delta({fetched: 2}, {}, 'first'), NOW);
    await Promise.all([
      upsertScanDay(db, 'o1', 'p1', delta({fetched: 3}, {}, 'second'), NOW),
      upsertScanDay(db, 'o1', 'p1', delta({fetched: 4}, {}, 'third'), NOW),
    ]);
    const rows = sqlite.prepare("SELECT id, owner, kind FROM records WHERE kind='scan_day'").all();
    expect(rows).toEqual([{id: scanDayId('p1', dayKey(NOW)), owner: 'o1', kind: 'scan_day'}]);
    const view = await readFunnel(db, 'o1', 'p1', 1, NOW);
    expect(view.counts.fetched).toBe(9);
    expect(view.runs).toHaveLength(3);
    const foreign = await readFunnel(db, 'o2', 'p1', 7, NOW);
    expect(foreign.counts.fetched).toBe(0);
  });

  it('never overwrites a same-id row of another owner', async () => {
    const {db, sqlite} = createTestD1();
    await upsertScanDay(db, 'o1', 'p1', delta({fetched: 2}), NOW);
    await expect(upsertScanDay(db, 'o2', 'p1', delta({fetched: 5}), NOW)).rejects.toThrow();
    const row = sqlite.prepare('SELECT owner, data FROM records').get() as {owner: string; data: string};
    expect(row.owner).toBe('o1');
    expect(JSON.parse(row.data).counts.fetched).toBe(2);
  });
});
