"use client";

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type TaskLogEntry = {
  at?: string;
  level?: string;
  text?: string;
};

export type TaskLogView = {
  title: string;
  log: TaskLogEntry[];
};

type Props = {
  open: TaskLogView | null;
  onClose: () => void;
};

/** Журнал событий: переобход групп, скан одной группы, статистика аккаунта. */
export function TaskLogDialog({ open, onClose }: Props) {
  const rows = useMemo(() => [...(open?.log ?? [])].reverse(), [open]);

  return (
    <Dialog open={!!open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-xl max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Лог действий · {open?.title}</DialogTitle>
          <DialogDescription>
            {String(open?.title || "").includes("Переобход") ||
            String(open?.title || "").includes("переобход")
              ? "История сканов групп и автообходов"
              : "События в хронологии, новые сверху"}
          </DialogDescription>
        </DialogHeader>
        <div className="task-log-list">
          {!rows.length && <p className="muted text-sm">Пока пусто</p>}
          {rows.map((e, i) => {
            const text = String(e.text || "");
            const linkMatch = text.match(/https?:\/\/\S+|tg:\/\/\S+/);
            const link = linkMatch?.[0]?.replace(/[.,;)]+$/, "") || "";
            const before = link ? text.slice(0, text.indexOf(link)) : text;
            const after = link ? text.slice(text.indexOf(link) + link.length) : "";
            const at = e.at
              ? new Date(e.at)
                  .toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })
                  .replace(",", " ")
              : "";
            return (
              <div key={`${e.at || i}-${i}`} className={`task-log-item ${e.level || "info"}`}>
                <span className="task-log-at tabular-nums">{at}</span>
                <span className="task-log-text">
                  {before}
                  {link ? (
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-[var(--spike-primary)]"
                    >
                      {link}
                    </a>
                  ) : null}
                  {after}
                </span>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
