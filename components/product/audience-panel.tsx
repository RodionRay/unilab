"use client";

import { useCallback, useMemo } from "react";
import {
  Play,
  Pause,
  Pencil,
  Trash2,
  Download,
  ScrollText,
  Users,
  Loader2,
  Plus,
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
import {
  AUDIENCE_SOURCE_LABELS,
  AUDIENCE_STATUS_LABELS,
  displayTgHandle,
  relativeRu,
  type AudienceSourceKind,
  type AudienceTaskStatus,
} from "@/lib/audience-invite";
import { isAccountUsable } from "@/lib/telegram-accounts";
import { useTableSort } from "@/hooks/useTableSort";
import type { SortValueType } from "@/lib/table-sort";

export type AudienceRecord = {
  id: string;
  created: string;
  data: any;
};

type Props = {
  tasks: AudienceRecord[];
  accounts: { id: string; data: any }[];
  search: string;
  onSearch: (v: string) => void;
  busy?: boolean;
  onCreate: () => void;
  onPlay: (id: string) => void;
  onPause: (id: string) => void;
  onEdit: (item: AudienceRecord) => void;
  onDelete: (item: AudienceRecord) => void;
  onExport: (id: string) => void;
  onLog: (item: AudienceRecord) => void;
};

function statusBadge(status: AudienceTaskStatus) {
  const label = AUDIENCE_STATUS_LABELS[status] || status;
  const tone =
    status === "completed"
      ? "success"
      : status === "running" || status === "scheduled"
        ? "warning"
        : status === "error"
          ? "danger"
          : "neutral";
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function AudiencePanel({
  tasks,
  accounts,
  search,
  onSearch,
  busy,
  onCreate,
  onPlay,
  onPause,
  onEdit,
  onDelete,
  onExport,
  onLog,
}: Props) {
  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      tasks.filter((t) => {
        if (!q) return true;
        const d = t.data || {};
        return (
          String(d.name || "").toLowerCase().includes(q) ||
          String(d.url || "").toLowerCase().includes(q) ||
          String(d.title || "").toLowerCase().includes(q)
        );
      }),
    [tasks, q],
  );

  const sortTypes = useMemo<Record<string, SortValueType>>(
    () => ({
      name: "string",
      collected: "number",
      status: "status",
      links: "number",
      created: "date",
    }),
    [],
  );

  const getSortValue = useCallback((t: AudienceRecord, key: string) => {
    const d = t.data || {};
    if (key === "name") return displayTgHandle(d.url || d.name || "");
    if (key === "collected") return Number(d.collected) || 0;
    if (key === "status")
      return AUDIENCE_STATUS_LABELS[(d.status || "draft") as AudienceTaskStatus] || d.status;
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
          placeholder={`Поиск по базам${tasks.length ? ` · ${tasks.length}` : ""}`}
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
            Нет задач сбора. Создайте задачу: аккаунт → источник → фильтры → сбор
            участников.
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
                  Название базы
                </SortableTableHead>
                <SortableTableHead columnKey="collected" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>
                  Аудитория
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
                const sk = (d.sourceKind || "chat") as AudienceSourceKind;
                const st = (d.status || "draft") as AudienceTaskStatus;
                const nAcc = Array.isArray(d.accountIds) ? d.accountIds.length : 0;
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="font-medium">
                        {displayTgHandle(d.url || d.name || "")}
                      </div>
                      <span className="badge neutral mt-1">
                        {AUDIENCE_SOURCE_LABELS[sk] || sk}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <Users size={14} className="opacity-60" />
                        {Number(d.collected) || 0}
                        {st === "completed" || st === "paused"
                          ? ""
                          : st === "running" || st === "scheduled"
                            ? "+"
                            : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      {st === "running" ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Loader2 size={14} className="animate-spin" />
                          {statusBadge(st)}
                        </span>
                      ) : (
                        statusBadge(st)
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="badge neutral">
                        {nAcc}{" "}
                        {nAcc === 1 ? "аккаунт" : nAcc < 5 ? "аккаунта" : "аккаунтов"}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {relativeRu(t.created)}
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
                          title="Экспорт"
                          onClick={() => onExport(t.id)}
                        >
                          <Download size={15} />
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
      {!accounts.length && (
        <p className="small-note mt-3">
          Добавьте хотя бы один рабочий аккаунт во вкладке «Аккаунты».
        </p>
      )}
    </div>
  );
}

type FormProps = {
  form: any;
  setForm: (fn: (f: any) => any) => void;
  accounts: { id: string; data: any }[];
};

export function AudienceTaskFields({ form, setForm, accounts }: FormProps) {
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
        Источник (@username или t.me/…)
        <Input
          value={form.url || ""}
          onChange={(e) => setForm((f: any) => ({ ...f, url: e.target.value }))}
          placeholder="@channel или https://t.me/…"
        />
      </label>
      <label className="field">
        Тип источника
        <select
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          value={form.sourceKind || "chat"}
          onChange={(e) =>
            setForm((f: any) => ({ ...f, sourceKind: e.target.value }))
          }
        >
          <option value="channel">Каналы</option>
          <option value="chat">Чаты</option>
          <option value="custom">Своя база</option>
        </select>
      </label>
      <div>
        <p className="text-sm font-medium mb-2">Тип сбора</p>
        <div className="flex gap-2 flex-wrap">
          {(
            [
              ["discussions", "По обсуждениям"],
              ["comments", "По комментариям"],
            ] as const
          ).map(([v, label]) => (
            <Button
              key={v}
              type="button"
              size="sm"
              variant={form.collectMode === v ? "default" : "outline"}
              onClick={() => setForm((f: any) => ({ ...f, collectMode: v }))}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm font-medium mb-2">Диапазон сбора</p>
        <div className="flex gap-2 flex-wrap mb-2">
          {(
            [
              ["count", "Количество сообщений"],
              ["period", "Период сообщений"],
            ] as const
          ).map(([v, label]) => (
            <Button
              key={v}
              type="button"
              size="sm"
              variant={form.rangeMode === v ? "default" : "outline"}
              onClick={() => setForm((f: any) => ({ ...f, rangeMode: v }))}
            >
              {label}
            </Button>
          ))}
        </div>
        {form.rangeMode === "period" ? (
          <label className="field">
            Дней назад
            <Input
              type="number"
              min={1}
              max={365}
              value={form.periodDays ?? 30}
              onChange={(e) =>
                setForm((f: any) => ({
                  ...f,
                  periodDays: Number(e.target.value) || 30,
                }))
              }
            />
          </label>
        ) : (
          <label className="field">
            Лимит (сообщений / участников)
            <Input
              type="number"
              min={50}
              max={50000}
              value={form.messageLimit ?? 5000}
              onChange={(e) =>
                setForm((f: any) => ({
                  ...f,
                  messageLimit: Number(e.target.value) || 5000,
                }))
              }
            />
          </label>
        )}
      </div>
      <label className="field">
        Аудитория
        <select
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          value={form.audienceScope || "no_admins"}
          onChange={(e) =>
            setForm((f: any) => ({ ...f, audienceScope: e.target.value }))
          }
        >
          <option value="no_admins">Пользователи (без администраторов)</option>
          <option value="all">Все участники</option>
        </select>
      </label>
      <div>
        <p className="text-sm font-medium mb-2">Тип аудитории</p>
        <div className="flex gap-2 flex-wrap">
          {(
            [
              ["all", "Все"],
              ["only", "Только Premium"],
              ["exclude", "Исключить Premium"],
            ] as const
          ).map(([v, label]) => (
            <Button
              key={v}
              type="button"
              size="sm"
              variant={form.premiumFilter === v ? "default" : "outline"}
              onClick={() => setForm((f: any) => ({ ...f, premiumFilter: v }))}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm font-medium mb-2">Фильтр по статусам</p>
        <p className="small-note mb-2">Можно выбрать несколько. Пусто = все статусы.</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["online", "Онлайн"],
              ["recently", "Недавно"],
              ["last_week", "На прошлой неделе"],
              ["last_month", "В этом месяце"],
              ["long_ago", "Давно"],
            ] as const
          ).map(([v, label]) => {
            const selected: string[] = Array.isArray(form.statusFilters)
              ? form.statusFilters
              : form.statusFilter && form.statusFilter !== "all"
                ? [form.statusFilter]
                : [];
            const on = selected.includes(v);
            return (
              <Button
                key={v}
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                onClick={() =>
                  setForm((f: any) => {
                    const cur: string[] = Array.isArray(f.statusFilters)
                      ? [...f.statusFilters]
                      : f.statusFilter && f.statusFilter !== "all"
                        ? [f.statusFilter]
                        : [];
                    const next = on ? cur.filter((x) => x !== v) : [...cur, v];
                    return {
                      ...f,
                      statusFilters: next,
                      statusFilter: next.length === 1 ? next[0] : next.length ? "all" : "all",
                    };
                  })
                }
              >
                {label}
              </Button>
            );
          })}
        </div>
        {(() => {
          const selected: string[] = Array.isArray(form.statusFilters)
            ? form.statusFilters
            : form.statusFilter && form.statusFilter !== "all"
              ? [form.statusFilter]
              : [];
          if (!selected.length) {
            return <p className="small-note mt-2">Сейчас: все статусы</p>;
          }
          return (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="small-note">Выбрано: {selected.length}</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setForm((f: any) => ({
                    ...f,
                    statusFilters: [],
                    statusFilter: "all",
                  }))
                }
              >
                Сбросить
              </Button>
            </div>
          );
        })()}
      </div>
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
          {!workable.length && (
            <p className="small-note">Нет активных аккаунтов (заморозка, бан, отлёжка скрыты).</p>
          )}
          {workable.map((a) => {
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
          })}
        </div>
        {accounts.length > workable.length && (
          <p className="small-note mt-1">
            Скрыто {accounts.length - workable.length}: заморозка / бан / отлёжка / ошибка
          </p>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={form.autoStart !== false}
          onCheckedChange={(v) =>
            setForm((f: any) => ({ ...f, autoStart: v === true }))
          }
        />
        Автозапуск после сохранения
      </label>
    </div>
  );
}
