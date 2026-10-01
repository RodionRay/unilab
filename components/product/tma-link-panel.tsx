'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw, Smartphone, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
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
import type { LinkStatus } from '@/lib/tma/contract';
import {
  classifyFailure,
  createLinkPoller,
  describeDmError,
  initialLinkState,
  linkReducer,
  minutesLeft,
  pluralMinutes,
  type LinkAction,
  type LinkFailure,
  type LinkState,
} from '@/components/product/tma-link-state';

/**
 * «Telegram-приложение» in web settings: the signed-in member links their own Telegram to the workspace bot
 * and opens the mini app from the phone. Spec: docs/project/specs/tg-mini-app.md REQ-L1, L4, N2.
 */
type Props = {
  /** false = no bot token saved (owner view); null = unknown (token is hidden from non-owners). */
  botConfigured: boolean | null;
};

type LinkResult = { ok: true; status: LinkStatus } | { ok: false; failure: LinkFailure };

async function postLink(action: LinkAction, extra: { enabled?: boolean } = {}): Promise<LinkResult> {
  let res: Response;
  try {
    res = await fetch('/api/tma/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ action, ...extra }),
    });
  } catch {
    return { ok: false, failure: classifyFailure(action, null, null, null) };
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.ok && body && typeof body === 'object' && 'linked' in body) return { ok: true, status: body as LinkStatus };
  return { ok: false, failure: classifyFailure(action, res.ok ? 502 : res.status, body, res.headers.get('Retry-After')) };
}

const LINK_CLASS = 'rounded-full min-h-10 max-sm:min-h-11! px-[18px] font-semibold';
const BTN_CLASS = 'max-sm:min-h-11!';

/** A failed toggle or a lost link is retried as a status refresh, never as a blind repeat. */
function retryAction(failure: LinkFailure): LinkAction {
  return failure.action === 'set_dm_notices' || failure.kind === 'not_linked' ? 'status' : failure.action;
}

function badgeFor(state: LinkState): { tone: 'success' | 'warning' | 'neutral'; text: string } {
  if (state.phase === 'linked') return { tone: 'success', text: 'Подключено' };
  if (state.phase === 'pending') return { tone: 'warning', text: 'Ждём подтверждения' };
  if (state.phase === 'no_bot') return { tone: 'neutral', text: 'Нужен бот' };
  return { tone: 'neutral', text: 'Не подключено' };
}

export function TmaLinkPanel({ botConfigured }: Props) {
  const [state, dispatch] = useReducer(linkReducer, botConfigured, initialLinkState);
  const [now, setNow] = useState(() => Date.now());
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const mounted = useRef(true);

  /** Sends the request and applies the result; the caller marks the request as busy beforehand. */
  const settle = useCallback(async (action: LinkAction, extra: { enabled?: boolean } = {}) => {
    const result = await postLink(action, extra);
    if (!mounted.current) return;
    if (!result.ok) return dispatch({ type: 'failed', failure: result.failure });
    if (action === 'status') dispatch({ type: 'status_loaded', status: result.status });
    else if (action === 'create_code') {
      const nowMs = Date.now();
      setNow(nowMs);
      dispatch({ type: 'code_created', status: result.status, nowMs });
    }
    else if (action === 'set_dm_notices') dispatch({ type: 'dm_saved', status: result.status });
    else dispatch({ type: 'unlinked', status: result.status });
  }, []);

  const run = useCallback(async (action: LinkAction, extra: { enabled?: boolean } = {}) => {
    dispatch({ type: 'request', action });
    await settle(action, extra);
  }, [settle]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    // initialLinkState already marks the first status request as busy.
    if (botConfigured === false) return;
    void postLink('status').then((r) => {
      if (!mounted.current) return;
      dispatch(r.ok ? { type: 'status_loaded', status: r.status } : { type: 'failed', failure: r.failure });
    });
  }, [botConfigured]);

  const expiresAtMs = state.code?.expiresAtMs ?? 0;
  useEffect(() => {
    if (state.phase !== 'pending' || !expiresAtMs) return;
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    const poller = createLinkPoller({
      expiresAtMs,
      fetchStatus: async () => {
        const r = await postLink('status');
        return r.ok ? r.status : null;
      },
      onStatus: (status) => { if (mounted.current) dispatch({ type: 'polled', status }); },
      onExpired: () => { if (mounted.current) dispatch({ type: 'expired' }); },
      isHidden: () => document.visibilityState === 'hidden',
      now: () => Date.now(),
    });
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      setNow(Date.now());
      poller.resume();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(clock);
      poller.stop();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [state.phase, expiresAtMs]);

  const badge = badgeFor(state);

  return (
    <section className="settings-card" aria-labelledby="tma-link-title" data-testid="tma-link-panel">
      <div className="settings-card-head">
        <div className="title-icon">
          <div className="icon-box"><Smartphone size={20} aria-hidden /></div>
          <div>
            <h2 id="tma-link-title">Telegram-приложение</h2>
            <p className="small-note">Лиды, ответы клиентам и задачи с телефона: мини-приложение открывается в боте уведомлений</p>
          </div>
        </div>
        <span className={`badge ${badge.tone}`}>{badge.text}</span>
      </div>
      <div className="settings-fields">
        <PanelBody state={state} now={now} run={run} onCancel={() => dispatch({ type: 'cancel_code' })} onUnlink={() => setConfirmUnlink(true)}/>
        {state.failure && <FailureLine failure={state.failure} busy={state.busy !== null} onRetry={() => void run(retryAction(state.failure!))}/>}
        <p className="sr-only" aria-live="polite" role="status">{state.announce}</p>
      </div>
      <AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отключить Telegram{state.status?.tgUsername ? ` @${state.status.tgUsername}` : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              Мини-приложение перестанет открываться из бота, личные уведомления прекратятся. Подключить снова можно в любой момент.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Оставить</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run('unlink')}>Отключить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

type BodyProps = {
  state: LinkState;
  now: number;
  run: (action: LinkAction, extra?: { enabled?: boolean }) => Promise<void>;
  onCancel: () => void;
  onUnlink: () => void;
};

function PanelBody({ state, now, run, onCancel, onUnlink }: BodyProps) {
  if (state.phase === 'no_bot') {
    return (
      <p className="settings-hint" data-testid="tma-no-bot">
        Сначала подключите бота в блоке «Уведомления в Telegram» выше и сохраните настройки: приложение открывается из этого бота.
      </p>
    );
  }
  if (state.phase === 'loading') {
    if (state.busy === null) return null;
    return (
      <p className="settings-hint inline-flex items-center gap-2">
        <Loader2 size={14} className="animate-spin" aria-hidden/>Проверяем подключение…
      </p>
    );
  }
  if (state.phase === 'linked' && state.status) return <LinkedBody status={state.status} busy={state.busy} run={run} onUnlink={onUnlink}/>;
  if (state.phase === 'pending' && state.code) {
    const left = minutesLeft(state.code.expiresAtMs, now);
    return (
      <>
        <ol className="settings-steps">
          <li>Откройте бота по кнопке ниже, лучше с телефона.</li>
          <li>Нажмите <strong>Старт</strong> в чате с ботом.</li>
          <li>Эта страница обновится сама, в боте появится кнопка приложения.</li>
        </ol>
        <div className="settings-actions-btns">
          <Button asChild className={LINK_CLASS}>
            <a href={state.code.startLink} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} aria-hidden/>Открыть бота и подключить<span className="sr-only"> (откроется в новой вкладке)</span>
            </a>
          </Button>
          <Button variant="ghost" className={BTN_CLASS} onClick={onCancel}>Отмена</Button>
        </div>
        <p className="settings-hint inline-flex items-center gap-2" data-testid="tma-countdown">
          <Loader2 size={13} className="animate-spin" aria-hidden/>
          Ждём подтверждения. Ссылка одноразовая, действует ещё {pluralMinutes(left)}.
        </p>
      </>
    );
  }
  const expired = state.phase === 'expired';
  return (
    <>
      {expired
        ? <p className="settings-hint" data-testid="tma-expired">Ссылка истекла, подключение не завершено. Получите новую ссылку.</p>
        : (
          <ol className="settings-steps">
            <li>Нажмите <strong>Подключить Telegram</strong>: появится личная ссылка на бота уведомлений.</li>
            <li>Откройте бота и нажмите <strong>Старт</strong>. Ссылка действует 10 минут.</li>
            <li>Приложение откроется кнопкой в чате с ботом. Права те же, что в кабинете.</li>
          </ol>
        )}
      <div className="settings-actions-btns">
        <Button className={BTN_CLASS} disabled={state.busy !== null} onClick={() => void run('create_code')}>
          {state.busy === 'create_code' ? <Loader2 size={15} className="animate-spin" aria-hidden/> : <Smartphone size={15} aria-hidden/>}
          {expired ? 'Получить новую ссылку' : 'Подключить Telegram'}
        </Button>
      </div>
    </>
  );
}

type LinkedProps = {
  status: LinkStatus;
  busy: LinkAction | null;
  run: BodyProps['run'];
  onUnlink: () => void;
};

function LinkedBody({ status, busy, run, onUnlink }: LinkedProps) {
  const dmText = describeDmError(status.dmError);
  return (
    <>
      <p className="settings-check cursor-default" data-testid="tma-linked">
        <span>
          Подключено: <strong className="[overflow-wrap:anywhere]">{status.tgUsername ? `@${status.tgUsername}` : 'Telegram без username'}</strong>
          <span className="settings-hint block mt-1">Мини-приложение открывается кнопкой в чате с ботом. Права те же, что у вас в кабинете.</span>
        </span>
      </p>
      <label className="settings-check" htmlFor="tma-dm-switch">
        <span>
          Личные уведомления о горячих лидах и ответах
          <span className="settings-hint block mt-1">Бот пишет вам в личный чат с кнопкой «Открыть» на нужного лида</span>
        </span>
        {busy === 'set_dm_notices' && <Loader2 size={14} className="animate-spin mt-1 shrink-0" aria-hidden/>}
        <Switch
          id="tma-dm-switch"
          className="mt-1"
          checked={status.dmNotices}
          disabled={busy !== null}
          aria-describedby={dmText ? 'tma-dm-error' : undefined}
          onCheckedChange={(v) => void run('set_dm_notices', { enabled: v })}
        />
      </label>
      {dmText && <p id="tma-dm-error" className="form-error" role="alert">{dmText}</p>}
      <div className="settings-actions-btns">
        {status.appUrl && (
          <Button asChild className={LINK_CLASS}>
            <a href={status.appUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} aria-hidden/>Открыть приложение<span className="sr-only"> (откроется в новой вкладке)</span>
            </a>
          </Button>
        )}
        <Button variant="ghost" className={BTN_CLASS} disabled={busy !== null} onClick={onUnlink}>
          {busy === 'unlink' ? <Loader2 size={15} className="animate-spin" aria-hidden/> : <Unlink size={15} aria-hidden/>}Отключить
        </Button>
      </div>
      {!status.appUrl && (
        <p className="settings-hint" data-testid="tma-no-app-url">
          Кнопка приложения появится, когда у UniLab будет публичный https-адрес (APP_URL): Telegram открывает только https.
        </p>
      )}
    </>
  );
}

function FailureLine({ failure, busy, onRetry }: { failure: LinkFailure; busy: boolean; onRetry: () => void }) {
  return (
    <div className="form-error flex flex-wrap items-center justify-between gap-2" role="alert" data-testid="tma-error">
      <span>{failure.message}</span>
      {failure.kind !== 'session' && (
        <Button variant="outline" size="sm" className={BTN_CLASS} disabled={busy} onClick={onRetry}>
          <RefreshCw size={14} aria-hidden/>Повторить
        </Button>
      )}
    </div>
  );
}
