"use client";

import { CircleAlert, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { chatListItem, type ChatLead } from "@/lib/chat-view";
import { ChatAvatar } from "./chat-avatar";
import { ChatTick } from "./chat-ticks";

export type ChatFolder = "all" | "viewed";

export type ChatListProps = {
  leads: readonly ChatLead[];
  activeId: string | null;
  loading: boolean;
  folder: ChatFolder;
  counts: { fresh: number; viewed: number };
  query: string;
  now?: Date;
  onFolderChange: (folder: ChatFolder) => void;
  onQueryChange: (query: string) => void;
  onOpen: (lead: ChatLead) => void;
};

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

function ListEmpty({ folder, query, counts, onFolderChange, onQueryChange }: Pick<ChatListProps, "folder" | "query" | "counts" | "onFolderChange" | "onQueryChange">) {
  const searching = query.trim().length > 0;
  const other = folder === "all" ? counts.viewed : counts.fresh;
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
            {folder === "all" ? `Просмотренные (${other})` : `Новые (${other})`}
          </Button>
        ) : null}
      </EmptyContent>
    </Empty>
  );
}

function ChatListRow({ lead, active, now, onOpen }: { lead: ChatLead; active: boolean; now?: Date; onOpen: (lead: ChatLead) => void }) {
  const name = String(lead.data.name || "Без имени");
  const row = chatListItem(lead, { now });
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
              <span className="chat-unread-pill" aria-label={`Непрочитанных: ${row.unreadCount}`}>
                {row.unreadCount}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}

export function ChatList(props: ChatListProps) {
  const { leads, activeId, loading, folder, counts, query, now, onFolderChange, onQueryChange, onOpen } = props;
  return (
    <section className="chat-list" aria-label="Диалоги">
      <header className="chat-list-head">
        <div className="chat-list-titlebar">
          <h1 className="chat-list-title">Переписки</h1>
          {loading ? null : <span className="chat-list-total">{counts.fresh + counts.viewed}</span>}
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
        <Tabs value={folder} onValueChange={(v) => onFolderChange(v === "viewed" ? "viewed" : "all")} className="chat-folders">
          <TabsList variant="line" className="chat-folders-list">
            <TabsTrigger value="all" className="chat-folder">
              Новые{counts.fresh ? <span className="chat-folder-count">{counts.fresh}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="viewed" className="chat-folder">
              Просмотренные{counts.viewed ? <span className="chat-folder-count">{counts.viewed}</span> : null}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </header>
      <div className="chat-list-scroll">
        {loading ? (
          <ListSkeleton />
        ) : leads.length ? (
          <>
            <ul className="chat-list-items">
              {leads.map((lead) => (
                <ChatListRow key={lead.id} lead={lead} active={lead.id === activeId} now={now} onOpen={onOpen} />
              ))}
            </ul>
            {folder === "all" && counts.viewed > 0 && !query ? (
              <button type="button" className="chat-list-more" onClick={() => onFolderChange("viewed")}>
                Открытые диалоги — в «Просмотренных»: {counts.viewed}
              </button>
            ) : null}
          </>
        ) : (
          <ListEmpty folder={folder} query={query} counts={counts} onFolderChange={onFolderChange} onQueryChange={onQueryChange} />
        )}
      </div>
    </section>
  );
}
