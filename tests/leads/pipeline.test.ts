import {describe, expect, it} from 'vitest';
import {nextScanCursor, runDmJudge, runGroupScan, type DmJudgeDeps, type GroupScanDeps} from '@/lib/leads/pipeline';
import {activeAiRejects} from '@/lib/leads/reject-memory';
import {projectSignature} from '@/lib/leads/projects';
import type {FunnelCounts, ScanMessage} from '@/lib/leads/types';
import type {JsonLlm} from '@/lib/ai-client';
import {answerAll, dm, makeMessage, makeProject, NOW, prng, scriptedLlm, type ScriptedAnswer} from './fakes';

const DAY = 24 * 60 * 60 * 1000;

function groupDeps(messages: ScanMessage[], llm: JsonLlm | null, over: Partial<GroupScanDeps> = {}): GroupScanDeps {
  return {
    projectId: 'p1',
    project: makeProject(),
    group: {id: 'g1', name: 'Селлеры WB', accountId: 'acc1', scanCursor: '5', aiRejected: null, leadTombstones: []},
    worker: {messages, fetched: messages.length, skippedNotUser: 0, skippedOld: 0, skippedError: 0, cursor: '900', scanMode: 'group_messages'},
    knownFingerprints: new Set(),
    llm,
    now: () => NOW,
    notifyEnabled: true,
    ...over,
  };
}

function expectInvariant(c: FunnelCounts) {
  expect(c.fetched).toBe(c.skippedNotUser + c.skippedOldWorker + c.skippedError + c.returned);
  expect(c.returned).toBe(
    c.skippedErrorApp + c.old + c.short + c.duplicate + c.stopword + c.judgeSkipped + c.judgeError + c.rejected + c.leads,
  );
  expect(c.judged).toBe(c.rejected + c.leads);
}

describe('runGroupScan', () => {
  it('turns verdicts into leads (hot ≥80, warm ≥minScore) and remembers rejects', async () => {
    const scores: Record<string, number> = {'10': 90, '11': 60, '12': 40, '13': 85};
    const {llm} = scriptedLlm([
      answerAll((id) => ({isLead: id !== '13', score: scores[id] ?? 0, reason: `r${id}`})),
    ]);
    const msgs = [makeMessage(10), makeMessage(11), makeMessage(12), makeMessage(13), makeMessage(14, {message: 'кратко'})];
    const deps = groupDeps(msgs, llm, {
      worker: {messages: msgs, fetched: 9, skippedNotUser: 2, skippedOld: 1, skippedError: 1, cursor: '900'},
    });
    const r = await runGroupScan(deps);
    expect(r.leads.map((l) => [l.tgMsgId, l.temperature, l.score])).toEqual([
      ['10', 'hot', 90],
      ['11', 'warm', 60],
    ]);
    expect(r.leads[0]).toMatchObject({
      projectId: 'p1',
      groupId: 'g1',
      sourceKind: 'group',
      reason: 'r10',
      accountId: 'acc1',
      status: 'new',
      notifyPending: true,
      source: 'Селлеры WB',
      replies: [],
    });
    expect(r.delta.counts).toMatchObject({fetched: 9, returned: 5, short: 1, judged: 4, leads: 2, rejected: 2});
    expectInvariant(r.delta.counts);
    expect(Object.keys(activeAiRejects(r.aiRejected, projectSignature(deps.project), NOW)).sort()).toEqual(['12', '13']);
    expect(r.nextCursor).toBe('900');
    expect(r.delta.run.length).toBeLessThanOrEqual(200);
    expect(r.delta.samples.leads?.[0]?.text).toContain('сообщение номер 10');
  });

  it('respects project minScore and scanDepthDays', async () => {
    const {llm} = scriptedLlm([answerAll(() => ({isLead: true, score: 70}))]);
    const msgs = [makeMessage(1), makeMessage(2, {date: new Date(NOW - 2 * DAY).toISOString()})];
    const r = await runGroupScan(groupDeps(msgs, llm, {project: makeProject({minScore: 75, scanDepthDays: 1})}));
    expect(r.leads).toHaveLength(0);
    expect(r.delta.counts).toMatchObject({old: 1, rejected: 1});
  });

  it('skips known messages, tombstones and remembered rejects before the judge', async () => {
    const {llm, calls} = scriptedLlm([answerAll(() => ({isLead: false, score: 0}))]);
    const first = await runGroupScan(groupDeps([makeMessage(1), makeMessage(2)], llm));
    const again = await runGroupScan(
      groupDeps([makeMessage(1), makeMessage(2), makeMessage(3)], llm, {
        group: {id: 'g1', name: 'G', accountId: '', scanCursor: '', aiRejected: first.aiRejected, leadTombstones: ['3']},
      }),
    );
    expect(calls).toHaveLength(1);
    expect(again.delta.counts.duplicate).toBe(3);
  });

  it('records the comment kind as sourceKind and blank kinds as group', async () => {
    const {llm} = scriptedLlm([answerAll(() => ({isLead: true, score: 99}))]);
    const r = await runGroupScan(
      groupDeps([makeMessage(1, {messageKind: 'comment'}), makeMessage(2, {messageKind: ''})], llm),
    );
    expect(r.leads.map((l) => l.sourceKind)).toEqual(['comment', 'group']);
  });
});

describe('cursor rewind (REQ-10)', () => {
  it('rewinds to firstUnjudgedId − 1 when batch 2 fails', async () => {
    const {llm} = scriptedLlm([answerAll(() => ({isLead: false, score: 1})), 'bad', 'bad']);
    const msgs = Array.from({length: 30}, (_, i) => makeMessage(101 + i));
    const r = await runGroupScan(groupDeps(msgs, llm));
    expect(r.nextCursor).toBe('120');
    expect(r.judgeError).not.toBe('');
    expect(r.delta.counts).toMatchObject({judgeError: 10, rejected: 20});
    expectInvariant(r.delta.counts);
  });

  it('ignores comment ids: only group/discussion ids reach the cursor', async () => {
    const {llm} = scriptedLlm(['bad']);
    const msgs = [
      makeMessage(5000, {messageKind: 'comment'}),
      makeMessage(300, {messageKind: 'discussion'}),
      makeMessage(301, {messageKind: 'discussion'}),
    ];
    const r = await runGroupScan(groupDeps(msgs, llm));
    expect(r.nextCursor).toBe('299');
    const onlyComments = await runGroupScan(groupDeps([makeMessage(5000, {messageKind: 'comment'})], llm));
    expect(onlyComments.nextCursor).toBe('900');
  });

  it('no AI key rewinds too (no non-LLM fallback)', async () => {
    const r = await runGroupScan(groupDeps([makeMessage(50), makeMessage(51)], null));
    expect(r.leads).toHaveLength(0);
    expect(r.nextCursor).toBe('49');
    expect(r.delta.counts.judgeSkipped).toBe(2);
    expect(r.delta.samples.judgeSkipped?.[0]?.reason).toBe('no_ai_key');
  });

  it('nextScanCursor keeps the previous cursor when the worker gave none', () => {
    expect(nextScanCursor('', '42', [])).toBe('42');
    expect(nextScanCursor('', '', [])).toBe('');
    expect(nextScanCursor('900', '42', [makeMessage(1)])).toBe('0');
  });
});

describe('REQ-13 funnel invariant (property loop)', () => {
  it('holds for random inputs and judge behaviours', async () => {
    const rnd = prng(20261001);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    for (let iter = 0; iter < 150; iter++) {
      const n = Math.floor(rnd() * 100);
      const msgs: ScanMessage[] = [];
      for (let i = 0; i < n; i++) {
        const id = String(1 + Math.floor(rnd() * 120));
        const variant = pick(['ok', 'ok', 'ok', 'empty', 'old', 'short', 'stop', 'comment', 'dupText'] as const);
        msgs.push(
          makeMessage(id, {
            tgMsgId: variant === 'empty' ? '' : id,
            date: variant === 'old' ? new Date(NOW - 30 * DAY).toISOString() : new Date(NOW - 1000).toISOString(),
            message:
              variant === 'short' ? 'мало' : variant === 'stop' ? 'Лучшее казино города тут' : variant === 'dupText' ? 'Повтор одинакового текста' : `Текст ${id} про остатки`,
            senderId: variant === 'dupText' ? 'same' : `u${id}`,
            messageKind: variant === 'comment' ? 'comment' : 'group',
          }),
        );
      }
      const behaviour = pick(['ok', 'fail2', 'throw', 'nokey', 'cap'] as const);
      const answers: ScriptedAnswer[] =
        behaviour === 'fail2'
          ? [answerAll(() => ({isLead: rnd() > 0.5, score: Math.floor(rnd() * 101)})), 'x', 'y']
          : behaviour === 'throw'
            ? [new Error('timeout')]
            : [answerAll(() => ({isLead: rnd() > 0.5, score: Math.floor(rnd() * 101)}))];
      const {llm} = scriptedLlm(answers);
      let budget = 40;
      const gate = async (count: number) => {
        budget -= count;
        return behaviour !== 'cap' || budget >= 0;
      };
      const notUser = Math.floor(rnd() * 5);
      const oldW = Math.floor(rnd() * 5);
      const errW = Math.floor(rnd() * 5);
      const r = await runGroupScan(
        groupDeps(msgs, behaviour === 'nokey' ? null : llm, {
          gate,
          worker: {messages: msgs, fetched: msgs.length + notUser + oldW + errW, skippedNotUser: notUser, skippedOld: oldW, skippedError: errW, cursor: '500'},
          knownFingerprints: new Set(['g1:7', 'g1:8']),
        }),
      );
      expectInvariant(r.delta.counts);
      expect(r.delta.counts.returned).toBe(msgs.length);
      expect(r.leads).toHaveLength(r.delta.counts.leads);
    }
  });
});

describe('runDmJudge (REQ-15, REQ-16)', () => {
  const projects = [
    {id: 'p1', project: makeProject({stopWords: ['казино', 'таро']})},
    {id: 'p2', project: makeProject({name: 'Склад', minScore: 90, stopWords: ['таро']})},
  ];

  function dmDeps(messages: DmJudgeDeps['messages'], llm: JsonLlm | null, over: Partial<DmJudgeDeps> = {}): DmJudgeDeps {
    return {
      projects,
      funnelProjectId: 'p1',
      messages,
      ownAccounts: {userIds: new Set(['999']), usernames: new Set(['ourbot'])},
      knownSenderIds: new Set(),
      aiRejected: null,
      llm,
      now: () => NOW,
      notifyEnabled: false,
      ...over,
    };
  }

  it('groups by userId, ignores own accounts, judges in one call and opens DM leads', async () => {
    const {llm, calls} = scriptedLlm([
      answerAll((id) => (id === '1' ? {isLead: true, score: 85, projectId: 'p1'} : {isLead: true, score: 80, projectId: 'p2'})),
    ]);
    const r = await runDmJudge(
      dmDeps(
        [
          dm('1', 'Нужен сервис учёта остатков'),
          dm('1', 'Сколько стоит подключение?'),
          dm('2', 'Ищу склад для фулфилмента'),
          dm('999', 'это наш аккаунт пишет'),
          dm('5', 'пишет коллега', {username: '@OurBot'}),
        ],
        llm,
      ),
    );
    expect(calls).toHaveLength(1);
    expect(r.leads).toHaveLength(1);
    expect(r.leads[0]).toMatchObject({
      projectId: 'p1',
      sourceKind: 'dm',
      conversationOpen: true,
      senderId: '1',
      senderUsername: 'user1',
      temperature: 'hot',
      accountId: 'acc1',
    });
    expect(r.leads[0]?.replies).toHaveLength(2);
    expect(r.leads[0]?.replies[0]).toMatchObject({from: 'client', mode: 'dm', text: 'Нужен сервис учёта остатков'});
    expect(r.delta.counts).toMatchObject({fetched: 4, skippedNotUser: 2, returned: 2, leads: 1, rejected: 1});
    expectInvariant(r.delta.counts);
  });

  it('applies REQ-6: known senders are duplicates, a stop word shared by all projects drops', async () => {
    const {llm, calls} = scriptedLlm([answerAll(() => ({isLead: false, score: 0, projectId: null}))]);
    const r = await runDmJudge(
      dmDeps([dm('1', 'Расклад таро на любовь недорого'), dm('2', 'Лучшее казино в городе'), dm('3', 'Нужен сервис учёта остатков')], llm, {
        knownSenderIds: new Set(['3']),
      }),
    );
    expect(r.delta.counts).toMatchObject({stopword: 1, duplicate: 1, rejected: 1});
    expect(calls).toHaveLength(1);
    expectInvariant(r.delta.counts);
  });

  it('21 senders: one call, one skipped; a failure counts judgeError and returns normally', async () => {
    const many = Array.from({length: 21}, (_, i) => dm(String(i + 1), 'Нужен сервис учёта остатков'));
    const ok = scriptedLlm([answerAll(() => ({isLead: false, score: 0, projectId: null}))]);
    const r = await runDmJudge(dmDeps(many, ok.llm));
    expect(ok.calls).toHaveLength(1);
    expect(r.delta.counts).toMatchObject({rejected: 20, judgeSkipped: 1});
    expectInvariant(r.delta.counts);
    const failed = await runDmJudge(dmDeps(many.slice(0, 3), scriptedLlm([new Error('down')]).llm));
    expect(failed.delta.counts.judgeError).toBe(3);
    expect(failed.judgeError).toContain('down');
    expectInvariant(failed.delta.counts);
  });

  it('remembers rejected senders so the same last message is not judged twice', async () => {
    const {llm, calls} = scriptedLlm([answerAll(() => ({isLead: false, score: 0, projectId: null}))]);
    const msgs = [dm('1', 'Привет, у вас есть скидки?')];
    const first = await runDmJudge(dmDeps(msgs, llm));
    const second = await runDmJudge(dmDeps(msgs, llm, {aiRejected: first.aiRejected}));
    expect(calls).toHaveLength(1);
    expect(second.delta.counts.duplicate).toBe(1);
  });
});
