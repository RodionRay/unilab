"use client";

import { useCallback, useMemo } from "react";
import {
  Play,
  Pause,
  Pencil,
  Trash2,
  ScrollText,
  BarChart3,
  UserPlus,
  Loader2,
  Plus,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  SortableTableHead,
} from "@/components/ui/table";
import { useTableSort } from "@/hooks/useTableSort";
import { useNowTick } from "@/hooks/useNowTick";
import {
  INVITE_MODE_LABELS,
  INVITE_STATUS_LABELS,
  displayTgHandle,
  relativeRu,
  remainSec,
  type InviteMode,
  type InviteTaskStatus,
} from "@/lib/audience-invite";
import { isAccountUsable } from "@/lib/telegram-accounts";
import type { SortValueType } from "@/lib/table-sort";

export type InviteRecord = {
  id: string;
  created: string;
  data: any;
};

type Props = {
  tasks: InviteRecord[];
  audienceTasks: { id: string; data: any }[];
  search: string;
  onSearch: (v: string) => void;
  busy?: boolean;
  onCreate: () => void;
  onPlay: (id: string) => void;
  onPause: (id: string) => void;
  onEdit: (item: InviteRecord) => void;
  onDelete: (item: InviteRecord) => void;
  onLog: (item: InviteRecord) => void;
  onStats: (item: InviteRecord) => void;
};

function statusBadge(status: InviteTaskStatus) {
  const label = INVITE_STATUS_LABELS[status] || status;
  const tone =
    status === "completed"
      ? "success"
      : status === "running" || status === "scheduled"
        ? "warning"
        : status === "error" || status === "paused"
          ? "danger"
          : "neutral";
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function InvitePanel({
  tasks,
  audienceTasks,
  search,
  onSearch,
  busy,
  onCreate,
  onPlay,
  onPause,
  onEdit,
  onDelete,
  onLog,
  onStats,
}: Props) {
  const now = useNowTick(true);
  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      tasks.filter((t) => {
        if (!q) return true;
        const d = t.data || {};
        return (
          String(d.name || "").toLowerCase().includes(q) ||
          String(d.targetUrl || "").toLowerCase().includes(q)
        );
      }),
    [tasks, q],
  );
  const audName = (id: string) => {
    const a = audienceTasks.find((x) => x.id === id);
    return a ? displayTgHandle(a.data?.url || a.data?.name || "") : "—";
  };

  const sortTypes = useMemo<Record<string, SortValueType>>(
    () => ({
      name: "string",
      invites: "number",
      status: "status",
      links: "number",
      created: "date",
    }),
    [],
  );

  const getSortValue = useCallback((t: InviteRecord, key: string) => {
    const d = t.data || {};
    if (key === "name") return displayTgHandle(d.targetUrl || d.name || "");
    if (key === "invites") return Number(d.done) || 0;
    if (key === "status")
      return INVITE_STATUS_LABELS[(d.status || "draft") as InviteTaskStatus] || d.status;
    if (key === "links") return Array.isArray(d.accountIds) ? d.accountIds.length : 0;
    if (key === "created") return t.created;
    return "";
  }, []);

  const { sorted, sortKey, sortDir, onSort } = useTableSort(filtered, getSortValue, {
    types: sortTypes,
    defaultKey: "created",
    defaultDir: "desc",
  });

  return (
    <div className="task-module">
      <div className="task-module-toolbar">
        <Input
          placeholder={`Поиск по задачам${tasks.length ? ` · ${tasks.length}` : ""}`}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="max-w-sm"
        />
        <Button onClick={onCreate} disabled={busy}>
          <Plus size={16} />
          Создать задачу
        </Button>
      </div>

      {!filtered.length ? (
        <div className="panel empty-panel">
          <p className="muted">
            Нет задач инвайтинга. Сначала соберите аудиторию, затем пригласите в
            свою группу.
          </p>
          <Button className="mt-3" variant="outline" onClick={onCreate}>
            <Plus size={16} />
            Создать задачу
          </Button>
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>
                  Название задачи
                </SortableTableHead>
                <SortableTableHead columnKey="invites" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>
                  Приглашения
                </SortableTableHead>
                <SortableTableHead columnKey="status" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>
                  Статус
                </SortableTableHead>
                <SortableTableHead columnKey="links" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>
                  Связи
                </SortableTableHead>
                <SortableTableHead columnKey="created" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>
                  Дата создания
                </SortableTableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((t) => {
                const d = t.data || {};
                const mode = (d.mode || "ordinary") as InviteMode;
                const st = (d.status || "draft") as InviteTaskStatus;
                const nAcc = Array.isArray(d.accountIds) ? d.accountIds.length : 0;
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="font-medium">
                        {displayTgHandle(d.targetUrl || d.name || "")}
                      </div>
                      <span
                        className={`badge mt-1 ${mode === "advanced" ? "warning" : "success"}`}
                      >
                        {INVITE_MODE_LABELS[mode]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <UserPlus size={14} className="opacity-60" />
                        {Number(d.done) || 0}/{Number(d.total) || 0}
                      </span>
                    </TableCell>
                    <TableCell>
                      {st === "running" ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Loader2 size={14} className="animate-spin" />
                          {d.nextAt && remainSec(d.nextAt, now) > 0 ? (
                            <span className="badge warning">Пауза · {remainSec(d.nextAt, now)}с</span>
                          ) : (
                            statusBadge(st)
                          )}
                        </span>
                      ) : (
                        statusBadge(st)
                      )}
                      {st === "scheduled" && d.nextAt && (
                        <div className="small-note mt-1">
                          {new Date(d.nextAt).toLocaleString("ru-RU", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      )}
                      {d.error && st !== "running" && (
                        <div className="small-note mt-1 text-red-400">{String(d.error).slice(0, 80)}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <span className="badge neutral">
                          {nAcc}{" "}
                          {nAcc === 1
                            ? "аккаунт"
                            : nAcc < 5
                              ? "аккаунта"
                              : "аккаунтов"}
                        </span>
                        <span className="badge neutral">
                          {audName(d.audienceTaskId)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {relativeRu(t.created, now)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        {st === "running" || st === "scheduled" ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Пауза"
                            onClick={() => onPause(t.id)}
                          >
                            <Pause size={15} />
                          </Button>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Запуск"
                            onClick={() => onPlay(t.id)}
                          >
                            <Play size={15} />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Лог"
                          onClick={() => onLog(t)}
                        >
                          <ScrollText size={15} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Статистика"
                          onClick={() => onStats(t)}
                        >
                          <BarChart3 size={15} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Изменить"
                          onClick={() => onEdit(t)}
                        >
                          <Pencil size={15} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Удалить"
                          onClick={() => onDelete(t)}
                        >
                          <Trash2 size={15} className="text-red-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

type ModePickProps = {
  mode: InviteMode;
  onPick: (m: InviteMode) => void;
};

export function InviteModePicker({ mode, onPick, onContinue }: ModePickProps & { onContinue?: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm muted">
        Продвинутый режим повышает риск ограничений Telegram — используйте паузы и
        лимиты.
      </p>
      {(
        [
          {
            id: "ordinary" as const,
            title: "Обычный",
            sub: "Участники",
            desc: "Приглашение новых участников в вашу группу без назначения дополнительных прав",
          },
          {
            id: "advanced" as const,
            title: "Продвинутый",
            sub: "Участники с назначением прав админа",
            desc: "Приглашение на роль админа с последующим снятием прав",
          },
        ] as const
      ).map((opt) => {
        const on = mode === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            className={`invite-mode-card ${on ? "on" : ""}`}
            onClick={() => onPick(opt.id)}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{opt.title}</div>
                <div className="text-sm opacity-80 mt-0.5">{opt.sub}</div>
                <p className="text-sm mt-2 opacity-90">{opt.desc}</p>
              </div>
              {on && <Check size={18} />}
            </div>
          </button>
        );
      })}
      {onContinue && (
        <div className="flex justify-end pt-2">
          <Button type="button" onClick={onContinue}>
            Продолжить
          </Button>
        </div>
      )}
    </div>
  );
}

type FormProps = {
  form: any;
  setForm: (fn: (f: any) => any) => void;
  accounts: { id: string; data: any }[];
  audienceTasks: { id: string; data: any }[];
};

export function InviteTaskFields({
  form,
  setForm,
  accounts,
  audienceTasks,
}: FormProps) {
  const workable = useMemo(
    () => accounts.filter((a) => isAccountUsable(a.data)),
    [accounts],
  );
  const selectedIds = useMemo(() => {
    const cur: string[] = Array.isArray(form.accountIds) ? form.accountIds : [];
    const live = new Set(workable.map((a) => a.id));
    return cur.filter((id) => live.has(id));
  }, [form.accountIds, workable]);
  const allSelected = workable.length > 0 && selectedIds.length === workable.length;

  const toggleAcc = (id: string, on: boolean) => {
    setForm((f: any) => {
      const live = new Set(workable.map((a) => a.id));
      const cur: string[] = (Array.isArray(f.accountIds) ? f.accountIds : []).filter((x: string) =>
        live.has(x),
      );
      const next = on ? [...new Set([...cur, id])].slice(0, 40) : cur.filter((x) => x !== id);
      return { ...f, accountIds: next };
    });
  };

  const toggleAllAcc = (on: boolean) => {
    setForm((f: any) => ({
      ...f,
      accountIds: on ? workable.map((a) => a.id).slice(0, 40) : [],
    }));
  };

  return (
    <div className="space-y-4">
      <label className="field">
        Группа для инвайтинга (@ или t.me/…)
        <Input
          value={form.targetUrl || ""}
          onChange={(e) =>
            setForm((f: any) => ({ ...f, targetUrl: e.target.value }))
          }
          placeholder="@mygroup"
        />
      </label>
      <label className="field">
        База аудитории
        <select
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          value={form.audienceTaskId || ""}
          onChange={(e) =>
            setForm((f: any) => ({ ...f, audienceTaskId: e.target.value }))
          }
        >
          <option value="">Выберите базу</option>
          {audienceTasks.map((a) => (
            <option key={a.id} value={a.id}>
              {displayTgHandle(a.data?.url || a.data?.name || a.id)} ·{" "}
              {a.data?.collected || 0} чел.
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Приглашений в группу за раз
        <Input
          type="number"
          min={1}
          max={20}
          value={form.batchSize ?? 1}
          onChange={(e) =>
            setForm((f: any) => ({
              ...f,
              batchSize: Math.max(1, Math.min(20, Number(e.target.value) || 1)),
            }))
          }
        />
      </label>
      <div className="flex items-end gap-3">
        <label className="field flex-1">
          Дневной лимит задачи
          <Input
            type="number"
            min={1}
            disabled={!form.dailyLimitEnabled}
            value={form.dailyLimit ?? 50}
            onChange={(e) =>
              setForm((f: any) => ({
                ...f,
                dailyLimit: Number(e.target.value) || 50,
              }))
            }
          />
        </label>
        <Button
          type="button"
          variant={form.dailyLimitEnabled ? "default" : "outline"}
          onClick={() =>
            setForm((f: any) => ({
              ...f,
              dailyLimitEnabled: !f.dailyLimitEnabled,
            }))
          }
        >
          {form.dailyLimitEnabled ? "Включён" : "Включить"}
        </Button>
      </div>
      <label className="field">
        Останавливать задачу при отключении
        <select
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          value={String(form.stopDisconnectedPct ?? 30)}
          onChange={(e) =>
            setForm((f: any) => ({
              ...f,
              stopDisconnectedPct: Number(e.target.value) || 30,
            }))
          }
        >
          {[10, 20, 30, 50, 70, 100].map((n) => (
            <option key={n} value={n}>
              {n}% аккаунтов
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="field">
          Пауза от, сек
          <Input
            type="number"
            min={1}
            value={form.pauseFromSec ?? 15}
            onChange={(e) =>
              setForm((f: any) => ({
                ...f,
                pauseFromSec: Number(e.target.value) || 15,
              }))
            }
          />
        </label>
        <label className="field">
          Пауза до, сек
          <Input
            type="number"
            min={1}
            value={form.pauseToSec ?? 15}
            onChange={(e) =>
              setForm((f: any) => ({
                ...f,
                pauseToSec: Number(e.target.value) || 15,
              }))
            }
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={!!form.pauseBetweenAccounts}
          onCheckedChange={(v) =>
            setForm((f: any) => ({ ...f, pauseBetweenAccounts: v === true }))
          }
        />
        Пауза между подключениями (ротация аккаунтов)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={form.autoStart !== false}
          onCheckedChange={(v) =>
            setForm((f: any) => ({ ...f, autoStart: v === true }))
          }
        />
        Автозапуск задачи
      </label>
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-sm font-medium">Рабочие аккаунты</p>
          {workable.length > 0 && (
            <label className="inline-flex items-center gap-2 text-sm shrink-0 cursor-pointer">
              <Checkbox checked={allSelected} onCheckedChange={(v) => toggleAllAcc(v === true)} />
              Выбрать все
            </label>
          )}
        </div>
        <div className="max-h-40 overflow-y-auto space-y-2 border rounded-md p-2">
          {workable.length === 0 ? (
            <p className="small-note">Нет активных аккаунтов (заморозка, бан, отлёжка скрыты)</p>
          ) : (
          workable.map((a) => {
            const on = selectedIds.includes(a.id);
            return (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={on}
                  onCheckedChange={(v) => toggleAcc(a.id, v === true)}
                />
                {a.data?.name || a.data?.phone || a.id.slice(0, 8)}
              </label>
            );
          })
          )}
        </div>
        {accounts.length > workable.length && (
          <p className="small-note mt-1">
            Скрыто {accounts.length - workable.length}: заморозка / бан / отлёжка / ошибка
          </p>
        )}
      </div>
    </div>
  );
}
