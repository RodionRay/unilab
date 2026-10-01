"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { OverviewFeed } from "@/lib/tma/contract";
import { useFeedQuery, useOnline, useTmaSession } from "@/components/tma/context";
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
            <Attention onGo={onGo} />
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

const ATTENTION_LIMIT = 4;

/** Problem accounts and failed tasks by name, with the reason in words — the things to fix today. */
function Attention({ onGo }: { onGo(tab: TabId): void }) {
  const { client } = useTmaSession();
  const accounts = useFeedQuery("overview:accounts", () => client.feed("accounts"));
  const tasks = useFeedQuery("overview:tasks", () => client.feed("tasks"));
  if (accounts.status === "loading" || tasks.status === "loading") {
    return (
      <Section title="Требуют внимания">
        <div aria-busy="true" aria-label="Загрузка" className="flex flex-col gap-3 p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-4 w-2/5" />
        </div>
      </Section>
    );
  }
  const rows = [
    ...(tasks.data?.items ?? [])
      .filter((t) => t.status === "error")
      .map((t) => ({ id: t.id, tab: "tasks" as const, title: t.name, kind: "ошибка задачи", danger: true, detail: t.error || "Остановлена с ошибкой" })),
    ...(accounts.data?.items ?? [])
      .filter((a) => a.health === "error" || a.health === "paused" || a.health === "setup")
      .map((a) => ({ id: a.id, tab: "accounts" as const, title: a.name, kind: a.statusLabel.toLowerCase(), danger: a.health === "error", detail: a.reason || a.statusLabel })),
  ];
  if (rows.length === 0) return null;
  const shown = rows.slice(0, ATTENTION_LIMIT);
  return (
    <Section title="Требуют внимания" aside={rows.length > ATTENTION_LIMIT ? `ещё ${rows.length - ATTENTION_LIMIT}` : undefined}>
      <ul>
        {shown.map((r) => (
          <li key={r.id} className="border-b border-(--tma-separator) last:border-b-0">
            <button type="button" onClick={() => onGo(r.tab)} className="flex w-full items-center gap-3 py-2.5 pr-3 pl-4 text-left active:bg-(--tma-fill)">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 truncate text-[16px] font-semibold">{r.title}</span>
                  <span className={cn("shrink-0 text-[13px]", r.danger ? "text-(--tma-destructive)" : "text-(--tma-hint)")}>{r.kind}</span>
                </span>
                <span className="tma-clamp-2 text-[14px] leading-snug text-(--tma-hint)">{r.detail}</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-(--tma-hint)" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Stat({ label, value, onClick, className }: { label: string; value: number; onClick(): void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex min-w-0 flex-col px-3 py-3 text-left active:bg-(--tma-fill) min-[380px]:px-4", className)}>
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
