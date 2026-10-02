'use client';

import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ExternalLink, Loader2, RefreshCw, Smartphone, Unlink } from 'lucide-react';
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
  badgeFor,
  classifyFailure,
  cooldownLeftSec,
  createLinkPoller,
  describeDmError,
  formatCooldown,
  initialLinkState,
  linkReducer,
  minutesLeft,
  noticesOffHint,
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
  /** `card` in «Настройки»; `dialog` inside TmaLinkDialog, whose surface already is the card. */
  variant?: 'card' | 'dialog';
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
    return { ok: false, failure: classifyFailure(action, null, null, null, Date.now()) };
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.ok && body && typeof body === 'object' && 'linked' in body) return { ok: true, status: body as LinkStatus };
  return { ok: false, failure: classifyFailure(action, res.ok ? 502 : res.status, body, res.headers.get('Retry-After'), Date.now()) };
}

const LINK_CLASS = 'rounded-full min-h-10 max-sm:min-h-11! px-[18px] font-semibold';
const BTN_CLASS = 'max-sm:min-h-11!';
/** `.settings-check span { flex: 1 }` (globals.css) would stretch the switch thumb; keep it a fixed circle. */
const SWITCH_CLASS = 'mt-1 data-[state=unchecked]:bg-white/20! [&>[data-slot=switch-thumb]]:flex-none! [&>[data-slot=switch-thumb]]:p-0! [&>[data-slot=switch-thumb]]:bg-white!';

/** Tonal destructive pill: the spike error colour on its light fill (the accent gradient stays for safe actions). */
const DANGER_CLASS = 'bg-[var(--spike-error-light)]! text-[var(--spike-error)]! border! border-[rgba(251,151,125,0.35)]! hover:bg-[rgba(251,151,125,0.22)]!';
/** Spinner next to 12 px hint text: sits on the first line instead of centring on a wrapped paragraph. */
const HINT_SPINNER = 'mt-[2px] shrink-0 animate-spin';

/** A failed toggle or a lost link is retried as a status refresh, never as a blind repeat. */
function retryAction(failure: LinkFailure): LinkAction {
  return failure.action === 'set_dm_notices' || failure.kind === 'not_linked' ? 'status' : failure.action;
}

export function TmaLinkPanel({ botConfigured, variant = 'card' }: Props) {
  const [state, dispatch] = useReducer(linkReducer, botConfigured, initialLinkState);
  const [now, setNow] = useState(() => Date.now());
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const mounted = useRef(true);

  /** Sends the request and applies the result; the caller marks the request as busy beforehand. */
  const settle = useCallback(async (action: LinkAction, extra: { enabled?: boolean } = {}) => {
    const result = await postLink(action, extra);
    if (!mounted.current) return;
    if (!result.ok) {
      // Start the rate-limit countdown from the response moment, not from the last clock tick.
      setNow(Date.now());
      return dispatch({ type: 'failed', failure: result.failure });
    }
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

  // Rate limit: tick once a second until Retry-After elapses so the disabled buttons count down and re-enable.
  const retryAtMs = state.failure?.retryAtMs ?? 0;
  useEffect(() => {
    if (!retryAtMs) return;
    const tick = setInterval(() => {
      const nowMs = Date.now();
      setNow(nowMs);
      if (nowMs >= retryAtMs) clearInterval(tick);
    }, 1000);
    return () => clearInterval(tick);
  }, [retryAtMs]);

  const badge = badgeFor(state);
  const cooldown = cooldownLeftSec(state.failure, now);

  return (
    <section className={variant === 'card' ? 'settings-card' : 'grid gap-[18px]'} aria-labelledby="tma-link-title" data-testid="tma-link-panel">
      {/* The dialog's close button sits in the top-right corner: keep the badge clear of it. */}
      <div className={variant === 'card' ? 'settings-card-head' : 'settings-card-head pr-8'}>
        <div className="title-icon">
          <div className="icon-box"><Smartphone size={20} aria-hidden /></div>
          <div>
            <h2 id="tma-link-title">Telegram-приложение</h2>
            <p className="small-note">Лиды, ответы клиентам и задачи с телефона: мини-приложение открывается в боте уведомлений</p>
          </div>
        </div>
        {badge && <span className={`badge ${badge.tone}`}>{badge.text}</span>}
      </div>
      <div className="settings-fields">
        <PanelBody state={state} now={now} cooldown={cooldown} run={run} onCancel={() => dispatch({ type: 'cancel_code' })} onUnlink={() => setConfirmUnlink(true)}/>
        {state.failure && <FailureLine failure={state.failure} busy={state.busy !== null} cooldown={cooldown} onRetry={() => void run(retryAction(state.failure!))}/>}
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
            <AlertDialogCancel variant="default">Оставить</AlertDialogCancel>
            <AlertDialogAction variant="outline" className={DANGER_CLASS} onClick={() => void run('unlink')}>
              <Unlink size={15} aria-hidden/>Отключить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

type BodyProps = {
  state: LinkState;
  now: number;
  /** Seconds left of a rate-limit wait: connecting again is disabled meanwhile. */
  cooldown: number;
  run: (action: LinkAction, extra?: { enabled?: boolean }) => Promise<void>;
  onCancel: () => void;
  onUnlink: () => void;
};

function PanelBody({ state, now, cooldown, run, onCancel, onUnlink }: BodyProps) {
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
      <p className="settings-hint flex items-start gap-2">
        <Loader2 size={13} className={HINT_SPINNER} aria-hidden/>Проверяем подключение…
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
          <Button variant="ghost" className={BTN_CLASS} onClick={onCancel}>Скрыть ссылку</Button>
        </div>
        <p className="settings-hint flex items-start gap-2" data-testid="tma-countdown">
          <Loader2 size={13} className={HINT_SPINNER} aria-hidden/>
          <span>Проверяем подключение каждые несколько секунд. Ссылка одноразовая, действует ещё {pluralMinutes(left)}.</span>
        </p>
      </>
    );
  }
  const expired = state.phase === 'expired';
  return (
    <>
      {expired
        ? <Note testId="tma-expired">Ссылка истекла, подключение не завершено. Получите новую ссылку.</Note>
        : (
          <ol className="settings-steps">
            <li>Нажмите <strong>Подключить Telegram</strong>: появится личная ссылка на бота уведомлений.</li>
            <li>Откройте бота и нажмите <strong>Старт</strong>. Ссылка действует 10 минут.</li>
            <li>Приложение откроется кнопкой в чате с ботом. Права те же, что в кабинете.</li>
          </ol>
        )}
      <div className="settings-actions-btns">
        <Button className={BTN_CLASS} disabled={state.busy !== null || cooldown > 0} onClick={() => void run('create_code')}>
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
  const dm = describeDmError(status.dmError);
  const offHint = noticesOffHint(status);
  const describedBy = [dm && 'tma-dm-error', offHint && 'tma-notices-off'].filter(Boolean).join(' ') || undefined;
  return (
    <>
      <div data-testid="tma-linked">
        <p className="text-sm font-semibold text-[var(--spike-text)] [overflow-wrap:anywhere]">
          <span className="text-[var(--spike-muted)] font-medium">Аккаунт Telegram: </span>
          {status.tgUsername ? `@${status.tgUsername}` : 'без username'}
        </p>
        <p className="settings-hint mt-1">Приложение открывается кнопкой в чате с ботом. Права те же, что у вас в кабинете.</p>
      </div>
      <div className="grid gap-2">
        <label className="settings-check" htmlFor="tma-dm-switch">
          <span>
            Личные уведомления о горячих лидах и ответах
            <span className="settings-hint block mt-1">Бот пишет вам в личный чат с кнопкой «Открыть» на нужного лида. Сохраняется сразу.</span>
          </span>
          {busy === 'set_dm_notices' && <Loader2 size={14} className="animate-spin mt-1 shrink-0" aria-hidden/>}
          <Switch
            id="tma-dm-switch"
            className={SWITCH_CLASS}
            checked={status.dmNotices}
            disabled={busy !== null}
            aria-describedby={describedBy}
            onCheckedChange={(v) => void run('set_dm_notices', { enabled: v })}
          />
        </label>
        {dm && (
          <p id="tma-dm-error" role="alert" className="flex items-start gap-1.5 px-1 text-xs font-medium leading-snug text-[var(--spike-error)]">
            <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden/>
            <span>
              {dm.text}
              {dm.openBot && status.botLink && (
                <> <a className="underline underline-offset-2 font-semibold" href={status.botLink} target="_blank" rel="noopener noreferrer">Открыть бота<span className="sr-only"> (откроется в новой вкладке)</span></a></>
              )}
            </span>
          </p>
        )}
        {offHint && <Note id="tma-notices-off" testId="tma-notices-off">{offHint}</Note>}
      </div>
      {!status.appUrl && (
        <p className="settings-hint" data-testid="tma-no-app-url">
          Кнопка приложения в боте появится, когда администратор подключит домен UniLab.
        </p>
      )}
      <div className="settings-actions-btns">
        {status.botLink && (
          <Button asChild className={LINK_CLASS}>
            <a href={status.botLink} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} aria-hidden/>Открыть бота<span className="sr-only"> (откроется в новой вкладке)</span>
            </a>
          </Button>
        )}
        <Button variant="ghost" className={BTN_CLASS} disabled={busy !== null} onClick={onUnlink}>
          {busy === 'unlink' ? <Loader2 size={15} className="animate-spin" aria-hidden/> : <Unlink size={15} aria-hidden/>}Отключить
        </Button>
      </div>
    </>
  );
}

/** Warning-tone notice (expired link, notices switched off): spike warning on its light fill. */
function Note({ id, testId, children }: { id?: string; testId: string; children: ReactNode }) {
  return (
    <p id={id} data-testid={testId} className="flex items-start gap-2 rounded-[14px] border border-[rgba(255,213,138,0.22)] bg-[var(--spike-warning-light)] px-3.5 py-2.5 text-[0.8125rem] font-medium leading-snug text-[var(--spike-warning)]">
      <AlertTriangle size={14} className="mt-[2px] shrink-0" aria-hidden/>
      <span>{children}</span>
    </p>
  );
}

type FailureProps = { failure: LinkFailure; busy: boolean; cooldown: number; onRetry: () => void };

function FailureLine({ failure, busy, cooldown, onRetry }: FailureProps) {
  // With a known Retry-After the countdown lives on the disabled button, so the text drops the stale «через 9 минут».
  const text = failure.retryAtMs ? 'Слишком много попыток подключения.' : failure.message;
  return (
    <div className="form-error flex flex-wrap items-center justify-between gap-2" role="alert" data-testid="tma-error">
      {/* .form-error text (#9a4a36) is made for light cards; on the dark settings card it needs the spike error tone. */}
      <span className="text-[var(--spike-error)] font-medium">{text}</span>
      {failure.kind !== 'session' && (
        <Button variant="outline" size="sm" className={`${BTN_CLASS} tabular-nums`} disabled={busy || cooldown > 0} onClick={onRetry}>
          <RefreshCw size={14} aria-hidden/>{cooldown > 0 ? `Повторить через ${formatCooldown(cooldown)}` : 'Повторить'}
        </Button>
      )}
    </div>
  );
}
