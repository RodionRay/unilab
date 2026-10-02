"use client";

import type { ReactNode } from "react";
import { Clock3, Link2Off, MessageCircle, ServerCrash, WifiOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { TgWebApp } from "@/components/tma/telegram";

/** Full-screen state shown instead of the app: one icon, one sentence of why, one way forward. */
function Gate({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <main className="tma-scroll flex flex-col items-center justify-center gap-4 px-8 pb-[max(24px,var(--tma-inset-bottom))] text-center" data-testid="tma-gate">
      <span className="grid size-16 place-items-center rounded-full bg-(--tma-fill) text-(--tma-text)" aria-hidden>
        {icon}
      </span>
      <h1 className="text-[20px] leading-6 font-semibold text-balance">{title}</h1>
      <div className="flex max-w-[320px] flex-col gap-3 text-[15px] leading-snug text-(--tma-hint)">{children}</div>
      {action}
    </main>
  );
}

function GateButton({ onClick, children }: { onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 min-h-12 w-full max-w-[320px] rounded-xl bg-(--tma-button) px-5 text-[16px] font-semibold text-(--tma-button-text) active:opacity-80"
    >
      {children}
    </button>
  );
}

/** REQ-S3: outside Telegram there is no WebApp API, so the bot is a plain link (t.me opens the Telegram app). */
export function OutsideTelegramGate({ botLink }: { botLink: string }) {
  return (
    <Gate
      icon={<MessageCircle className="size-7" />}
      title="Откройте из бота"
      action={
        botLink ? (
          <a
            href={botLink}
            className="mt-2 flex min-h-12 w-full max-w-[320px] items-center justify-center rounded-xl bg-(--tma-button) px-5 text-[16px] font-semibold text-(--tma-button-text) active:opacity-80"
          >
            Открыть бота
          </a>
        ) : null
      }
    >
      <p>Это приложение UniLab работает внутри Telegram. Откройте бота вашего рабочего пространства и нажмите кнопку «Открыть» в меню чата.</p>
      {botLink ? null : <p>Ссылку на бота можно найти в UniLab на компьютере: Настройки → Telegram-приложение.</p>}
    </Gate>
  );
}

export function SessionExpiredGate({ app }: { app: TgWebApp | null }) {
  return (
    <Gate
      icon={<Clock3 className="size-7" />}
      title="Сессия истекла — откройте заново из бота"
      action={app ? <GateButton onClick={() => app.close()}>Закрыть</GateButton> : null}
    >
      <p>Вход действует один час. Закройте приложение и снова нажмите «Открыть» в чате с ботом — данные загрузятся заново.</p>
    </Gate>
  );
}

export function NotLinkedGate({ app, botLink }: { app: TgWebApp | null; botLink: string }) {
  return (
    <Gate
      icon={<Link2Off className="size-7" />}
      title="Telegram не подключён к рабочему пространству"
      action={app && botLink ? <GateButton onClick={() => app.openTelegramLink(botLink)}>Открыть бота</GateButton> : null}
    >
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-left">
        <li>Откройте UniLab на компьютере → Настройки → Telegram-приложение.</li>
        <li>Нажмите «Подключить Telegram» и перейдите по ссылке в этого бота.</li>
        <li>Вернитесь сюда и откройте приложение заново.</li>
      </ol>
    </Gate>
  );
}

export function UnavailableGate() {
  return (
    <Gate icon={<ServerCrash className="size-7" />} title="Рабочее пространство недоступно">
      <p>Ссылка устарела или бот рабочего пространства отключён. Попросите владельца заново подключить Telegram-приложение.</p>
    </Gate>
  );
}

export function BootErrorGate({ message, offline, onRetry }: { message: string; offline: boolean; onRetry(): void }) {
  return (
    <Gate
      icon={offline ? <WifiOff className="size-7" /> : <ServerCrash className="size-7" />}
      title={offline ? "Нет соединения" : "Не удалось войти"}
      action={<GateButton onClick={onRetry}>Повторить</GateButton>}
    >
      <p>{offline ? "Проверьте интернет и повторите." : message}</p>
    </Gate>
  );
}

/** First paint while the session is exchanged: the inbox shape, not a spinner. */
export function BootSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загрузка" className="flex flex-1 flex-col" data-testid="tma-boot">
      <div className="flex flex-col gap-2 px-4 pt-3 pb-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-3.5 w-44" />
      </div>
      <Skeleton className="mx-4 mb-3 h-10 rounded-full" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          <Skeleton className="size-[52px] shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3.5 w-11/12" />
          </div>
        </div>
      ))}
    </div>
  );
}
