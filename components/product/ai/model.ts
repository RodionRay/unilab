/**
 * Client contract of the AI page (spec docs/project/specs/lead-core-v2.md, Contracts) and pure helpers
 * that the components use: funnel step mapping, project patch diff, lead → project, queue predicates.
 * No React here so the rules stay unit-testable (tests/ui-ai-workspace.test.ts).
 */

export const MAX_STOP_WORDS = 50;
export const MAX_EXAMPLES = 10;
export const MAX_TERM_LENGTH = 100;
export const MAX_EXAMPLE_LENGTH = 300;
export const DEFAULT_MIN_SCORE = 50;

export const DRAFT_KINDS = ['group_reply', 'dm_first', 'dm_continue'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export type ProjectData = {
  name: string;
  url: string;
  product: string;
  audience: string;
  leadCriteria: string;
  notLead: string;
  valueProps: string;
  tone: string;
  cta: string;
  keywords: string[];
  stopWords: string[];
  goodExamples: string[];
  badExamples: string[];
  minScore: number;
  scanDepthDays: number;
  autoDraft: boolean;
  active: boolean;
  updatedAt: string;
};

/** Fields `project_update` accepts (the server patch schema is strict: no `updatedAt`). */
export const EDITABLE_PROJECT_FIELDS = [
  'name', 'url', 'product', 'audience', 'leadCriteria', 'notLead', 'valueProps', 'tone', 'cta',
  'keywords', 'stopWords', 'goodExamples', 'badExamples', 'minScore', 'scanDepthDays', 'autoDraft', 'active',
] as const;
export type EditableProjectField = (typeof EDITABLE_PROJECT_FIELDS)[number];
export type ProjectPatch = Partial<Pick<ProjectData, EditableProjectField>>;

export type ProjectRecord = { id: string; created: string; data: ProjectData };

/** The subset of a workspace record the AI page reads. */
export type WorkspaceRecord = { id: string; kind: string; data: Record<string, unknown>; created: string };

export type LeadLike = {
  projectId?: unknown;
  draft?: unknown;
  draftKind?: unknown;
  conversationOpen?: unknown;
  excludeFromTraining?: unknown;
  feedback?: unknown;
};

export type FunnelCounts = {
  fetched: number;
  skippedNotUser: number;
  skippedOldWorker: number;
  skippedError: number;
  returned: number;
  skippedErrorApp?: number;
  old: number;
  short: number;
  duplicate: number;
  stopword: number;
  judged: number;
  judgeSkipped: number;
  judgeError: number;
  rejected: number;
  leads: number;
};

export type FunnelSample = { text: string; term?: string; reason?: string };
/** `lib/leads/funnel.ts::FunnelView`: one project (or the owner's DM row) summed over `days`. */
export type FunnelView = {
  projectId: string;
  days: number;
  counts: FunnelCounts;
  samples: Partial<Record<string, FunnelSample[]>>;
  runs: string[];
};
export type FunnelPart = Pick<FunnelView, 'counts' | 'samples'>;
/** Action `funnel` → `{ok, funnel, dm}`; `dm.projectId` is `'dm'`. */
export type FunnelResponse = { ok: true; funnel: FunnelView; dm: FunnelView };

/** `lib/leads/types.ts::JudgeSkipReason` in the seller's words. */
export const SKIP_REASON_LABEL: Record<string, string> = {
  no_ai_key: 'Нет ключа AI',
  daily_cap: 'Дневной лимит оценок исчерпан',
  blocked: 'AI не ответил раньше в этом обходе',
  batch_limit: 'Не поместилось в обход: оценим в следующем',
  sender_limit: 'Слишком много новых собеседников за раз',
  no_project: 'Нет активного проекта',
};

export const sampleCaption = (s: FunnelSample): string =>
  s.term ? `Стоп-слово «${s.term}»` : s.reason ? (SKIP_REASON_LABEL[s.reason] ?? s.reason) : '';

/** Skip reasons seen in the samples of «Без оценки»: drives the key / daily-cap banners. */
export function skipReasons(view: FunnelPart): ReadonlySet<string> {
  return new Set((view.samples.judgeSkipped ?? []).map((x) => x.reason ?? '').filter(Boolean));
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const int = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(max, Math.max(min, n));
};

/** Records arrive as untyped JSON: normalise once at the edge, with contract defaults. */
export function toProjectData(raw: Record<string, unknown>): ProjectData {
  return {
    name: str(raw.name, 'Проект'),
    url: str(raw.url),
    product: str(raw.product),
    audience: str(raw.audience),
    leadCriteria: str(raw.leadCriteria),
    notLead: str(raw.notLead),
    valueProps: str(raw.valueProps),
    tone: str(raw.tone),
    cta: str(raw.cta),
    keywords: strList(raw.keywords),
    stopWords: strList(raw.stopWords),
    goodExamples: strList(raw.goodExamples),
    badExamples: strList(raw.badExamples),
    minScore: int(raw.minScore, DEFAULT_MIN_SCORE, 0, 100),
    scanDepthDays: int(raw.scanDepthDays, 7, 1, 30),
    autoDraft: raw.autoDraft !== false,
    active: raw.active !== false,
    updatedAt: str(raw.updatedAt),
  };
}

/** Projects oldest first: the first one is the default project (leads/groups without `projectId`). */
export function projectsFrom(records: readonly WorkspaceRecord[]): ProjectRecord[] {
  return records
    .filter((r) => r.kind === 'project')
    .map((r) => ({ id: r.id, created: r.created, data: toProjectData(r.data) }))
    .sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
}

export function defaultProjectId(projects: readonly ProjectRecord[]): string {
  return projects[0]?.id ?? '';
}

/** Missing or unknown `projectId` reads as the default project (spec REQ-2, no bulk rewrite). */
export function projectIdOf(item: { projectId?: unknown }, projects: readonly ProjectRecord[]): string {
  const id = typeof item.projectId === 'string' ? item.projectId.trim() : '';
  if (id && projects.some((p) => p.id === id)) return id;
  return defaultProjectId(projects);
}

/** Requested id if it still exists, else the default project. */
export function resolveActiveProjectId(requested: string | null | undefined, projects: readonly ProjectRecord[]): string {
  if (requested && projects.some((p) => p.id === requested)) return requested;
  return defaultProjectId(projects);
}

export function isDraftKind(v: unknown): v is DraftKind {
  return typeof v === 'string' && (DRAFT_KINDS as readonly string[]).includes(v);
}

/** Auto draft waiting for a human click: approved only in the AI page queue (REQ-19, REQ-20). */
export function isAwaitingApproval(lead: LeadLike): boolean {
  return isDraftKind(lead.draftKind) && typeof lead.draft === 'string' && lead.draft.trim() !== '';
}

/** «Переписки»: an open conversation or a manual draft; auto drafts stay in the AI queue (REQ-20). */
export function isInConversations(lead: LeadLike): boolean {
  if (lead.excludeFromTraining) return false;
  if (lead.conversationOpen) return true;
  const hasDraft = typeof lead.draft === 'string' && lead.draft.trim() !== '';
  return hasDraft && !isDraftKind(lead.draftKind);
}

/** Leads of one project whose auto draft waits for approval: hottest first, then newest. */
export function approvalQueue<T extends { id: string; created: string; data: LeadLike & { score?: unknown } }>(
  leads: readonly T[],
  projects: readonly ProjectRecord[],
  projectId: string,
): T[] {
  const score = (l: T) => (typeof l.data.score === 'number' ? l.data.score : 0);
  return leads
    .filter((l) => isAwaitingApproval(l.data) && projectIdOf(l.data, projects) === projectId)
    .sort((a, b) => score(b) - score(a) || b.created.localeCompare(a.created));
}

/** `send_lead_message` mode for a draft kind: a group reply goes to the chat, the rest to DMs. */
export function sendModeFor(kind: DraftKind): 'chat' | 'dm' {
  return kind === 'group_reply' ? 'chat' : 'dm';
}

// ---------- funnel ----------

export type FunnelTone = 'total' | 'neutral' | 'warning' | 'error' | 'lead';
export type FunnelRow = {
  key: string;
  label: string;
  hint: string;
  count: number;
  tone: FunnelTone;
  sampleKeys: string[];
};

type StepDef = { key: string; label: string; hint: string; tone: FunnelTone; parts: (keyof FunnelCounts)[]; sampleKeys: string[] };

/**
 * Rows of the ledger. Every counter that leaves `fetched` lands in exactly one row, so the rows after
 * «Собрано» sum to `fetched` under the REQ-13 invariant whether `skippedError` is the worker share only
 * (T1 `skippedErrorApp` separate) or both shares together.
 */
const STEPS: StepDef[] = [
  { key: 'notUser', label: 'Боты и каналы', hint: 'Пишет не человек: бот, канал или пересылка.', tone: 'neutral', parts: ['skippedNotUser'], sampleKeys: ['skippedNotUser'] },
  { key: 'old', label: 'Старые', hint: 'Старше глубины просмотра проекта.', tone: 'neutral', parts: ['skippedOldWorker', 'old'], sampleKeys: ['old'] },
  { key: 'short', label: 'Короткие', hint: 'Короче 12 символов: «+», «спасибо», «в лс».', tone: 'neutral', parts: ['short'], sampleKeys: ['short'] },
  { key: 'duplicate', label: 'Повторы', hint: 'Уже видели это сообщение или уже отклонили его.', tone: 'neutral', parts: ['duplicate'], sampleKeys: ['duplicate'] },
  { key: 'stopword', label: 'Стоп-слова', hint: 'Нашлось слово из стоп-списка проекта.', tone: 'neutral', parts: ['stopword'], sampleKeys: ['stopword'] },
  { key: 'judgeSkipped', label: 'Без оценки', hint: 'AI не смотрел: нет ключа или дневной лимит. Оценит при следующем обходе.', tone: 'warning', parts: ['judgeSkipped'], sampleKeys: ['judgeSkipped'] },
  { key: 'error', label: 'Ошибка AI или чтения', hint: 'AI не ответил или Telegram не отдал автора сообщения.', tone: 'error', parts: ['judgeError', 'skippedError', 'skippedErrorApp'], sampleKeys: ['judgeError', 'skippedErrorApp'] },
  { key: 'rejected', label: 'Не лид', hint: 'AI прочитал и решил, что автор не ищет ваш продукт.', tone: 'neutral', parts: ['rejected'], sampleKeys: ['rejected'] },
  { key: 'leads', label: 'Лиды', hint: 'AI решил, что автор ищет ваш продукт, и балл не ниже порога.', tone: 'lead', parts: ['leads'], sampleKeys: ['leads'] },
];

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export function funnelRows(counts: FunnelCounts): FunnelRow[] {
  const total: FunnelRow = { key: 'fetched', label: 'Собрано', hint: 'Сообщений прочитано в чатах проекта.', count: n(counts.fetched), tone: 'total', sampleKeys: [] };
  const rows = STEPS.map((s) => ({
    key: s.key,
    label: s.label,
    hint: s.hint,
    tone: s.tone,
    sampleKeys: s.sampleKeys,
    count: s.parts.reduce((sum, p) => sum + n(counts[p]), 0),
  }));
  return [total, ...rows];
}

/** fetched minus the sum of step rows; 0 when the server keeps the REQ-13 invariant. */
export function funnelResidual(counts: FunnelCounts): number {
  const [total, ...steps] = funnelRows(counts);
  return (total?.count ?? 0) - steps.reduce((s, r) => s + r.count, 0);
}

/** Bar width in % of «Собрано»; a non-zero step never disappears (min 1.5 %). */
export function barPercent(count: number, total: number): number {
  if (!total || count <= 0) return 0;
  return Math.max(1.5, Math.min(100, (count / total) * 100));
}

export function samplesFor(row: FunnelRow, samples: FunnelPart['samples']): FunnelSample[] {
  return row.sampleKeys.flatMap((k) => samples[k] ?? []);
}

export function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const formatCount = (count: number): string => new Intl.NumberFormat('ru-RU').format(count);

export function periodLabel(days: 1 | 7): string {
  return days === 1 ? 'за 24 часа' : 'за 7 дней';
}

/** «Из 1 240 сообщений за 7 дней AI нашёл 9 лидов». */
export function funnelHeadline(counts: FunnelCounts, days: 1 | 7): string {
  const fetched = n(counts.fetched);
  const leads = n(counts.leads);
  if (!fetched) return `Сообщений ${periodLabel(days)} пока нет`;
  const msgs = pluralRu(fetched, 'сообщения', 'сообщений', 'сообщений');
  const found = leads ? `AI нашёл ${formatCount(leads)} ${pluralRu(leads, 'лид', 'лида', 'лидов')}` : 'лидов не нашлось';
  return `Из ${formatCount(fetched)} ${msgs} ${periodLabel(days)} ${found}`;
}

// ---------- project card ----------

const sameValue = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;

/** Only the fields the user changed; `{}` means nothing to save. */
export function diffProjectPatch(base: ProjectData, edited: ProjectData): ProjectPatch {
  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE_PROJECT_FIELDS) {
    if (!sameValue(base[key], edited[key])) patch[key] = edited[key];
  }
  return patch as ProjectPatch;
}

export const isPatchEmpty = (patch: ProjectPatch): boolean => Object.keys(patch).length === 0;

export type ListAddResult = { list: string[]; error: '' | 'empty' | 'duplicate' | 'limit' | 'too_long' };

/** Adds one trimmed term; case-insensitive duplicates and the limit are refused with a reason. */
export function addTerm(list: readonly string[], value: string, max: number, maxLength: number): ListAddResult {
  const term = value.trim().replace(/\s+/g, ' ');
  if (!term) return { list: [...list], error: 'empty' };
  if (term.length > maxLength) return { list: [...list], error: 'too_long' };
  if (list.some((x) => x.toLowerCase() === term.toLowerCase())) return { list: [...list], error: 'duplicate' };
  if (list.length >= max) return { list: [...list], error: 'limit' };
  return { list: [...list, term], error: '' };
}

export const addStopWord = (list: readonly string[], value: string): ListAddResult =>
  addTerm(list, value, MAX_STOP_WORDS, MAX_TERM_LENGTH);

export const addExample = (list: readonly string[], value: string): ListAddResult =>
  addTerm(list, value, MAX_EXAMPLES, MAX_EXAMPLE_LENGTH);

export const removeAt = (list: readonly string[], index: number): string[] => list.filter((_, i) => i !== index);

/** Splits pasted «вакансия, резюме; казино» into terms. */
export function splitTerms(raw: string): string[] {
  return raw.split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean);
}

export function newProjectData(name: string, url: string): Omit<ProjectData, 'updatedAt'> {
  return {
    name: name.trim(), url: url.trim(), product: '', audience: '', leadCriteria: '', notLead: '', valueProps: '',
    tone: '', cta: '', keywords: [], stopWords: [], goodExamples: [], badExamples: [],
    minScore: DEFAULT_MIN_SCORE, scanDepthDays: 7, autoDraft: true, active: true,
  };
}
