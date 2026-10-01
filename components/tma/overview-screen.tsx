"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { OverviewFeed } from "@/lib/tma/contract";
import { useOnline } from "@/components/tma/context";
import type { FeedResult } from "@/components/tma/context";
import { formatNumber, plural } from "@/components/tma/format";
import { ErrorState, InlineNotice, PullScroll, RefreshButton, ScreenHeader, Section } from "@/components/tma/parts";

export type TabId = "inbox" | "accounts" | "tasks" | "overview";

const TODAY = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", weekday: "long" });

export function OverviewScreen({ feed, onGo }: { feed: FeedResult<OverviewFeed>; onGo(tab: TabId): void }) {
  const online = useOnline();
  const d = feed.data;
  return (
    <>
      <ScreenHeader title="Сводка" meta={`Сегодня, ${TODAY.format(new Date())}`} action={<RefreshButton onClick={() => void feed.reload()} busy={feed.refreshing} />} />
      <PullScroll onRefresh={feed.reload} className="pt-1">
        {feed.refreshError ? <InlineNotice tone="danger">Не удалось обновить: {feed.refreshError.message}</InlineNotice> : null}
        {feed.status === "loading" ? <OverviewSkeleton /> : null}
        {feed.status === "error" && feed.error ? <ErrorState error={feed.error} online={online} onRetry={() => void feed.reload()} /> : null}
        {d ? (
          <>
            <Section title="За сегодня">
              <button type="button" onClick={() => onGo("inbox")} className="flex w-full items-end justify-between gap-3 px-4 pt-3.5 pb-3 text-left active:bg-(--tma-fill)">
                <span className="flex flex-col">
                  <span className="text-[14px] text-(--tma-hint)">Новые лиды</span>
                  <span className="tma-num text-[34px] leading-10 font-semibold tracking-[-0.02em]">{formatNumber(d.today.newLeads)}</span>
                </span>
                <span className="flex items-center gap-1 pb-1.5 text-[15px]">
                  <span className="tma-num font-semibold">{formatNumber(d.today.hotLeads)}</span>
                  <span className="text-(--tma-hint)">{plural(d.today.hotLeads, ["горячий", "горячих", "горячих"])}</span>
                  <ChevronRight className="size-4 text-(--tma-hint)" aria-hidden />
                </span>
              </button>
              <div className="grid grid-cols-3 border-t border-(--tma-separator)">
                <Stat label="Ответы" value={d.today.replies} onClick={() => onGo("inbox")} />
                <Stat label="Отправлено" value={d.today.sent} onClick={() => onGo("tasks")} className="border-x border-(--tma-separator)" />
                <Stat label="Инвайты" value={d.today.invites} onClick={() => onGo("tasks")} />
              </div>
            </Section>
            <Section title="Аккаунты">
              <NavRow
                onClick={() => onGo("accounts")}
                title={`${formatNumber(d.accounts.total)} ${plural(d.accounts.total, ["аккаунт", "аккаунта", "аккаунтов"])}`}
                detail={
                  <>
                    {d.accounts.ok} в работе
                    {d.accounts.problems ? (
                      <>
                        {" · "}
                        <span className="text-(--tma-destructive)">
                          {d.accounts.problems} {plural(d.accounts.problems, ["с проблемой", "с проблемами", "с проблемами"])}
                        </span>
                      </>
                    ) : null}
                  </>
                }
              />
            </Section>
            <Section title="Задачи">
              <NavRow
                onClick={() => onGo("tasks")}
                title={`${d.tasks.running} ${plural(d.tasks.running, ["работает", "работают", "работают"])}`}
                detail={
                  <>
                    {d.tasks.paused} на паузе
                    {d.tasks.error ? (
                      <>
                        {" · "}
                        <span className="text-(--tma-destructive)">
                          {d.tasks.error} с ошибкой
                        </span>
                      </>
                    ) : null}
                  </>
                }
              />
            </Section>
          </>
        ) : null}
      </PullScroll>
    </>
  );
}

function Stat({ label, value, onClick, className }: { label: string; value: number; onClick(): void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex min-w-0 flex-col px-4 py-3 text-left active:bg-(--tma-fill)", className)}>
      <span className="tma-num text-[22px] leading-7 font-semibold">{formatNumber(value)}</span>
      <span className="truncate text-[13px] text-(--tma-hint)">{label}</span>
    </button>
  );
}

function NavRow({ title, detail, onClick }: { title: string; detail: ReactNode; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-(--tma-fill)">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="tma-num text-[16px] font-semibold">{title}</span>
        <span className="tma-num truncate text-[14px] text-(--tma-hint)">{detail}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-(--tma-hint)" aria-hidden />
    </button>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загрузка" className="flex flex-col gap-5 px-4 pt-2">
      <div className="flex flex-col gap-3 rounded-(--tma-radius-section) bg-(--tma-section) p-4">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-9 w-20" />
        <div className="grid grid-cols-3 gap-4 pt-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      </div>
      <Skeleton className="h-14 rounded-(--tma-radius-section)" />
      <Skeleton className="h-14 rounded-(--tma-radius-section)" />
    </div>
  );
}
