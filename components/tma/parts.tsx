"use client";

import { useRef, useState, type ReactNode } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import type { TmaApiError } from "@/lib/tma/client";
import { initialOf, peerColor } from "@/components/tma/format";

export function Avatar({ id, name, username, size = 52 }: { id: string; name: string; username: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white select-none"
      style={{ width: size, height: size, background: peerColor(id || name), fontSize: Math.round(size * 0.42) }}
    >
      {initialOf(name, username)}
    </span>
  );
}

/** Screen title row (Telegram's header above shows the bot; this names the tab). */
export function ScreenHeader({ title, meta, action }: { title: string; meta?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 px-4 pt-3 pb-2">
      <div className="min-w-0">
        <h1 tabIndex={-1} className="truncate text-[22px] leading-7 font-bold tracking-[-0.01em] outline-none">
          {title}
        </h1>
        {meta ? <p className="truncate text-[13px] text-(--tma-hint)">{meta}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function RefreshButton({ onClick, busy }: { onClick(): void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label="Обновить"
      className="-mr-2 grid size-11 shrink-0 place-items-center rounded-full text-(--tma-link) active:bg-(--tma-fill)"
    >
      <RefreshCw className={cn("size-[20px]", busy && "animate-spin")} aria-hidden />
    </button>
  );
}

/** Inset grouped section (Telegram settings / @wallet pattern). */
export function Section({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("px-4 pb-5", className)}>
      {title ? (
        <div className="flex items-baseline justify-between gap-2 px-4 pb-1.5 text-[13px] text-(--tma-section-header)">
          <h2 className="font-medium">{title}</h2>
          {aside ? <span>{aside}</span> : null}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-(--tma-radius-section) bg-(--tma-section)">{children}</div>
    </section>
  );
}

export function ListSkeleton({ rows = 6, avatar = true }: { rows?: number; avatar?: boolean }) {
  return (
    <div aria-busy="true" aria-label="Загрузка" className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          {avatar ? <Skeleton className="size-[52px] shrink-0 rounded-full" /> : null}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SectionSkeleton({ sections = 2, rows = 2 }: { sections?: number; rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Загрузка" className="flex flex-col pt-2">
      {Array.from({ length: sections }, (_, s) => (
        <div key={s} className="px-4 pb-5">
          <Skeleton className="mb-2 ml-4 h-3 w-24" />
          <div className="flex flex-col gap-4 rounded-(--tma-radius-section) bg-(--tma-section) p-4">
            {Array.from({ length: rows }, (_, r) => (
              <div key={r} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-1.5 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function errorCopy(error: TmaApiError, online: boolean): { title: string; text: string } {
  if (!online || error.code === "network") {
    return { title: "Нет соединения", text: "Проверьте интернет — данные загрузятся, как только связь вернётся." };
  }
  if (error.code === "forbidden") return { title: "Нет доступа", text: error.message || "У вашей роли нет доступа к этому разделу." };
  if (error.code === "rate_limited") return { title: "Слишком много запросов", text: "Подождите минуту и повторите." };
  return { title: "Не удалось загрузить", text: error.message };
}

export function ErrorState({ error, online, onRetry }: { error: TmaApiError; online: boolean; onRetry(): void }) {
  const copy = errorCopy(error, online);
  return (
    <Empty className="py-16" role="alert">
      <EmptyHeader>
        {!online || error.code === "network" ? <WifiOff className="mb-1 size-8 text-(--tma-hint)" aria-hidden /> : null}
        <EmptyTitle className="text-[17px] font-semibold">{copy.title}</EmptyTitle>
        <EmptyDescription className="text-[15px] text-(--tma-hint)">{copy.text}</EmptyDescription>
      </EmptyHeader>
      {error.code !== "forbidden" ? (
        <EmptyContent>
          <button type="button" onClick={onRetry} className="min-h-11 px-4 text-[15px] font-medium text-(--tma-link)">
            Повторить
          </button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

export function EmptyState({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <Empty className="py-14">
      <EmptyHeader>
        <EmptyTitle className="text-[17px] font-semibold">{title}</EmptyTitle>
        {text ? <EmptyDescription className="text-[15px] text-(--tma-hint)">{text}</EmptyDescription> : null}
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  );
}

export function OfflineBanner() {
  return (
    <div role="status" className="flex items-center gap-2 bg-(--tma-fill) px-4 py-2 text-[13px] text-(--tma-hint)">
      <WifiOff className="size-4 shrink-0" aria-hidden />
      Нет соединения — показаны последние загруженные данные
    </div>
  );
}

export function InlineNotice({ children, tone = "hint" }: { children: ReactNode; tone?: "hint" | "danger" }) {
  return (
    <p role={tone === "danger" ? "alert" : "status"} className={cn("px-4 py-2 text-[13px]", tone === "danger" ? "text-(--tma-destructive)" : "text-(--tma-hint)")}>
      {children}
    </p>
  );
}

const PULL_TRIGGER = 64;

/**
 * Scroll container with pull-to-refresh (touch). Vertical swipes are disabled at the
 * Telegram level (disableVerticalSwipes), so the pull does not collapse the mini app.
 */
export function PullScroll({ onRefresh, children, className }: { onRefresh(): Promise<void>; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);

  function onTouchStart(e: React.TouchEvent) {
    start.current = (ref.current?.scrollTop ?? 1) <= 0 && !busy ? (e.touches[0]?.clientY ?? null) : null;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (start.current === null) return;
    const dy = (e.touches[0]?.clientY ?? 0) - start.current;
    setPull(dy > 0 ? Math.min(dy * 0.5, 96) : 0);
  }
  async function onTouchEnd() {
    const trigger = pull >= PULL_TRIGGER;
    start.current = null;
    setPull(0);
    if (!trigger) return;
    setBusy(true);
    try {
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className={cn("tma-scroll", className)} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {pull > 0 || busy ? (
        <div className="flex items-center justify-center gap-2 text-[13px] text-(--tma-hint)" style={{ height: busy ? 40 : pull }}>
          {busy ? <Spinner className="size-4" /> : pull >= PULL_TRIGGER ? "Отпустите, чтобы обновить" : "Потяните, чтобы обновить"}
        </div>
      ) : null}
      {children}
    </div>
  );
}
