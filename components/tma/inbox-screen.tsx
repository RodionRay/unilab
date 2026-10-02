"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Flame } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { InboxFilter, InboxPage, InboxRow } from "@/lib/tma/client";
import { toApiError, useFeedQuery, useOnline, useTmaSession } from "@/components/tma/context";
import { formatListTime } from "@/components/tma/format";
import { uniqueById } from "@/components/tma/inbox-pages";
import { Avatar, EmptyState, ErrorState, InlineNotice, ListSkeleton, PullScroll, RefreshButton, ScreenHeader } from "@/components/tma/parts";

const FILTERS: { id: InboxFilter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "hot", label: "Горячие" },
  { id: "unread", label: "Непрочитанные" },
  { id: "conversations", label: "Диалоги" },
];

const EMPTY_COPY: Record<InboxFilter, { title: string; text: string }> = {
  all: { title: "Новых лидов нет", text: "Лиды из групп появятся здесь, как только сканирование найдёт совпадения." },
  hot: { title: "Горячих лидов нет", text: "Здесь будут лиды, которые прямо сейчас ищут подрядчика." },
  unread: { title: "Всё прочитано", text: "Новые сообщения и лиды появятся здесь." },
  conversations: { title: "Диалогов пока нет", text: "Диалог появится, когда вы ответите лиду или он напишет первым." },
};

type More = { key: string; items: InboxRow[]; cursor: string | null; loading: boolean; error: string };

export function InboxScreen({
  onOpen,
  viewed,
  onCounts,
}: {
  onOpen(item: InboxRow): void;
  viewed: ReadonlySet<string>;
  onCounts(counts: InboxPage["counts"]): void;
}) {
  const { client, workspace, onFatal } = useTmaSession();
  const online = useOnline();
  const [filter, setFilter] = useState<InboxFilter>("all");
  const feed = useFeedQuery(`inbox:${filter}`, () => client.feed("inbox", { filter }));
  const [more, setMore] = useState<More | null>(null);

  const pageKey = feed.data ? `${filter}:${feed.data.nextCursor ?? ""}:${feed.data.items[0]?.id ?? ""}` : "";
  const extra = more && more.key === pageKey ? more : null;
  const items = feed.data ? uniqueById([...feed.data.items, ...(extra?.items ?? [])]) : [];
  const cursor = extra ? extra.cursor : (feed.data?.nextCursor ?? null);

  const loadMore = useCallback(async () => {
    if (!cursor || extra?.loading) return;
    const base = extra ?? { key: pageKey, items: [], cursor, loading: false, error: "" };
    setMore({ ...base, loading: true, error: "" });
    try {
      const page = await client.feed("inbox", { filter, cursor });
      setMore({ key: pageKey, items: [...base.items, ...page.items], cursor: page.nextCursor, loading: false, error: "" });
    } catch (e) {
      const err = toApiError(e);
      if (err.code === "session_expired") onFatal(err);
      setMore({ ...base, loading: false, error: err.message });
    }
  }, [client, cursor, extra, filter, onFatal, pageKey]);

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) void loadMore();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loadMore]);

  const counts = feed.data?.counts;
  // counts.unread = the «Непрочитанные» filter (unread or waiting for a reply); opening a lead clears both flags.
  const unreadLeft = counts ? Math.max(0, counts.unread - items.filter((i) => (i.unread || i.needsManager) && viewed.has(i.id)).length) : 0;
  const hot = counts?.hot ?? 0;
  useEffect(() => {
    if (counts) onCounts({ hot, unread: unreadLeft });
  }, [counts, hot, unreadLeft, onCounts]);

  return (
    <>
      <ScreenHeader
        title="Входящие"
        meta={counts ? `${workspace.name} · ${unreadLeft ? `${unreadLeft} непрочитанных` : "всё прочитано"}` : workspace.name}
        action={<RefreshButton onClick={() => void feed.reload()} busy={feed.refreshing} />}
      />
      <div className="overflow-x-auto px-3 pb-2 [mask-image:linear-gradient(to_right,#000_88%,transparent)] [scrollbar-width:none]">
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => v && setFilter(v as InboxFilter)}
          aria-label="Фильтр входящих"
          spacing={1}
          className="gap-1 pr-8"
        >
          {FILTERS.map((f) => {
            const n = f.id === "hot" ? counts?.hot : f.id === "unread" ? unreadLeft : undefined;
            return (
              <ToggleGroupItem
                key={f.id}
                value={f.id}
                className="h-8 rounded-full px-3 text-[15px] font-medium text-(--tma-hint) hover:bg-transparent hover:text-(--tma-hint) data-[state=on]:bg-(--tma-fill) data-[state=on]:text-(--tma-text) data-[state=on]:hover:bg-(--tma-fill) data-[state=on]:hover:text-(--tma-text)"
              >
                {f.label}
                {n ? (
                  <span
                    className={cn(
                      "tma-num ml-1 min-w-5 rounded-full px-1.5 text-[12px] leading-5 font-semibold",
                      f.id === "hot" ? "bg-(--tma-accent) text-(--tma-accent-ink)" : "bg-(--tma-fill-strong) text-(--tma-text)",
                    )}
                  >
                    {n}
                  </span>
                ) : null}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>
      <PullScroll onRefresh={feed.reload}>
        {feed.refreshError ? <InlineNotice tone="danger">Не удалось обновить: {feed.refreshError.message}</InlineNotice> : null}
        {feed.status === "loading" ? <ListSkeleton rows={7} /> : null}
        {feed.status === "error" && feed.error ? <ErrorState error={feed.error} online={online} onRetry={() => void feed.reload()} /> : null}
        {feed.status === "ready" && items.length === 0 ? (
          <EmptyState title={EMPTY_COPY[filter].title} text={EMPTY_COPY[filter].text}>
            {filter !== "all" ? (
              <button type="button" onClick={() => setFilter("all")} className="min-h-11 px-4 text-[15px] font-medium text-(--tma-link)">
                Показать все
              </button>
            ) : null}
          </EmptyState>
        ) : null}
        {items.length > 0 ? (
          <ul aria-label="Лиды и диалоги" className="pb-4 [&>li:last-child_[data-sep]]:border-b-0">
            {items.map((item) => (
              <li key={item.id}>
                <InboxRowView item={item} unread={item.unread && !viewed.has(item.id)} onOpen={() => onOpen(item)} />
              </li>
            ))}
          </ul>
        ) : null}
        {cursor ? (
          <div ref={sentinel} className="flex flex-col items-center gap-1 pb-6">
            {extra?.error ? <InlineNotice tone="danger">{extra.error}</InlineNotice> : null}
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={extra?.loading}
              className="flex min-h-11 items-center gap-2 px-4 text-[15px] font-medium text-(--tma-link)"
            >
              {extra?.loading ? <Spinner className="size-4" /> : null}
              Показать ещё
            </button>
          </div>
        ) : null}
      </PullScroll>
    </>
  );
}

function InboxRowView({ item, unread, onOpen }: { item: InboxRow; unread: boolean; onOpen(): void }) {
  const hot = item.temperature === "hot" && !item.conversation;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="inbox-row"
      data-hot={hot || undefined}
      data-unread={unread || undefined}
      className="flex w-full gap-3 pl-3 text-left active:bg-(--tma-fill)"
    >
      <span className="pt-2.5">
        <Avatar id={item.id} name={item.name} username={item.username} />
      </span>
      <span data-sep className="flex min-w-0 flex-1 flex-col gap-0.5 border-b border-(--tma-separator) py-2.5 pr-4">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 truncate text-[16px]", unread ? "font-semibold" : "font-medium")}>{item.name || `@${item.username}`}</span>
          {hot ? <Flame className="size-4 shrink-0 translate-y-0.5 fill-current text-(--tma-accent)" aria-label="горячий лид" /> : null}
          <span className="tma-num ml-auto shrink-0 text-[14px] text-(--tma-hint)">{formatListTime(item.at)}</span>
        </span>
        {hot ? <HotQuote item={item} unread={unread} /> : <PlainPreview item={item} unread={unread} />}
      </span>
    </button>
  );
}

/** The bold place: the lead's own words as a chat bubble + why it matched. */
function HotQuote({ item, unread }: { item: InboxRow; unread: boolean }) {
  return (
    <span className="mt-1 flex items-end gap-2">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="tma-tail-in flex w-fit max-w-full flex-col rounded-[16px] bg-(--tma-page) px-3 pt-1.5 pb-2 text-[15px] leading-snug text-(--tma-text)">
          <span className="truncate text-[13px] font-semibold text-(--tma-link)">{item.source}</span>
          <span className="tma-clamp-2">{item.preview}</span>
        </span>
        {item.reason ? (
          <span className="tma-clamp-2 pl-1 text-[13px] leading-snug text-(--tma-hint)">
            <span className="text-(--tma-text)">Почему:</span> {item.reason}
          </span>
        ) : null}
      </span>
      {unread ? <UnreadDot /> : null}
    </span>
  );
}

function PlainPreview({ item, unread }: { item: InboxRow; unread: boolean }) {
  return (
    <span className="flex items-start gap-2">
      <span className={cn("tma-clamp-2 min-w-0 flex-1 text-[15px] leading-snug", unread ? "text-(--tma-text)" : "text-(--tma-hint)")}>
        {item.source && !item.conversation ? <span className="text-(--tma-text)">{item.source}: </span> : null}
        {item.preview}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
        {item.needsManager ? <span className="text-[12px] font-medium text-(--tma-link)">ждёт ответа</span> : null}
        {unread ? <UnreadDot /> : null}
      </span>
    </span>
  );
}

function UnreadDot() {
  return <span aria-label="не прочитано" className="mb-1 size-2.5 shrink-0 rounded-full bg-(--tma-button)" />;
}
