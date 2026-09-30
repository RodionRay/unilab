"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { Bell, CheckCheck, CircleAlert, CircleCheck, Info, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorkspaceNotices } from "@/hooks/useWorkspaceNotices";
import { clearNotices, markNoticesRead, type WorkspaceNotice } from "@/lib/workspace-notifications";
import type { NavName } from "@/components/product/workspace-nav";

function relativeTime(at: string) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return formatDistanceToNow(date, { addSuffix: true, locale: ru });
}

function LevelIcon({ level }: { level: WorkspaceNotice["level"] }) {
  if (level === "success") return <CircleCheck size={16} />;
  if (level === "error") return <CircleAlert size={16} />;
  return <Info size={16} />;
}

export function NotificationsList({
  items,
  compact,
  onOpen,
}: {
  items: WorkspaceNotice[];
  compact?: boolean;
  onOpen?: (item: WorkspaceNotice) => void;
}) {
  if (!items.length) {
    return (
      <Empty className={compact ? "notify-empty-compact" : undefined}>
        <EmptyHeader>
          <EmptyTitle>Пока тихо</EmptyTitle>
          <EmptyDescription>События кабинета появятся здесь: сканы, вступления, рассылки и ошибки.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul className={`notify-list${compact ? " is-compact" : ""}`}>
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className={`notify-item notify-${item.level}${item.read ? "" : " is-unread"}`}
            onClick={() => onOpen?.(item)}
          >
            <span className="notify-icon" aria-hidden>
              <LevelIcon level={item.level} />
            </span>
            <span className="notify-body">
              <span className="notify-text">{item.text}</span>
              <span className="notify-meta">
                {relativeTime(item.at)}
                {item.view ? ` · ${item.view}` : ""}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function NotificationsBell({
  onOpenAll,
  onOpenItem,
}: {
  onOpenAll: () => void;
  onOpenItem: (view?: NavName) => void;
}) {
  const items = useWorkspaceNotices();
  const [open, setOpen] = useState(false);
  const unread = items.filter((item) => !item.read).length;
  const preview = items.slice(0, 12);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) markNoticesRead();
      }}
    >
      <PopoverTrigger
        type="button"
        className="notify-bell"
        aria-label={unread ? `Уведомления, непрочитанных: ${unread}` : "Уведомления"}
      >
        <Bell size={18} />
        {unread > 0 && <span className="notify-bell-count">{unread > 99 ? "99+" : unread}</span>}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="notify-popover">
        <div className="notify-popover-head">
          <div>
            <p className="notify-popover-title">Уведомления</p>
            <p className="small-note">{unread ? `${unread} новых` : "Все просмотрены"}</p>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon-sm" onClick={() => markNoticesRead()} aria-label="Прочитать все" title="Прочитать все">
              <CheckCheck size={15} />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => clearNotices()} aria-label="Очистить" title="Очистить">
              <Trash2 size={15} />
            </Button>
          </div>
        </div>
        <NotificationsList
          items={preview}
          compact
          onOpen={(item) => {
            markNoticesRead([item.id]);
            setOpen(false);
            onOpenItem(item.view);
          }}
        />
        <button
          type="button"
          className="notify-all-link"
          onClick={() => {
            setOpen(false);
            onOpenAll();
          }}
        >
          Открыть раздел
        </button>
      </PopoverContent>
    </Popover>
  );
}

export function NotificationsPanel({ onOpenItem }: { onOpenItem: (view?: NavName) => void }) {
  const items = useWorkspaceNotices();
  const unread = items.filter((item) => !item.read).length;

  useEffect(() => {
    markNoticesRead();
  }, []);

  return (
    <div className="notify-panel">
      <div className="notify-panel-toolbar">
        <p className="small-note">{items.length ? `${items.length} событий` : "Журнал пуст"}{unread ? ` · ${unread} непрочитанных` : ""}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!unread} onClick={() => markNoticesRead()}>
            <CheckCheck size={14} />Прочитать все
          </Button>
          <Button variant="outline" size="sm" disabled={!items.length} onClick={() => clearNotices()}>
            <Trash2 size={14} />Очистить
          </Button>
        </div>
      </div>
      <NotificationsList
        items={items}
        onOpen={(item) => {
          markNoticesRead([item.id]);
          onOpenItem(item.view);
        }}
      />
    </div>
  );
}
