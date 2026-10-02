'use client';

import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, CircleX, Loader2, Network, Search, Timer, Trash2, Upload, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from '@/lib/workspace-notifications';
import type { VkAccountData } from '@/lib/vk/pool';
import { VkClampText } from '@/components/product/vk-clamp-text';
import {
  countVkStatuses,
  failedChunkResults,
  planVkAutoProxy,
  planVkImportChunks,
  remapChunkResults,
  tallyVkImport,
  vkAccountView,
  vkErrorView,
  vkImportHeadline,
  vkLinesToRetry,
  type VkImportLineResult,
  type VkImportStatus,
  type VkStatusFilter,
} from '@/lib/vk/view';

export type VkAccountRecord = { id: string; data: VkAccountData };
export type VkProxyOption = { id: string; label: string; active: boolean };

type Props = {
  accounts: VkAccountRecord[];
  proxies: VkProxyOption[];
  searchCap: unknown;
  perProxyCap: number;
  loading: boolean;
  run: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  onChanged: () => Promise<void> | void;
};

type Progress = { done: number; total: number };
type RowResult = { ok: boolean; text: string };

const AUTO_PROXY = 'auto';
const NO_PROXY = 'none';

const RESULT_VIEW: Record<VkImportStatus, { label: string; tone: string }> = {
  added: { label: 'Добавлен', tone: 'success' },
  no_proxy: { label: 'Без прокси', tone: 'warning' },
  duplicate: { label: 'Дубликат', tone: 'neutral' },
  invalid: { label: 'Ошибка', tone: 'danger' },
};

const STATUS_ICON = { success: Check, warning: Timer, danger: CircleX } as const;

const STATUS_CHIPS: ReadonlyArray<[VkStatusFilter, string]> = [
  ['all', 'Все'],
  ['active', 'Активен'],
  ['cooldown', 'Пауза'],
  ['error', 'Ошибка'],
  ['no_proxy', 'Нет прокси'],
];

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function ImportResults({ results, progress, perProxyCap }: { results: VkImportLineResult[]; progress: Progress | null; perProxyCap: number }) {
  const [onlyErrors, setOnlyErrors] = useState(false);
  const tally = tallyVkImport(results);
  const shown = onlyErrors ? results.filter((r) => r.status === 'invalid') : results;
  return (
    <div className="vk-import-results" aria-live="polite">
      <div className="vk-import-tally">
        <strong>{progress ? `Проверяем ${progress.done} из ${progress.total}…` : vkImportHeadline(results)}</strong>
        {!progress && tally.invalid > 0 && tally.invalid < results.length && (
          <label className="vk-only-errors">
            <Checkbox checked={onlyErrors} onCheckedChange={(v) => setOnlyErrors(v === true)} />
            только ошибки
          </label>
        )}
      </div>
      {progress && (
        <div className="vk-import-progress" role="progressbar" aria-label="Проверка токенов" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <span style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
        </div>
      )}
      <ol className="vk-import-lines">
        {shown.map((r) => {
          const view = RESULT_VIEW[r.status];
          const err = vkErrorView(r.reason, { perProxyCap });
          const text = r.status === 'added' ? r.name || 'Аккаунт VK' : err.text;
          return (
            <li key={r.line} className={`vk-import-line is-${view.tone}`}>
              <span className="vk-import-no">Строка {r.line}</span>
              <span className={`badge ${view.tone}`}>{view.label}</span>
              <span className="vk-import-text">
                <VkClampText text={r.warning ? `${text} · ${r.warning}` : text} title={err.raw} />
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ImportFormats() {
  return (
    <div className="vk-import-formats">
      <strong>Формат: по одному аккаунту в строке</strong>
      <ul>
        <li><span>токен</span><code>vk1.a.Xy7…</code></li>
        <li><span>логин:пароль:токен</span><code>seller@mail.ru:••••:vk1.a.Xy7…</code></li>
        <li><span>ссылка после входа</span><code>oauth.vk.com/blank.html#access_token=…</code></li>
      </ul>
      <p className="small-note">Пароль отбрасывается сразу. Токен проверяется через прокси аккаунта и хранится зашифрованным — в кабинете его не видно.</p>
    </div>
  );
}

export function VkAccountsPanel({ accounts, proxies, searchCap, perProxyCap, loading, run, onChanged }: Props) {
  const [text, setText] = useState('');
  const [proxyChoice, setProxyChoice] = useState(AUTO_PROXY);
  const [results, setResults] = useState<VkImportLineResult[] | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [formError, setFormError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<VkStatusFilter>('all');
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [bulkProxy, setBulkProxy] = useState(AUTO_PROXY);
  const [bindProgress, setBindProgress] = useState<Progress | null>(null);
  const [bindingIds, setBindingIds] = useState<string[]>([]);
  const [rowResults, setRowResults] = useState<Record<string, RowResult>>({});
  const textRef = useRef<HTMLTextAreaElement>(null);

  const activeProxies = proxies.filter((p) => p.active);
  const proxyLabel = useMemo(() => new Map(proxies.map((p) => [p.id, p.label])), [proxies]);
  const lineCount = useMemo(() => text.split(/\r?\n/).filter((l) => l.trim()).length, [text]);
  const views = accounts.map((a) => ({ ...a, view: vkAccountView(a.data, { searchCap, perProxyCap }) }));
  const counts = countVkStatuses(views);
  const filtered = statusFilter === 'all' ? views : views.filter((v) => v.view.status === statusFilter);
  const filteredIds = filtered.map((v) => v.id);
  const errorIds = views.filter((v) => v.view.status === 'error').map((v) => v.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.includes(id));
  const someFilteredSelected = filteredIds.some((id) => selected.includes(id));
  const bulkBusy = !!bindProgress || rowBusy === 'bulk';

  async function importAccounts() {
    const chunks = planVkImportChunks(text);
    if (!chunks.length) {
      setFormError('Вставьте хотя бы одну строку с токеном');
      textRef.current?.focus();
      return;
    }
    setFormError('');
    const pasted = text;
    const total = chunks.reduce((n, c) => n + c.lines.length, 0);
    const collected: VkImportLineResult[] = [];
    setResults([]);
    setProgress({ done: 0, total });
    for (const chunk of chunks) {
      try {
        const res = await run({ action: 'vk_accounts_import', text: chunk.text, ...(proxyChoice === AUTO_PROXY ? {} : { proxyId: proxyChoice }) });
        collected.push(...remapChunkResults(chunk, Array.isArray(res.results) ? (res.results as VkImportLineResult[]) : []));
      } catch (e) {
        collected.push(...failedChunkResults(chunk, errorText(e)));
      }
      setResults([...collected]);
      setProgress({ done: collected.length, total });
    }
    setProgress(null);
    // The inline result is the report (no toast); the textarea keeps only the lines to fix.
    setText(vkLinesToRetry(pasted, collected));
    await onChanged();
  }

  async function changeProxy(id: string, value: string) {
    setRowBusy(id);
    try {
      const res = await run({ action: 'vk_account_set_proxy', id, proxyId: value === NO_PROXY ? '' : value });
      toast.success(res.status === 'no_proxy' ? 'Прокси отвязан — аккаунт не сканирует' : `Прокси привязан${res.name ? ` · ${String(res.name)}` : ''}`);
      setRowResults((prev) => { const next = { ...prev }; delete next[id]; return next; });
      await onChanged();
    } catch (e) {
      toast.error(`Прокси не привязан: ${vkErrorView(errorText(e), { perProxyCap }).text}`);
    } finally {
      setRowBusy(null);
    }
  }

  async function bindOne(id: string, proxyId: string | null | undefined): Promise<RowResult> {
    if (!proxyId) return { ok: false, text: vkErrorView('Нет свободного активного прокси', { perProxyCap }).text };
    try {
      await run({ action: 'vk_account_set_proxy', id, proxyId });
      return { ok: true, text: `Прокси привязан: ${proxyLabel.get(proxyId) || 'прокси'}` };
    } catch (e) {
      return { ok: false, text: vkErrorView(errorText(e), { perProxyCap }).text };
    }
  }

  async function bindSelected() {
    const ids = [...selected];
    const plan = bulkProxy === AUTO_PROXY
      ? planVkAutoProxy(ids, accounts, activeProxies.map((p) => p.id), perProxyCap)
      : new Map(ids.map((id) => [id, bulkProxy]));
    setBindingIds(ids);
    setBindProgress({ done: 0, total: ids.length });
    let stillFailing: string[] = [];
    for (const [i, id] of ids.entries()) {
      const result = await bindOne(id, plan.get(id));
      if (!result.ok) stillFailing = [...stillFailing, id];
      setRowResults((prev) => ({ ...prev, [id]: result }));
      setBindProgress({ done: i + 1, total: ids.length });
    }
    setBindProgress(null);
    setBindingIds([]);
    setSelected(stillFailing);
    await onChanged();
  }

  async function deleteAccounts(ids: string[]) {
    setConfirmIds(null);
    setRowBusy(ids.length === 1 ? ids[0] : 'bulk');
    try {
      const res = await run({ action: 'vk_account_delete', ids });
      toast.success(`Удалено VK-аккаунтов: ${Number(res.removed) || 0}`);
      setSelected((prev) => prev.filter((x) => !ids.includes(x)));
      await onChanged();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setRowBusy(null);
    }
  }

  const toggleFiltered = (on: boolean) =>
    setSelected((prev) => (on ? [...new Set([...prev, ...filteredIds])] : prev.filter((id) => !filteredIds.includes(id))));

  return (
    <section className="vk-section" aria-labelledby="vk-accounts-title">
      <div className="vk-section-head">
        <div className="min-w-0">
          <h2 id="vk-accounts-title" className="vk-section-title">Аккаунты VK</h2>
          <p className="small-note mt-1">Только чтение: ищут посты и комментарии с запросами клиентов. До {perProxyCap} аккаунтов на один прокси.</p>
        </div>
      </div>

      <div className="panel vk-import">
        <div className="vk-import-form">
          <label htmlFor="vk-import-text" className="vk-field-label">Список VK-аккаунтов</label>
          <Textarea
            id="vk-import-text"
            ref={textRef}
            rows={6}
            value={text}
            disabled={!!progress}
            spellCheck={false}
            autoComplete="off"
            aria-describedby={formError ? 'vk-import-error' : !lineCount ? 'vk-import-hint' : undefined}
            aria-invalid={formError ? true : undefined}
            placeholder={'vk1.a.…\nlogin:password:vk1.a.…\nhttps://oauth.vk.com/blank.html#access_token=…'}
            onChange={(e) => { setText(e.target.value); if (formError) setFormError(''); }}
          />
          {formError && <p id="vk-import-error" className="vk-field-error" role="alert">{formError}</p>}
          <div className="vk-import-actions">
            <Select value={proxyChoice} onValueChange={setProxyChoice} disabled={!!progress}>
              <SelectTrigger className="vk-proxy-trigger" aria-label="Прокси для новых аккаунтов"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO_PROXY}>Прокси: распределить автоматически</SelectItem>
                {activeProxies.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={() => void importAccounts()} disabled={!!progress || !lineCount}>
              {progress ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />}
              {progress ? 'Проверяем…' : `Импортировать${lineCount ? ` ${lineCount}` : ''}`}
            </Button>
          </div>
          {!lineCount && !progress && !formError && <p id="vk-import-hint" className="small-note vk-import-hint">Кнопка включится, когда вставите хотя бы одну строку</p>}
          {!activeProxies.length && (
            <p className="small-note vk-hint-warn"><AlertTriangle size={13} />Нет активного прокси — аккаунты сохранятся без проверки со статусом «Нет прокси».</p>
          )}
        </div>
        {results ? <ImportResults results={results} progress={progress} perProxyCap={perProxyCap} /> : <ImportFormats />}
      </div>

      {accounts.length > 0 && (
        <>
          <div className="groups-filters vk-status-chips" role="group" aria-label="Статус VK-аккаунтов">
            {STATUS_CHIPS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={statusFilter === id}
                className={`groups-filter ${statusFilter === id ? 'on' : ''}`}
                onClick={() => setStatusFilter(id)}
              >
                {label} {counts[id]}
              </button>
            ))}
          </div>

          <div className={`groups-actionbar vk-bulkbar ${selected.length ? 'has-sel' : ''}`}>
            <div className="groups-actionbar-left">
              {selected.length ? (
                <strong>Выбрано {selected.length}</strong>
              ) : (
                <span className="muted text-sm">Отметьте аккаунты, чтобы привязать прокси или удалить</span>
              )}
              {bindProgress && (
                <span className="vk-bind-progress" role="status">Привязываем {bindProgress.done} из {bindProgress.total}…</span>
              )}
            </div>
            <div className="groups-actionbar-right">
              {selected.length ? (
                <>
                  <Select value={bulkProxy} onValueChange={setBulkProxy} disabled={bulkBusy}>
                    <SelectTrigger size="sm" className="vk-bulk-proxy" aria-label="Прокси для выбранных"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTO_PROXY}>Прокси: авто</SelectItem>
                      {activeProxies.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" disabled={bulkBusy || !activeProxies.length} title={activeProxies.length ? undefined : 'Нет активного прокси'} onClick={() => void bindSelected()}>
                    {bindProgress ? <Loader2 className="animate-spin" size={14} /> : <Network size={14} />}Привязать прокси
                  </Button>
                  <Button size="sm" variant="outline" className="vk-danger-text" disabled={bulkBusy} onClick={() => setConfirmIds(selected)}>
                    <Trash2 size={14} />Удалить выбранные ({selected.length})
                  </Button>
                  <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={() => setSelected([])}>Снять выбор</Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => toggleFiltered(true)}>Выбрать все ({filteredIds.length})</Button>
                  {errorIds.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setSelected(errorIds)}>Выбрать с ошибкой ({errorIds.length})</Button>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      <div className="panel table-panel vk-list">
        {loading ? (
          <div className="p-4 space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
        ) : !accounts.length ? (
          <div className="vk-empty">
            <p><strong>VK-аккаунтов пока нет.</strong> Вставьте токены в поле выше — после первого рабочего аккаунта появится источник «Поиск VK по ключевым словам».</p>
          </div>
        ) : !filtered.length ? (
          <div className="vk-empty">
            <p>Нет аккаунтов со статусом «{STATUS_CHIPS.find(([id]) => id === statusFilter)?.[1]}».</p>
            <Button variant="outline" size="sm" onClick={() => setStatusFilter('all')}>Показать все</Button>
          </div>
        ) : (
          <>
            <div className="vk-rows-cols">
              <span className="vk-cell-check">
                <Checkbox
                  checked={allFilteredSelected ? true : someFilteredSelected ? 'indeterminate' : false}
                  onCheckedChange={(v) => toggleFiltered(v === true)}
                  aria-label={statusFilter === 'all' ? 'Выбрать все VK-аккаунты' : 'Выбрать показанные VK-аккаунты'}
                />
              </span>
              <span>Аккаунт</span>
              <span>Прокси</span>
              <span>Статус</span>
              <span>Сегодня</span>
              <span className="sr-only">Действие</span>
            </div>
            {filtered.map(({ id, data, view }) => {
              const Icon = STATUS_ICON[view.tone];
              const busy = rowBusy === id || rowBusy === 'bulk' || bindingIds.includes(id);
              const proxyValue = data.proxyId && proxyLabel.has(data.proxyId) ? data.proxyId : NO_PROXY;
              const searchOver = view.searchCap > 0 && view.searchCalls >= view.searchCap;
              const unchecked = !data.vkUserId;
              const name = unchecked ? 'Аккаунт не проверен' : data.name || 'Без имени';
              const sub = data.vkUserId ? `vk.com/id${data.vkUserId}` : data.proxyId ? 'не проверен' : 'ждёт прокси';
              const rowResult = rowResults[id];
              return (
                <div key={id} className={`vk-row ${selected.includes(id) ? 'is-selected' : ''}`}>
                  <span className="vk-cell-check">
                    <Checkbox
                      checked={selected.includes(id)}
                      onCheckedChange={(v) => setSelected((prev) => (v === true ? [...prev, id] : prev.filter((x) => x !== id)))}
                      aria-label={`Выбрать ${name}`}
                    />
                  </span>
                  <div className="vk-cell-main min-w-0">
                    <strong className="vk-name" title={name}>{name}</strong>
                    <span className="vk-sub">{sub}</span>
                  </div>
                  <div className="vk-cell-proxy min-w-0">
                    <Select value={proxyValue} disabled={busy} onValueChange={(v) => void changeProxy(id, v)}>
                      <SelectTrigger className="vk-row-proxy" aria-label={`Прокси для ${name}`}>
                        {busy ? <Loader2 className="animate-spin" size={13} /> : <Network size={13} />}
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_PROXY}>Без прокси</SelectItem>
                        {proxies
                          .filter((p) => p.active || p.id === data.proxyId)
                          .map((p) => <SelectItem key={p.id} value={p.id}>{p.label}{p.active ? '' : ' · неактивен'}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className={`vk-cell-status acc-status acc-status-${view.tone} min-w-0`}>
                    <span className="acc-status-icon" aria-hidden><Icon size={14} /></span>
                    <div className="vk-status-text min-w-0">
                      <strong>{view.label}</strong>
                      <VkClampText className="vk-status-detail" text={view.detail} title={view.detailRaw} />
                      {rowResult && (
                        <span className={`vk-row-result ${rowResult.ok ? 'is-ok' : 'is-fail'}`} role="status">{rowResult.text}</span>
                      )}
                    </div>
                  </div>
                  <div className="vk-cell-usage acc-limits" title="Счётчики сбрасываются в 00:00 МСК">
                    <span className="vk-usage-icon" title="Запросы к VK за сегодня"><Zap size={13} /><em>{view.calls}</em></span>
                    <span className={`vk-usage-icon ${searchOver ? 'is-over' : ''}`} title="Поиск по ключевым словам: сегодня / дневной лимит">
                      <Search size={13} /><em>{view.searchCalls}/{view.searchCap || '∞'}</em>
                    </span>
                    <span className="vk-usage-line">
                      вызовов {view.calls} · <span className={searchOver ? 'is-over' : ''}>поисков {view.searchCalls}/{view.searchCap || '∞'}</span>
                    </span>
                  </div>
                  <div className="vk-cell-actions">
                    <Button variant="ghost" size="icon" className="vk-danger-text" disabled={busy} aria-label={`Удалить ${name}`} onClick={() => setConfirmIds([id])}>
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      <AlertDialog open={!!confirmIds} onOpenChange={(o) => { if (!o) setConfirmIds(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmIds?.length === 1
                ? `Удалить VK-аккаунт «${views.find((a) => a.id === confirmIds[0])?.data.name || 'Аккаунт не проверен'}»?`
                : `Удалить VK-аккаунты: ${confirmIds?.length || 0}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>Токены удаляются без восстановления — чтобы вернуть аккаунт, импортируйте его заново. Найденные лиды останутся.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Оставить</AlertDialogCancel>
            <AlertDialogAction className="vk-danger-action" onClick={() => { if (confirmIds) void deleteAccounts(confirmIds); }}>
              {confirmIds && confirmIds.length > 1 ? `Удалить ${confirmIds.length}` : 'Удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
