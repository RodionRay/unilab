"use client";

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNowTick } from "@/hooks/useNowTick";
import {
  formatLiveClock,
  liveWaitLogText,
  remainSec,
} from "@/lib/audience-invite";

export type TaskLogView = {
  title: string;
  log: any[];
  taskId?: string;
  nextAt?: string;
};

type Props = {
  open: TaskLogView | null;
  liveLog?: any[];
  liveNextAt?: string;
  onClose: () => void;
};

export function TaskLogDialog({ open, liveLog, liveNextAt, onClose }: Props) {
  const now = useNowTick(!!open);
  const entries = liveLog ?? open?.log ?? [];
  const nextAt = liveNextAt || open?.nextAt || "";
  const waitLeft = remainSec(nextAt, now);

  const rows = useMemo(() => {
    const list = [...entries].reverse();
    let waitPatched = false;
    return list.map((e) => {
      const raw = String(e?.text || "");
      if (!waitPatched && /^Ожидание \d+ секунд$/.test(raw)) {
        waitPatched = true;
        return {
          ...e,
          text: liveWaitLogText(raw, e?.at, nextAt, now),
        };
      }
      return e;
    });
  }, [entries, nextAt, now]);

  return (
    <Dialog open={!!open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-xl max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Лог действий · {open?.title}</DialogTitle>
          <DialogDescription>
            {String(open?.title || "").includes("Переобход") ||
            String(open?.title || "").includes("переобход")
              ? "История сканов групп и автообходов"
              : "События задачи в хронологии"}
            <span className="block mt-1 tabular-nums text-[var(--foreground)]">
              Сейчас {formatLiveClock(now)}
              {waitLeft > 0 ? ` · пауза ${waitLeft}с` : ""}
            </span>
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
