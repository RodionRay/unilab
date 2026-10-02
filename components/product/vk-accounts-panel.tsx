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
import {
  failedChunkResults,
  planVkImportChunks,
  remapChunkResults,
  tallyVkImport,
  vkAccountView,
  type VkImportLineResult,
  type VkImportStatus,
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

const AUTO_PROXY = 'auto';
const NO_PROXY = 'none';

const RESULT_VIEW: Record<VkImportStatus, { label: string; tone: string }> = {
  added: { label: 'Добавлен', tone: 'success' },
  no_proxy: { label: 'Без прокси', tone: 'warning' },
  duplicate: { label: 'Дубликат', tone: 'neutral' },
  invalid: { label: 'Ошибка', tone: 'danger' },
};

const STATUS_ICON = { success: Check, warning: Timer, danger: CircleX } as const;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function ImportResults({ results, progress }: { results: VkImportLineResult[]; progress: { done: number; total: number } | null }) {
  const tally = tallyVkImport(results);
  return (
    <div className="vk-import-results" aria-live="polite">
      <div className="vk-import-tally">
        <strong>{progress ? `Проверяем ${progress.done} из ${progress.total}` : `Готово: ${results.length} строк`}</strong>
        <span className="vk-tally-item is-success">добавлено {tally.added}</span>
        {tally.no_proxy > 0 && <span className="vk-tally-item is-warning">без прокси {tally.no_proxy}</span>}
        {tally.duplicate > 0 && <span className="vk-tally-item">дубликаты {tally.duplicate}</span>}
        {tally.invalid > 0 && <span className="vk-tally-item is-danger">ошибки {tally.invalid}</span>}
      </div>
      {progress && (
        <div className="vk-import-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <span style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
        </div>
      )}
      <ol className="vk-import-lines">
        {results.map((r) => {
          const view = RESULT_VIEW[r.status];
          const text = r.status === 'added' ? r.name || 'Аккаунт VK' : r.reason || '';
          return (
            <li key={r.line} className={`vk-import-line is-${view.tone}`}>
              <span className="vk-import-no">Строка {r.line}</span>
              <span className={`badge ${view.tone}`}>{view.label}</span>
              <span className="vk-import-text" title={text}>
                {text}
                {r.warning ? <em> · {r.warning}</em> : null}
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
      <strong>Одна строка — один аккаунт</strong>
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
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [formError, setFormError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const activeProxies = proxies.filter((p) => p.active);
  const proxyLabel = useMemo(() => new Map(proxies.map((p) => [p.id, p.label])), [proxies]);
  const lineCount = useMemo(() => text.split(/\r?\n/).filter((l) => l.trim()).length, [text]);
  const views = accounts.map((a) => ({ ...a, view: vkAccountView(a.data, { searchCap }) }));
  const activeCount = views.filter((a) => a.view.status === 'active').length;
  const allSelected = accounts.length > 0 && accounts.every((a) => selected.includes(a.id));

  async function importAccounts() {
    const chunks = planVkImportChunks(text);
    if (!chunks.length) {
      setFormError('Вставьте хотя бы одну строку с токеном');
      textRef.current?.focus();
      return;
    }
    setFormError('');
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
    const tally = tallyVkImport(collected);
    if (!tally.invalid) setText('');
    if (tally.added || tally.no_proxy) toast.success(`VK: добавлено ${tally.added + tally.no_proxy} из ${collected.length}`);
    else toast.message('VK: новых аккаунтов нет');
    await onChanged();
  }

  async function changeProxy(id: string, value: string) {
    setRowBusy(id);
    try {
      const res = await run({ action: 'vk_account_set_proxy', id, proxyId: value === NO_PROXY ? '' : value });
      toast.success(res.status === 'no_proxy' ? 'Прокси отвязан — аккаунт не сканирует' : `Прокси привязан${res.name ? ` · ${String(res.name)}` : ''}`);
      await onChanged();
    } catch (e) {
      toast.error(`Прокси не привязан: ${errorText(e)}`);
    } finally {
      setRowBusy(null);
    }
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

  return (
    <section className="vk-section" aria-labelledby="vk-accounts-title">
      <div className="vk-section-head">
        <div className="min-w-0">
          <h2 id="vk-accounts-title" className="vk-section-title">
            <span className="badge platform-vk">VK</span>Аккаунты VK
          </h2>
          <p className="small-note mt-1">Только чтение: ищут посты и комментарии с запросами клиентов. До {perProxyCap} аккаунтов на один прокси.</p>
        </div>
        {accounts.length > 0 && <span className="badge neutral">Активных {activeCount} из {accounts.length}</span>}
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
            aria-describedby={formError ? 'vk-import-error' : undefined}
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
          {!activeProxies.length && (
            <p className="small-note vk-hint-warn"><AlertTriangle size={13} />Нет активного прокси — аккаунты сохранятся без проверки со статусом «Нет прокси».</p>
          )}
        </div>
        {results ? <ImportResults results={results} progress={progress} /> : <ImportFormats />}
      </div>

      {accounts.length > 0 && (
      <div className={`groups-actionbar ${selected.length ? 'has-sel' : ''}`}>
        <div className="groups-actionbar-left">
          {selected.length ? <strong>Выбрано {selected.length}</strong> : <span className="muted text-sm">Отметьте аккаунты для массового удаления</span>}
        </div>
        <div className="groups-actionbar-right">
          {selected.length > 0 && (
            <>
              <Button size="sm" variant="outline" className="vk-danger-text" disabled={!!rowBusy} onClick={() => setConfirmIds(selected)}>
                <Trash2 size={14} />Удалить {selected.length}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Снять</Button>
            </>
          )}
        </div>
      </div>
      )}

      <div className="panel table-panel vk-list">
        {loading ? (
          <div className="p-4 space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
        ) : !accounts.length ? (
          <div className="vk-empty">
            <p><strong>VK-аккаунтов пока нет.</strong> Вставьте токены выше — после первого рабочего аккаунта появится источник «Поиск VK по ключевым словам».</p>
            <Button variant="outline" size="sm" onClick={() => textRef.current?.focus()}>Вставить список</Button>
          </div>
        ) : (
          <>
            <div className="vk-rows-cols">
              <span className="vk-cell-check">
                <Checkbox checked={allSelected} onCheckedChange={(v) => setSelected(v === true ? accounts.map((a) => a.id) : [])} aria-label="Выбрать все VK-аккаунты" />
              </span>
              <span>Аккаунт</span>
              <span>Прокси</span>
              <span>Статус</span>
              <span>Сегодня</span>
              <span className="sr-only">Действие</span>
            </div>
            {views.map(({ id, data, view }) => {
              const Icon = STATUS_ICON[view.tone];
              const busy = rowBusy === id || rowBusy === 'bulk';
              const proxyValue = data.proxyId && proxyLabel.has(data.proxyId) ? data.proxyId : NO_PROXY;
              const searchOver = view.searchCap > 0 && view.searchCalls >= view.searchCap;
              return (
                <div key={id} className={`vk-row ${selected.includes(id) ? 'is-selected' : ''}`}>
                  <span className="vk-cell-check">
                    <Checkbox
                      checked={selected.includes(id)}
                      onCheckedChange={(v) => setSelected((prev) => (v === true ? [...prev, id] : prev.filter((x) => x !== id)))}
                      aria-label={`Выбрать ${data.name}`}
                    />
                  </span>
                  <div className="vk-cell-main min-w-0">
                    <strong className="vk-name" title={data.name}>{data.name || 'Без имени'}</strong>
                    <span className="vk-sub">{data.vkUserId ? `vk.com/id${data.vkUserId}` : 'не проверен'}</span>
                  </div>
                  <div className="vk-cell-proxy min-w-0">
                    <Select value={proxyValue} disabled={busy} onValueChange={(v) => void changeProxy(id, v)}>
                      <SelectTrigger className="vk-row-proxy" aria-label={`Прокси для ${data.name}`}>
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
                    <div className="acc-status-text min-w-0">
                      <strong>{view.label}</strong>
                      {view.detail ? <span className="vk-status-detail" title={view.detail}>{view.detail}</span> : null}
                    </div>
                  </div>
                  <div className="vk-cell-usage acc-limits" title="Счётчики сбрасываются в полночь МСК">
                    <span title="Запросы к VK за сегодня"><Zap size={13} /><em>{view.calls}</em></span>
                    <span className={searchOver ? 'is-over' : ''} title="Поиск по ключевым словам: сегодня / дневной лимит">
                      <Search size={13} /><em>{view.searchCalls}/{view.searchCap || '∞'}</em>
                    </span>
                  </div>
                  <div className="vk-cell-actions">
                    <Button variant="ghost" size="icon" className="vk-danger-text" disabled={busy} aria-label={`Удалить ${data.name}`} onClick={() => setConfirmIds([id])}>
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
                ? `Удалить VK-аккаунт «${accounts.find((a) => a.id === confirmIds[0])?.data.name || ''}»?`
                : `Удалить VK-аккаунты: ${confirmIds?.length || 0}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>Токены удаляются без восстановления — чтобы вернуть аккаунт, импортируйте его заново. Найденные лиды останутся.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Оставить</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirmIds) void deleteAccounts(confirmIds); }}>
              Удалить{confirmIds && confirmIds.length > 1 ? ` ${confirmIds.length}` : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
