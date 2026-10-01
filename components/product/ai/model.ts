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
  blocked: 'AI не ответил раньше в этой проверке',
  batch_limit: 'Не поместилось в эту проверку: оценим в следующей',
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

export const DEFAULT_PROJECT_DELETE_REASON = 'Основной проект нельзя удалить — в него попадают чаты без проекта';

/** Why «Удалить проект» is unavailable, or `''` when it is allowed: the default project catches unassigned chats. */
export function deleteBlockedReason(projectId: string, projects: readonly ProjectRecord[]): string {
  return projectId !== '' && projectId === defaultProjectId(projects) ? DEFAULT_PROJECT_DELETE_REASON : '';
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
  { key: 'short', label: 'Короткие (меньше 12 символов)', hint: 'Ответы вроде «+», «спасибо», «в лс»: в них нет запроса.', tone: 'neutral', parts: ['short'], sampleKeys: ['short'] },
  { key: 'duplicate', label: 'Повторы', hint: 'Уже видели это сообщение или уже отклонили его.', tone: 'neutral', parts: ['duplicate'], sampleKeys: ['duplicate'] },
  { key: 'stopword', label: 'Стоп-слова', hint: 'Нашлось слово из стоп-списка проекта.', tone: 'neutral', parts: ['stopword'], sampleKeys: ['stopword'] },
  { key: 'judgeSkipped', label: 'Без оценки', hint: 'AI не смотрел: нет ключа или дневной лимит. Оценит при следующей проверке чатов.', tone: 'warning', parts: ['judgeSkipped'], sampleKeys: ['judgeSkipped'] },
  { key: 'error', label: 'Ошибка AI или чтения', hint: 'AI не ответил или Telegram не отдал автора сообщения.', tone: 'error', parts: ['judgeError', 'skippedError', 'skippedErrorApp'], sampleKeys: ['judgeError', 'skippedErrorApp'] },
  { key: 'rejected', label: 'Не лид', hint: 'AI прочитал и решил, что автор не ищет ваш продукт.', tone: 'neutral', parts: ['rejected'], sampleKeys: ['rejected'] },
  { key: 'leads', label: 'Лиды', hint: 'AI решил, что автор ищет ваш продукт, и балл не ниже порога.', tone: 'lead', parts: ['leads'], sampleKeys: ['leads'] },
];

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export const DEFAULT_SCAN_DEPTH_DAYS = 7;

/** «Старше 7 дней»: the step is named by the project's own history depth. */
export function oldStepLabel(scanDepthDays: number = DEFAULT_SCAN_DEPTH_DAYS): string {
  const days = Number.isFinite(scanDepthDays) && scanDepthDays > 0 ? Math.round(scanDepthDays) : DEFAULT_SCAN_DEPTH_DAYS;
  return `Старше ${days} ${pluralRu(days, 'дня', 'дней', 'дней')}`;
}

export function funnelRows(counts: FunnelCounts, scanDepthDays: number = DEFAULT_SCAN_DEPTH_DAYS): FunnelRow[] {
  const total: FunnelRow = { key: 'fetched', label: 'Собрано', hint: 'Сообщений прочитано в чатах проекта.', count: n(counts.fetched), tone: 'total', sampleKeys: [] };
  const rows = STEPS.map((s) => ({
    key: s.key,
    label: s.key === 'old' ? oldStepLabel(scanDepthDays) : s.label,
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

/** «1 лид», «3 лида», «27 лидов». */
export const leadsLabel = (count: number): string => `${formatCount(count)} ${pluralRu(count, 'лид', 'лида', 'лидов')}`;

/**
 * Which story the funnel headline tells. `unchecked`: no leads yet, but part of the messages never reached
 * AI, so «лидов не нашлось» would be a false verdict.
 */
export type HeadlineKind = 'empty' | 'leads' | 'unchecked' | 'none';

export function headlineKind(counts: FunnelCounts): HeadlineKind {
  if (!n(counts.fetched)) return 'empty';
  if (n(counts.leads)) return 'leads';
  return n(counts.judgeSkipped) ? 'unchecked' : 'none';
}

/** Why the unchecked messages wait: drives the tail of the `unchecked` headline. */
export const uncheckedCause = (keyMissing: boolean): string => (keyMissing ? 'AI не подключён' : 'AI оценит их при следующей проверке чатов');

/** «Из 1 240 сообщений за 7 дней AI нашёл 9 лидов» / «Из 797 сообщений 91 ещё не проверено — AI не подключён». */
export function funnelHeadline(counts: FunnelCounts, days: 1 | 7, keyMissing = false): string {
  const fetched = n(counts.fetched);
  const msgs = `${formatCount(fetched)} ${pluralRu(fetched, 'сообщения', 'сообщений', 'сообщений')}`;
  switch (headlineKind(counts)) {
    case 'empty':
      return `Сообщений ${periodLabel(days)} пока нет`;
    case 'leads':
      return `Из ${msgs} ${periodLabel(days)} AI нашёл ${leadsLabel(n(counts.leads))}`;
    case 'unchecked': {
      const k = n(counts.judgeSkipped);
      return `Из ${msgs} ${formatCount(k)} ещё не ${pluralRu(k, 'проверено', 'проверены', 'проверено')} — ${uncheckedCause(keyMissing)}`;
    }
    default:
      return `Из ${msgs} ${periodLabel(days)} лидов не нашлось`;
  }
}

/** Compact age for one-line meta: «только что», «35 мин назад», «3 ч назад», «2 дня назад». */
export function shortAgoRu(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.round(Math.max(0, now - t) / 60000);
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.round(hours / 24);
  return `${days} ${pluralRu(days, 'день', 'дня', 'дней')} назад`;
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

// ---------- lead-text access (mirror of lib/security/workspace-authz.ts::canSeeLeadText) ----------

/** GET `/api/workspace` → `workspace`: who is looking at the page. */
export type WorkspaceViewer = { isOwner: boolean; role: string; access: Readonly<Partial<Record<string, boolean>>> };

/** Group records reach only owner, admin and members with «Группы и каналы» (`KIND_ACCESS.group`). */
/** Only the owner manages the server AI key; others are pointed at settings or the admin. */
export function isWorkspaceOwner(viewer: WorkspaceViewer | null): boolean {
  return !viewer || viewer.isOwner || viewer.role === 'owner';
}

export function canSeeGroups(viewer: WorkspaceViewer | null): boolean {
  if (!viewer || viewer.isOwner || viewer.role === 'admin' || viewer.role === 'owner') return true;
  return viewer.access.groups === true;
}

/** Project fields the server blanks (`[]`) for a viewer without lead access. */
export const LEAD_TEXT_PROJECT_FIELDS = ['goodExamples', 'badExamples'] as const;

/**
 * Owner, admin, or a member with «Лиды» / «Переписки» sees lead and DM texts (funnel samples, project
 * examples). No `workspace` in the GET envelope means the owner on an older server, so `null` reads as access.
 */
export function canSeeLeadText(viewer: WorkspaceViewer | null): boolean {
  if (!viewer || viewer.isOwner || viewer.role === 'admin' || viewer.role === 'owner') return true;
  return viewer.access.leads === true || viewer.access.chats === true;
}

/**
 * The patch a viewer may send. Without lead access the examples arrive as `[]`, so a patch carrying them
 * would wipe the owner's real examples: they are dropped whatever the editor state says.
 */
export function patchForViewer(patch: ProjectPatch, leadTextVisible: boolean): ProjectPatch {
  if (leadTextVisible) return patch;
  const next: Record<string, unknown> = { ...patch };
  for (const key of LEAD_TEXT_PROJECT_FIELDS) delete next[key];
  return next as ProjectPatch;
}

/** A step opens only when there is something to show: samples are absent for redacted viewers and old runs. */
export function isRowExpandable(row: FunnelRow, samples: FunnelPart['samples']): boolean {
  return row.tone !== 'total' && row.count > 0 && samplesFor(row, samples).length > 0;
}

/** Note under the ledger only for a viewer whose samples were redacted and who has counts to explain. */
export function showRedactedSamplesNote(counts: FunnelCounts, leadTextVisible: boolean): boolean {
  return !leadTextVisible && funnelRows(counts).some((r) => r.tone !== 'total' && r.count > 0);
}

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
