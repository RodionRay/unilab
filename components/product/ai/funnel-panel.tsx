'use client';
import { useCallback, useEffect, useId, useState } from 'react';
import { AlertTriangle, ChevronDown, FolderPlus, RefreshCw, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage, workspaceAction } from './api';
import {
  barPercent,
  isRowExpandable,
  showRedactedSamplesNote,
  formatCount,
  funnelHeadline,
  funnelRows,
  headlineKind,
  leadsLabel,
  uncheckedCause,
  periodLabel,
  pluralRu,
  sampleCaption,
  samplesFor,
  skipReasons,
  type FunnelPart,
  type FunnelResponse,
  type FunnelRow,
  type FunnelView,
} from './model';

type Days = 1 | 7;

type Props = {
  projectId: string;
  /** `null` = the viewer cannot see groups: ask the server instead of showing «нет чатов». */
  groupCount: number | null;
  aiKeyReady: boolean;
  /** Viewer may read lead/DM texts; without it the server sends `samples: {}`. */
  leadTextVisible: boolean;
  reloadKey: number;
  /** Project history depth: names the «Старше N дней» step. */
  scanDepthDays: number;
  /** Owner manages the server AI key; others get no server detail in the banner. */
  isOwner: boolean;
  onGoGroups: () => void;
  onRescan: () => Promise<void>;
  onOpenSettings?: () => void;
  onOpenLeads?: () => void;
};

/** One answer of the `funnel` action, tagged with the request it belongs to. */
type Loaded = { key: string; projectId: string; data: FunnelResponse | null; error: string };

export function FunnelPanel(props: Props) {
  const { projectId, groupCount, aiKeyReady, leadTextVisible, reloadKey, onGoGroups, onRescan } = props;
  const [days, setDays] = useState<Days>(7);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [rescanning, setRescanning] = useState(false);
  const titleId = useId();
  const requestKey = `${projectId}|${days}|${attempt}|${reloadKey}`;
  // loading = the newest answer belongs to an older request; the previous funnel of the same project stays visible
  const loading = loaded?.key !== requestKey;
  const data = loaded?.projectId === projectId ? loaded.data : null;
  const error = loading ? '' : (loaded?.error ?? '');

  useEffect(() => {
    if (!projectId || groupCount === 0) return;
    let cancelled = false;
    const done = (next: Omit<Loaded, 'key' | 'projectId'>) => { if (!cancelled) setLoaded({ key: requestKey, projectId, ...next }); };
    workspaceAction<FunnelResponse>({ action: 'funnel', projectId, days })
      .then((r) => done({ data: r, error: '' }))
      .catch((e) => done({ data: null, error: errorMessage(e) }));
    return () => { cancelled = true; };
  }, [projectId, days, groupCount, requestKey]);

  const rescan = useCallback(async () => {
    setRescanning(true);
    try {
      await onRescan();
      setAttempt((a) => a + 1);
    } finally {
      setRescanning(false);
    }
  }, [onRescan]);

  const header = (
    <div className="aiw-panel-head">
      <h2 id={titleId}>Куда ушли сообщения</h2>
      <div className="aiw-segment" role="group" aria-label="Период воронки">
        {([1, 7] as const).map((d) => (
          <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>
            {d === 1 ? '24 ч' : '7 дней'}
          </button>
        ))}
      </div>
    </div>
  );

  if (groupCount === 0) {
    return (
      <section className="panel aiw-funnel" aria-labelledby={titleId}>
        {header}
        <div className="aiw-empty">
          <p className="aiw-empty-title">В проекте нет чатов</p>
          <p className="aiw-help">AI читает только чаты, привязанные к проекту. Добавьте группы и выберите для них этот проект.</p>
          <Button onClick={onGoGroups}><FolderPlus size={16} />Добавить группы</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel aiw-funnel" aria-labelledby={titleId} aria-busy={loading}>
      {header}
      {loading && !data ? <FunnelSkeleton /> : error ? (
        <div className="aiw-alert is-error" role="alert">
          <AlertTriangle size={18} aria-hidden />
          <div className="min-w-0">
            <p className="aiw-alert-title">Воронка не загрузилась</p>
            <p className="aiw-help">{error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAttempt((a) => a + 1)}>Повторить</Button>
        </div>
      ) : data && data.funnel.counts.fetched > 0 ? (
        <FunnelLedger
          view={data.funnel}
          dm={data.dm}
          days={days}
          scanDepthDays={props.scanDepthDays}
          aiKeyReady={aiKeyReady}
          isOwner={props.isOwner}
          leadTextVisible={leadTextVisible}
          rescanning={rescanning}
          onRescan={rescan}
          onOpenSettings={props.onOpenSettings}
          onOpenLeads={props.onOpenLeads}
        />
      ) : (
        <div className="aiw-empty">
          <p className="aiw-empty-title">{data?.funnel.runs.length ? `Сообщений ${periodLabel(days)} нет` : 'Чаты ещё не проверялись'}</p>
          <p className="aiw-help">
            {data?.funnel.runs.length
              ? 'Чаты проекта проверялись, но новых сообщений не пришло. Выберите «7 дней» или проверьте чаты сейчас.'
              : 'Проверка читает новые сообщения в чатах проекта и показывает здесь, что с ними стало.'}
          </p>
          <Button disabled={rescanning} onClick={() => void rescan()}>
            <RefreshCw size={16} className={rescanning ? 'animate-spin' : ''} />{rescanning ? 'Проверяем чаты…' : 'Проверить чаты сейчас'}
          </Button>
        </div>
      )}
    </section>
  );
}

function FunnelSkeleton() {
  return (
    <div className="aiw-skeleton" aria-label="Загружаем воронку">
      <Skeleton className="h-9 w-4/5" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="aiw-skeleton-row">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-2 flex-1" />
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </div>
  );
}

type LedgerProps = {
  view: FunnelView;
  dm: FunnelView;
  days: Days;
  scanDepthDays: number;
  aiKeyReady: boolean;
  isOwner: boolean;
  leadTextVisible: boolean;
  rescanning: boolean;
  onRescan: () => Promise<void>;
  onOpenSettings?: () => void;
  onOpenLeads?: () => void;
};

const isKeyMissing = (view: FunnelPart, aiKeyReady: boolean): boolean => !aiKeyReady || skipReasons(view).has('no_ai_key');

function FunnelLedger({ view, dm, days, scanDepthDays, aiKeyReady, isOwner, leadTextVisible, rescanning, onRescan, onOpenSettings, onOpenLeads }: LedgerProps) {
  const rows = funnelRows(view.counts, scanDepthDays);
  const total = rows[0]?.count ?? 0;
  return (
    <>
      <FunnelHeadline view={view} days={days} keyMissing={isKeyMissing(view, aiKeyReady)} onOpenLeads={leadTextVisible ? onOpenLeads : undefined} />
      <p className="aiw-meta">
        {view.runs.length} {pluralRu(view.runs.length, 'обход', 'обхода', 'обходов')} {periodLabel(days)} · полоса показывает долю от собранного
      </p>
      <FunnelBanners view={view} aiKeyReady={aiKeyReady} isOwner={isOwner} rescanning={rescanning} onRescan={onRescan} onOpenSettings={onOpenSettings} />
      <ol className="aiw-ledger">
        {rows.map((row) => (
          <FunnelRowItem key={row.key} row={row} total={total} samples={view.samples} />
        ))}
      </ol>
      {dm.counts.fetched > 0 && <DmRow dm={dm} scanDepthDays={scanDepthDays} />}
      {showRedactedSamplesNote(view.counts, leadTextVisible) && (
        <p className="aiw-meta aiw-redacted-note">Примеры сообщений видны сотрудникам с доступом к лидам</p>
      )}
    </>
  );
}

type HeadlineProps = { view: FunnelView; days: Days; keyMissing: boolean; onOpenLeads?: () => void };

/** Numbers carry the weight (700, same colour); amber stays on the «Лиды» row, the active tab and «Отправить». */
function FunnelHeadline({ view, days, keyMissing, onOpenLeads }: HeadlineProps) {
  const { counts } = view;
  const kind = headlineKind(counts);
  const msgs = pluralRu(counts.fetched, 'сообщения', 'сообщений', 'сообщений');
  const label = funnelHeadline(counts, days, keyMissing);
  if (kind === 'unchecked') {
    const k = counts.judgeSkipped;
    return (
      <p className="aiw-headline">
        Из <strong>{formatCount(counts.fetched)}</strong> {msgs} <strong>{formatCount(k)}</strong> ещё не {pluralRu(k, 'проверено', 'проверены', 'проверено')} — {uncheckedCause(keyMissing)}
      </p>
    );
  }
  if (kind !== 'leads') return <p className="aiw-headline">{label}</p>;
  const found = <strong>{leadsLabel(counts.leads)}</strong>;
  return (
    <p className="aiw-headline">
      Из <strong>{formatCount(counts.fetched)}</strong> {msgs} {periodLabel(days)} AI нашёл{' '}
      {onOpenLeads ? (
        <button type="button" className="aiw-headline-link" onClick={onOpenLeads} aria-label={`${leadsLabel(counts.leads)}: открыть раздел «Лиды»`}>{found}</button>
      ) : found}
    </p>
  );
}

type BannerProps = {
  view: FunnelView;
  aiKeyReady: boolean;
  isOwner: boolean;
  rescanning: boolean;
  onRescan: () => Promise<void>;
  onOpenSettings?: () => void;
};

function FunnelBanners({ view, aiKeyReady, isOwner, rescanning, onRescan, onOpenSettings }: BannerProps) {
  const reasons = skipReasons(view);
  const skipped = view.counts.judgeSkipped;
  const failed = view.counts.judgeError;
  const keyMissing = isKeyMissing(view, aiKeyReady);
  const capHit = reasons.has('daily_cap');
  const msgs = (k: number) => `${formatCount(k)} ${pluralRu(k, 'сообщение', 'сообщения', 'сообщений')}`;
  return (
    <div className="aiw-banners">
      {keyMissing && (
        <div className="aiw-alert is-warning" role="status">
          <AlertTriangle size={18} aria-hidden />
          <div className="min-w-0">
            <p className="aiw-alert-title">AI не подключён — сообщения ждут проверки</p>
            <p className="aiw-help">Подключите ключ AI в настройках или попросите администратора. Пропущенные сообщения проверятся при следующем обходе.</p>
            {isOwner && <p className="aiw-meta aiw-owner-note">Если ключа нет в настройках, его задаёт администратор сервера.</p>}
          </div>
          {onOpenSettings && (
            <Button variant="outline" size="sm" onClick={onOpenSettings}><Settings size={14} />Открыть настройки</Button>
          )}
        </div>
      )}
      {!keyMissing && capHit && (
        <div className="aiw-alert is-warning" role="status">
          <AlertTriangle size={18} aria-hidden />
          <div className="min-w-0">
            <p className="aiw-alert-title">Дневной лимит AI исчерпан{skipped ? `: ${msgs(skipped)} ждут оценки` : ''}</p>
            <p className="aiw-help">Лимит обновится в 03:00 по Москве, тогда эти сообщения оценятся при обходе.</p>
          </div>
        </div>
      )}
      {failed > 0 && (
        <div className="aiw-alert is-error" role="status">
          <AlertTriangle size={18} aria-hidden />
          <div className="min-w-0">
            <p className="aiw-alert-title">AI не ответил на {msgs(failed)}</p>
            <p className="aiw-help">Сообщения не потеряны: обход вернётся к ним и спросит AI ещё раз.</p>
          </div>
          <Button variant="outline" size="sm" disabled={rescanning} onClick={() => void onRescan()}>
            <RefreshCw size={14} className={rescanning ? 'animate-spin' : ''} />Обойти сейчас
          </Button>
        </div>
      )}
    </div>
  );
}

type RowProps = { row: FunnelRow; total: number; samples: FunnelPart['samples'] };

function FunnelRowItem({ row, total, samples }: RowProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const items = samplesFor(row, samples);
  const expandable = isRowExpandable(row, samples);
  const pct = row.tone === 'total' ? 100 : barPercent(row.count, total);
  const share = total && row.tone !== 'total' ? Math.round((row.count / total) * 100) : null;
  const body = (
    <>
      <span className="aiw-row-label">
        <span className="aiw-row-name">{row.label}</span>
        <span className="aiw-row-hint">{row.hint}</span>
      </span>
      <span className="aiw-row-figures">
        <span className="aiw-row-count">{formatCount(row.count)}</span>
        <span className="aiw-row-share">{share === null ? '' : `${share < 1 && row.count ? '<1' : share} %`}</span>
      </span>
      <span className="aiw-row-bar" aria-hidden><span style={{ width: `${pct}%` }} /></span>
      {expandable && <ChevronDown size={16} className="aiw-row-chevron" aria-hidden />}
    </>
  );
  return (
    <li className="aiw-row" data-tone={row.tone} data-empty={row.count === 0 || undefined} data-open={open || undefined}>
      {expandable ? (
        <button type="button" className="aiw-row-main" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
          {body}
        </button>
      ) : (
        <div className="aiw-row-main">{body}</div>
      )}
      {expandable && open && (
        <div id={panelId} className="aiw-samples">
          {items.map((s, i) => (
            <figure key={i} className="aiw-sample">
              <blockquote>{s.text}</blockquote>
              {sampleCaption(s) && <figcaption>{sampleCaption(s)}</figcaption>}
            </figure>
          ))}
        </div>
      )}
    </li>
  );
}

function DmRow({ dm, scanDepthDays }: { dm: FunnelPart; scanDepthDays: number }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rows = funnelRows(dm.counts, scanDepthDays).filter((r) => r.tone !== 'total' && r.count > 0);
  const leadSamples = dm.samples.leads ?? [];
  const fetched = dm.counts.fetched;
  return (
    <div className="aiw-dm" data-open={open || undefined}>
      <button type="button" className="aiw-dm-main" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        <span className="aiw-row-name">Личные сообщения</span>
        <span className="aiw-dm-sum">
          {formatCount(fetched)} {pluralRu(fetched, 'входящее', 'входящих', 'входящих')}{' '}
          <span className="aiw-dm-result">→ <strong>{leadsLabel(dm.counts.leads)}</strong></span>
        </span>
        <ChevronDown size={16} className="aiw-row-chevron" aria-hidden />
      </button>
      {open && (
        <div id={panelId} className="aiw-samples">
          <ul className="aiw-dm-steps">
            {rows.map((r) => (
              <li key={r.key}><span>{r.label}</span><span className="aiw-row-count">{formatCount(r.count)}</span></li>
            ))}
          </ul>
          {leadSamples.map((s, i) => (
            <figure key={i} className="aiw-sample">
              <blockquote>{s.text}</blockquote>
              {sampleCaption(s) && <figcaption>{sampleCaption(s)}</figcaption>}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
