'use client';

import { useState } from 'react';
import { Loader2, Plus, ScrollText, Search, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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
import type { VkSourceData } from '@/lib/vk/records';

export type VkSourceRecord = { id: string; data: VkSourceData };
type LogEntry = { at: string; level: 'info' | 'ok' | 'warn' | 'error'; text: string };

type Props = {
  sources: VkSourceRecord[];
  /** False when no VK account can scan (none, all errored or without proxy). */
  canScan: boolean;
  hasAccounts: boolean;
  loading: boolean;
  run: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  onChanged: () => Promise<void> | void;
  onOpenAccounts: () => void;
  onOpenLog: (title: string, log: LogEntry[]) => void;
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function scanTime(iso: string): string {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function sourceStatus(data: VkSourceData, now: number = Date.now()): { label: string; tone: string } {
  if (Date.parse(String(data.scanLockUntil || '')) > now) return { label: 'Сканируем…', tone: 'warning' };
  if (data.error) return { label: 'Ошибка', tone: 'danger' };
  if (!data.lastScanAt) return { label: 'Ждёт скана', tone: 'neutral' };
  return { label: 'Работает', tone: 'success' };
}

function sourceLog(d: VkSourceData): LogEntry[] {
  if (Array.isArray(d.scanLog) && d.scanLog.length) return d.scanLog;
  return [{ at: d.lastScanAt || new Date().toISOString(), level: 'info', text: d.lastScanAt ? 'Журнал появится после следующего скана' : 'Сканов ещё не было' }];
}

function scanToast(res: Record<string, unknown>, title: string) {
  if (res.skipped) {
    toast.message(String(res.message || 'Скан пропущен'));
    return;
  }
  const added = Number(res.added) || 0;
  const tail = res.error ? ` · ${String(res.error)}` : res.more ? ' · продолжим при следующем обходе' : '';
  if (added) toast.success(`${title}: +${added} лидов${tail}`);
  else toast.message(`${title}: новых лидов нет${tail}`);
}

export function VkSourcesPanel({ sources, canScan, hasAccounts, loading, run, onChanged, onOpenAccounts, onOpenLog }: Props) {
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<VkSourceRecord | null>(null);
  const ordered = [...sources].sort((a, b) => (a.data.type === 'search' ? -1 : 0) - (b.data.type === 'search' ? -1 : 0));
  const scanBlockedReason = !hasAccounts ? 'Сначала добавьте VK-аккаунт' : !canScan ? 'Нет активного VK-аккаунта с прокси' : '';

  async function addSource() {
    const value = url.trim();
    if (!value) return;
    // The server (lib/vk/url.ts::parseVkGroupUrl) owns the format rule and answers with the fix.
    setAdding(true);
    setUrlError('');
    try {
      const res = await run({ action: 'vk_source_add', url: value });
      const title = (res.source as { title?: string } | undefined)?.title;
      toast.success(`Сообщество добавлено${title ? `: ${title}` : ''}`);
      setUrl('');
      await onChanged();
    } catch (e) {
      setUrlError(errorText(e));
    } finally {
      setAdding(false);
    }
  }

  async function scan(src: VkSourceRecord) {
    setScanning(src.id);
    try {
      scanToast(await run({ action: 'scan_vk_source', id: src.id, force: true }), src.data.title || 'VK');
    } catch (e) {
      toast.error(`${src.data.title || 'VK'}: ${errorText(e)}`);
    } finally {
      setScanning(null);
      await onChanged();
    }
  }

  async function remove(src: VkSourceRecord) {
    setConfirm(null);
    try {
      await run({ action: 'vk_source_delete', id: src.id });
      toast.success(`Источник удалён: ${src.data.title || 'VK'}`);
      await onChanged();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <section className="vk-section" aria-labelledby="vk-sources-title">
      <div className="vk-section-head">
        <div className="min-w-0">
          <h2 id="vk-sources-title" className="vk-section-title">
            <span className="badge platform-vk">VK</span>Источники VK
          </h2>
          <p className="small-note mt-1">Поиск по ключевым словам из настроек и стены сообществ: посты, комментарии, обсуждения.</p>
        </div>
        <form
          className="vk-source-add"
          onSubmit={(e) => { e.preventDefault(); void addSource(); }}
          noValidate
        >
          <label htmlFor="vk-source-url" className="sr-only">Ссылка на сообщество VK</label>
          <Input
            id="vk-source-url"
            value={url}
            inputMode="url"
            autoComplete="off"
            placeholder="vk.com/имя_сообщества"
            aria-invalid={urlError ? true : undefined}
            aria-describedby={urlError ? 'vk-source-error' : undefined}
            disabled={adding}
            onChange={(e) => { setUrl(e.target.value); if (urlError) setUrlError(''); }}
          />
          <Button type="submit" variant="outline" disabled={adding || !url.trim() || !canScan} title={scanBlockedReason || undefined}>
            {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}Сообщество
          </Button>
        </form>
      </div>
      {urlError && <p id="vk-source-error" className="vk-field-error vk-source-error" role="alert">{urlError}</p>}

      <div className="panel table-panel vk-list">
        {loading ? (
          <div className="p-4 space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
        ) : !ordered.length ? (
          <div className="vk-empty">
            <p>
              <strong>{hasAccounts ? 'Источников VK пока нет.' : 'Для VK нужен хотя бы один аккаунт.'}</strong>{' '}
              {hasAccounts
                ? 'Добавьте сообщество по ссылке — поиск по ключевым словам появится после проверки аккаунта.'
                : 'Импортируйте токены в «Аккаунтах» — поиск по ключевым словам включится сам, сообщества добавляются здесь.'}
            </p>
            {!hasAccounts && <Button variant="outline" size="sm" onClick={onOpenAccounts}>Открыть аккаунты</Button>}
          </div>
        ) : (
          <>
            <div className="vk-src-cols">
              <span aria-hidden />
              <span>Источник</span>
              <span>Лиды</span>
              <span>Статус</span>
              <span>Скан</span>
              <span className="text-right">Действие</span>
            </div>
            {ordered.map((src) => {
              const d = src.data;
              const st = sourceStatus(d);
              const at = scanTime(d.lastScanAt);
              const isSearch = d.type === 'search';
              const busy = scanning === src.id;
              return (
                <div key={src.id} className="vk-src-row">
                  <span className="vk-src-icon" aria-hidden>{isSearch ? <Search size={15} /> : <Users size={15} />}</span>
                  <div className="vk-cell-main min-w-0">
                    <strong className="vk-name" title={d.title}>{d.title || 'Сообщество VK'}</strong>
                    <span className="vk-sub">{isSearch ? 'Ключевые слова из настроек AI' : d.screenName ? `vk.com/${d.screenName}` : d.vkGroupId ? `vk.com/club${d.vkGroupId}` : 'vk.com'}</span>
                    {d.error ? <span className="groups-err" title={d.error}>{d.error}</span> : null}
                  </div>
                  <div className="vk-src-leads">
                    <strong>{d.leadsTotal || 0}</strong>
                    {(d.leadsHot || 0) > 0 && <span className="muted"> · горячих {d.leadsHot}</span>}
                  </div>
                  <div className="vk-src-status"><span className={`badge ${st.tone}`}>{st.label}</span></div>
                  <div className="vk-src-sync" title={at ? `Последний скан ${at}` : 'Ещё не сканировали'}>
                    <span className="vk-src-sync-label">Скан</span>{at || '—'}
                  </div>
                  <div className="vk-cell-actions">
                    <Button size="sm" variant="outline" disabled={busy || !!scanBlockedReason} title={scanBlockedReason || undefined} onClick={() => void scan(src)}>
                      {busy ? <Loader2 className="animate-spin" size={14} /> : <Search size={14} />}
                      {busy ? 'Скан…' : 'Скан'}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Журнал: ${d.title}`} onClick={() => onOpenLog(d.title || 'VK', sourceLog(d))}>
                      <ScrollText size={14} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Удалить ${d.title}`} onClick={() => setConfirm(src)}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить источник «{confirm?.data.title}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.data.type === 'search'
                ? 'Поиск по ключевым словам остановится; он вернётся при следующем импорте или привязке прокси VK-аккаунта.'
                : 'Сообщество перестанет сканироваться. Найденные лиды останутся.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Оставить</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirm) void remove(confirm); }}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
