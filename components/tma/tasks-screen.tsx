"use client";

import { useState } from "react";
import { Megaphone, RefreshCcw, UserPlus, UsersRound, type LucideIcon } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { TaskItem, TaskKind, TaskStatus, TmaAction } from "@/lib/tma/contract";
import { toApiError, useFeedQuery, useOnline, useTmaSession } from "@/components/tma/context";
import { formatListTime, formatProgress, TASK_KIND_LABEL } from "@/components/tma/format";
import { EmptyState, ErrorState, InlineNotice, PullScroll, RefreshButton, ScreenHeader, Section, SectionSkeleton } from "@/components/tma/parts";
import { confirmAction, haptic } from "@/components/tma/telegram";

const GROUPS: { title: string; status: TaskStatus[] }[] = [
  { title: "С ошибкой", status: ["error"] },
  { title: "Работают", status: ["running"] },
  { title: "На паузе", status: ["paused"] },
  { title: "Остальные", status: ["scheduled", "draft", "completed"] },
];

const STATUS_LABEL: Record<TaskStatus, string> = {
  draft: "черновик",
  scheduled: "запланирована",
  running: "работает",
  paused: "на паузе",
  completed: "завершена",
  error: "ошибка",
};

const KIND_ICON: Record<TaskKind, LucideIcon> = {
  mailing: Megaphone,
  audience: UsersRound,
  invite: UserPlus,
  auto_rescan: RefreshCcw,
};

type Verb = { action: TmaAction; label: string; confirm(task: TaskItem): string };

/** Buttons offered for a task = the server's `actions` ∩ what this screen knows how to phrase. */
const VERBS: Verb[] = [
  { action: "pause_mailing", label: "Пауза", confirm: (t) => `Поставить рассылку «${t.name}» на паузу? Отправка остановится.` },
  { action: "start_mailing", label: "Запустить", confirm: (t) => `Запустить рассылку «${t.name}»? Сообщения начнут уходить с аккаунтов.` },
  { action: "pause_audience", label: "Пауза", confirm: (t) => `Поставить сбор «${t.name}» на паузу?` },
  { action: "start_audience", label: "Запустить", confirm: (t) => `Запустить сбор аудитории «${t.name}»?` },
  { action: "pause_invite", label: "Пауза", confirm: (t) => `Поставить инвайтинг «${t.name}» на паузу?` },
  { action: "start_invite", label: "Запустить", confirm: (t) => `Запустить инвайтинг «${t.name}»? Приглашения начнут уходить с аккаунтов.` },
  { action: "mark_auto_rescan", label: "Отметить обход", confirm: () => "Отметить автообход групп выполненным сейчас?" },
];

export function TasksScreen() {
  const { client } = useTmaSession();
  const online = useOnline();
  const feed = useFeedQuery("tasks", () => client.feed("tasks"));
  const items = feed.data?.items ?? [];
  const running = items.filter((t) => t.status === "running").length;

  return (
    <>
      <ScreenHeader
        title="Задачи"
        meta={feed.data ? `${running} ${running === 1 ? "работает" : "работают"} · ${items.length} всего` : undefined}
        action={<RefreshButton onClick={() => void feed.reload()} busy={feed.refreshing} />}
      />
      <PullScroll onRefresh={feed.reload} className="pt-1">
        {feed.refreshError ? <InlineNotice tone="danger">Не удалось обновить: {feed.refreshError.message}</InlineNotice> : null}
        {feed.status === "loading" ? <SectionSkeleton sections={2} rows={2} /> : null}
        {feed.status === "error" && feed.error ? <ErrorState error={feed.error} online={online} onRetry={() => void feed.reload()} /> : null}
        {feed.status === "ready" && items.length === 0 ? (
          <EmptyState title="Задач нет" text="Рассылки, сбор аудитории и инвайтинг создаются в UniLab на компьютере — здесь их можно запускать и останавливать." />
        ) : null}
        {GROUPS.map((g) => {
          const rows = items.filter((t) => g.status.includes(t.status));
          if (rows.length === 0) return null;
          return (
            <Section key={g.title} title={g.title} aside={rows.length}>
              <ul>
                {rows.map((t) => (
                  <li key={t.id} className="border-b border-(--tma-separator) last:border-b-0">
                    <TaskRow task={t} onDone={feed.reload} />
                  </li>
                ))}
              </ul>
            </Section>
          );
        })}
      </PullScroll>
    </>
  );
}

function TaskRow({ task, onDone }: { task: TaskItem; onDone(): Promise<void> }) {
  const { client, app, onFatal } = useTmaSession();
  const [busy, setBusy] = useState<TmaAction | null>(null);
  const [error, setError] = useState("");
  const Icon = KIND_ICON[task.kind];
  const verbs = VERBS.filter((v) => task.actions.includes(v.action));
  const pct = task.progress && task.progress.total > 0 ? Math.min(100, Math.round((task.progress.done / task.progress.total) * 100)) : null;

  async function run(verb: Verb) {
    if (busy) return;
    const ok = await confirmAction(app, verb.confirm(task));
    if (!ok) return;
    setBusy(verb.action);
    setError("");
    try {
      await client.runTaskAction(verb.action, task.id);
      haptic(app, "success");
      await onDone();
    } catch (e) {
      const err = toApiError(e);
      if (err.code === "session_expired") onFatal(err);
      haptic(app, "error");
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="flex flex-col gap-2 px-4 py-3" data-testid="task-row">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-(--tma-fill) text-(--tma-text)">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[16px] font-semibold">{task.name}</h3>
          <p className="truncate text-[13px] text-(--tma-hint)">
            {TASK_KIND_LABEL[task.kind]} ·{" "}
            <span className={cn(task.status === "error" ? "text-(--tma-destructive)" : task.status === "running" ? "text-(--tma-text)" : undefined)}>
              {STATUS_LABEL[task.status]}
            </span>{" "}
            · {formatListTime(task.updatedAt)}
          </p>
        </div>
      </div>
      {task.progress ? (
        <div className="flex flex-col gap-1 pl-11">
          <div className="flex items-baseline justify-between gap-2 text-[13px]">
            <span className="tma-num text-(--tma-text)">{formatProgress(task.kind, task.progress.done, task.progress.total)}</span>
            {pct !== null ? <span className="tma-num text-(--tma-hint)">{pct}%</span> : null}
          </div>
          <Progress value={pct ?? 0} aria-label={`Прогресс: ${pct ?? 0}%`} className="h-1 bg-(--tma-fill-strong) *:data-[slot=progress-indicator]:bg-(--tma-text)" />
        </div>
      ) : null}
      {task.error ? <p className="pl-11 text-[14px] leading-snug text-(--tma-destructive)">{task.error}</p> : null}
      {verbs.length > 0 ? (
        <div className="-mr-2 flex justify-end gap-1">
          {verbs.map((v) => (
            <button
              key={v.action}
              type="button"
              onClick={() => void run(v)}
              disabled={busy !== null}
              className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[15px] font-medium text-(--tma-link)"
            >
              {busy === v.action ? <Spinner className="size-4" /> : null}
              {v.label}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="pl-11 text-[13px] text-(--tma-destructive)">
          {error}
        </p>
      ) : null}
    </article>
  );
}
