"use client";

import { memo, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { CircleAlert, Loader2, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { chatListItem, type ChatLead } from "@/lib/chat-view";
import { ChatAvatar } from "./chat-avatar";
import { ChatTick } from "./chat-ticks";

export type ChatFolder = "all" | "viewed";

export type ChatListProps = {
  leads: readonly ChatLead[];
  activeId: string | null;
  loading: boolean;
  folder: ChatFolder;
  /** Per folder; already narrowed by the search when it is not empty. */
  counts: { fresh: number; viewed: number };
  query: string;
  readOnly: boolean;
  /** Records failed to load ("" = fine). */
  loadError: string;
  onReload: () => Promise<unknown> | void;
  /** Next step when there are no chats at all; shown in the list only in the one-column layout. */
  firstRun?: ReactNode;
  /** Optional per-row badge next to the name (e.g. account penalty on the staff branch). */
  renderRowBadge?: (lead: ChatLead) => ReactNode;
  onFolderChange: (folder: ChatFolder) => void;
  onQueryChange: (query: string) => void;
  onOpen: (lead: ChatLead) => void;
  onAddLead: () => void;
};

const FOLDERS: readonly { value: ChatFolder; label: string }[] = [
  { value: "all", label: "Новые" },
  { value: "viewed", label: "Просмотренные" },
];

function ListSkeleton() {
  return (
    <div className="chat-list-skeleton" aria-busy="true" aria-label="Загрузка диалогов">
      {Array.from({ length: 7 }, (_, i) => (
        <div className="chat-item is-skeleton" key={i}>
          <Skeleton className="chat-skeleton-avatar" />
          <div className="chat-item-body">
            <Skeleton className="chat-skeleton-line" style={{ width: `${55 + ((i * 17) % 30)}%` }} />
            <Skeleton className="chat-skeleton-line is-thin" style={{ width: `${70 + ((i * 11) % 25)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ListEmpty({ folder, query, counts, firstRun, onFolderChange, onQueryChange }: Pick<ChatListProps, "folder" | "query" | "counts" | "firstRun" | "onFolderChange" | "onQueryChange">) {
  const searching = query.trim().length > 0;
  const other = folder === "all" ? counts.viewed : counts.fresh;
  // no chats at all: the chat pane explains and offers the next step, the list stays a quiet label
  if (!searching && counts.fresh + counts.viewed === 0) {
    return (
      <Empty className="chat-list-empty">
        <EmptyHeader className="chat-list-zero-label">
          <EmptyTitle>Нет диалогов</EmptyTitle>
        </EmptyHeader>
        {firstRun ? <div className="chat-list-firstrun">{firstRun}</div> : null}
      </Empty>
    );
  }
  return (
    <Empty className="chat-list-empty">
      <EmptyHeader>
        <EmptyTitle>{searching ? "Ничего не нашлось" : "Нет диалогов"}</EmptyTitle>
        <EmptyDescription>
          {searching
            ? `По запросу «${query.trim()}» в этой папке пусто.`
            : folder === "all"
              ? "Когда клиент ответит или AI подготовит черновик, диалог появится здесь."
              : "Открытые диалоги переезжают сюда из «Новых»."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {searching ? (
          <Button variant="outline" size="sm" onClick={() => onQueryChange("")}>
            Сбросить поиск
          </Button>
        ) : other > 0 ? (
          <Button variant="outline" size="sm" onClick={() => onFolderChange(folder === "all" ? "viewed" : "all")}>
            {folder === "all" ? `Просмотренные: ${other}` : `Новые: ${other}`}
          </Button>
        ) : null}
      </EmptyContent>
    </Empty>
  );
}

/** Records failed to load: say so and retry once at a time. */
function LoadError({ message, onReload }: { message: string; onReload: () => Promise<unknown> | void }) {
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onReload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Empty className="chat-list-empty" role="alert">
      <EmptyHeader>
        <EmptyTitle>Не удалось загрузить диалоги</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" disabled={busy} aria-busy={busy} onClick={() => void retry()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {busy ? "Загружаем…" : "Повторить"}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

type RowProps = { lead: ChatLead; active: boolean; badge: ReactNode; onOpen: (lead: ChatLead) => void };

/** Memoised: typing in the composer or polling other leads does not re-render unchanged rows. */
const ChatListRow = memo(function ChatListRow({ lead, active, badge, onOpen }: RowProps) {
  const name = String(lead.data.name || "Без имени");
  const row = useMemo(() => chatListItem(lead), [lead]);
  return (
    <li>
      <button
        type="button"
        className="chat-item"
        data-chat-item
        data-lead-id={lead.id}
        data-unread={row.unreadCount > 0 || undefined}
        aria-current={active ? "true" : undefined}
        onClick={() => onOpen(lead)}
      >
        <ChatAvatar id={lead.id} name={name} />
        <span className="chat-item-body">
          <span className="chat-item-line">
            <span className="chat-item-name">{name}</span>
            {badge ? <span className="chat-item-badge">{badge}</span> : null}
            <span className="chat-item-time">
              {row.lastTick && row.lastTick !== "failed" ? <ChatTick state={row.lastTick} size={14} /> : null}
              {row.timeLabel}
            </span>
          </span>
          <span className="chat-item-line">
            <span className="chat-item-preview">
              {row.prefix ? <span className="chat-item-prefix" data-prefix={row.prefix === "Вы: " ? "you" : "draft"}>{row.prefix}</span> : null}
              {row.preview}
            </span>
            {row.failed ? (
              <span className="chat-item-failed" title="Последнее сообщение не отправлено">
                <CircleAlert size={18} aria-hidden />
                <span className="sr-only">Последнее сообщение не отправлено</span>
              </span>
            ) : null}
            {row.unreadCount > 0 ? (
              <span className="chat-unread-pill">
                <span aria-hidden>{row.unreadCount}</span>
                <span className="sr-only">Непрочитанных: {row.unreadCount}</span>
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
});

function ChatListView(props: ChatListProps) {
  const { leads, activeId, loading, folder, counts, query, readOnly, loadError, renderRowBadge, onFolderChange, onQueryChange, onOpen } = props;
  const uid = useId();
  const panelId = `${uid}-panel`;
  const tabId = (f: ChatFolder) => `${uid}-tab-${f}`;
  const searching = query.trim().length > 0;

  // WAI-ARIA tabs: arrows move between the two folders.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next: ChatFolder = folder === "all" ? "viewed" : "all";
    onFolderChange(next);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <section className="chat-list" aria-label="Диалоги">
      <header className="chat-list-head">
        <div className="chat-list-titlebar">
          <h1 className="chat-list-title" tabIndex={-1}>
            Переписки
          </h1>
          {loading || loadError ? null : <span className="chat-list-total">{counts.fresh + counts.viewed}</span>}
          <Button variant="outline" size="sm" className="chat-add-lead" disabled={readOnly} onClick={props.onAddLead}>
            <Plus aria-hidden />
            Добавить лид
          </Button>
        </div>
        <label className="chat-search">
          <Search size={17} aria-hidden />
          <span className="sr-only">Поиск по диалогам</span>
          <Input
            type="search"
            className="chat-search-input"
            placeholder="Поиск: имя, @username, текст"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
          {query ? (
            <button type="button" className="chat-search-clear" aria-label="Очистить поиск" onClick={() => onQueryChange("")}>
              <X size={15} aria-hidden />
            </button>
          ) : null}
        </label>
        <div className="chat-folders-list" role="tablist" aria-label={searching ? "Папки, найдено по поиску" : "Папки"}>
          {FOLDERS.map((f) => {
            const n = f.value === "all" ? counts.fresh : counts.viewed;
            const selected = folder === f.value;
            return (
              <button
                key={f.value}
                type="button"
                role="tab"
                id={tabId(f.value)}
                className="chat-folder"
                data-state={selected ? "active" : "inactive"}
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onKeyDown={onTabKey}
                onClick={() => onFolderChange(f.value)}
              >
                {f.label}
                {n ? <span className="chat-folder-count">{n}</span> : null}
              </button>
            );
          })}
        </div>
      </header>
      <div className="chat-list-scroll" role="tabpanel" id={panelId} aria-labelledby={tabId(folder)}>
        {loading ? (
          <ListSkeleton />
        ) : loadError && !leads.length ? (
          <LoadError message={loadError} onReload={props.onReload} />
        ) : leads.length ? (
          <>
            <ul className="chat-list-items">
              {leads.map((lead) => (
                <ChatListRow
                  key={lead.id}
                  lead={lead}
                  active={lead.id === activeId}
                  badge={renderRowBadge ? renderRowBadge(lead) : null}
                  onOpen={onOpen}
                />
              ))}
            </ul>
            {folder === "all" && counts.viewed > 0 && !searching ? (
              <button type="button" className="chat-list-more" onClick={() => onFolderChange("viewed")}>
                Просмотренные: {counts.viewed}
              </button>
            ) : null}
          </>
        ) : (
          <ListEmpty folder={folder} query={query} counts={counts} firstRun={props.firstRun} onFolderChange={onFolderChange} onQueryChange={onQueryChange} />
        )}
      </div>
    </section>
  );
}

export const ChatList = memo(ChatListView);
