"use client";

import { useCallback, useMemo } from "react";
import { useNowTick } from "@/hooks/useNowTick";
import {
  Play,
  Pause,
  Pencil,
  Trash2,
  ScrollText,
  BarChart3,
  Plus,
  ExternalLink,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
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
  MAILING_CONTENT_LABELS,
  MAILING_DELIVERY_MODES,
  MAILING_LEAD_FILTER_LABELS,
  MAILING_SOURCE_LABELS,
  MAILING_STATUS_LABELS,
  DEFAULT_DM_SOFT_CLOSE,
  type MailingContentMode,
  type MailingDeliveryMode,
  type MailingLeadFilter,
  type MailingSourceKind,
  type MailingTaskStatus,
} from "@/lib/mailing";
import { displayTgHandle, relativeRu, remainSec } from "@/lib/audience-invite";
import { isAccountUsable } from "@/lib/telegram-accounts";
import { useTableSort } from "@/hooks/useTableSort";
import type { SortValueType } from "@/lib/table-sort";

export type MailingRecord = {
  id: string;
  created: string;
  data: any;
};

type Props = {
  tasks: MailingRecord[];
  audienceTasks: { id: string; data: any }[];
  search: string;
  onSearch: (v: string) => void;
  busy?: boolean;
  onCreate: () => void;
  onPlay: (id: string) => void;
  onPause: (id: string) => void;
  onEdit: (item: MailingRecord) => void;
  onDelete: (item: MailingRecord) => void;
  onLog: (item: MailingRecord) => void;
  onStats: (item: MailingRecord) => void;
};

function statusBadge(status: MailingTaskStatus) {
  const label = MAILING_STATUS_LABELS[status] || status;
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

export function MailingPanel({
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
          String(d.templateText || "").toLowerCase().includes(q)
        );
      }),
    [tasks, q],
  );

  const sortTypes = useMemo<Record<string, SortValueType>>(
    () => ({
      name: "string",
      sent: "number",
      status: "status",
      links: "number",
      created: "date",
    }),
    [],
  );

  const getSortValue = useCallback((t: MailingRecord, key: string) => {
    const d = t.data || {};
    if (key === "name") return String(d.name || "");
    if (key === "sent") return Number(d.sentTotal) || 0;
    if (key === "status")
      return MAILING_STATUS_LABELS[(d.status || "draft") as MailingTaskStatus] || d.status;
    if (key === "links") return Array.isArray(d.accountIds) ? d.accountIds.length : 0;
    if (key === "created") return t.created;
    return "";
  }, []);

  const { sorted, sortKey, sortDir, onSort } = useTableSort(filtered, getSortValue, {
    types: sortTypes,
    defaultKey: "created",
    defaultDir: "desc",
  });

  const audName = (id: string) => {
    const a = audienceTasks.find((x) => x.id === id);
    return a ? displayTgHandle(a.data?.url || a.data?.name || "") : "—";
  };

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
            Нет задач рассылки. Выберите базу аудитории или лидов, аккаунты
            (смешанный режим) и текст / AI.
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
                  Название
                </SortableTableHead>
                <SortableTableHead columnKey="sent" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>
                  Доставлено
                </SortableTableHead>
                <SortableTableHead columnKey="status" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>
                  Статус
                </SortableTableHead>
                <SortableTableHead columnKey="links" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>
                  Аккаунты
                </SortableTableHead>
                <SortableTableHead columnKey="created" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>
                  Создана
                </SortableTableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((t) => {
                const d = t.data || {};
                const st = (d.status || "draft") as MailingTaskStatus;
                const content = (d.contentMode || "ai") as MailingContentMode;
                const source = (d.sourceKind || "audience") as MailingSourceKind;
                const nAcc = Array.isArray(d.accountIds) ? d.accountIds.length : 0;
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="font-medium flex items-center gap-1.5">
                        <Send size={14} className="opacity-60" />
                        {d.name || "Рассылка"}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <span className="badge neutral">{MAILING_SOURCE_LABELS[source]}</span>
                        <span className={`badge ${content === "ai" ? "warning" : "success"}`}>
                          {MAILING_CONTENT_LABELS[content]}
                        </span>
                        {source === "audience" && d.audienceTaskId && (
                          <span className="small-note">{audName(d.audienceTaskId)}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {Number(d.sentTotal) || 0}
                        {d.total ? ` / ${d.total}` : ""}
                      </div>
                      <span className="small-note">
                        сегодня {Number(d.sentToday) || 0}
                        {Number(d.failed) ? ` · ошибок ${d.failed}` : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      {statusBadge(st)}
                      {(st === "running" || st === "scheduled") && remainSec(d.nextAt, now) > 0 && (
                        <div className="badge warning mt-1">Пауза · {remainSec(d.nextAt, now)}с</div>
                      )}
                      {d.lastTickAt && (
                        <div className="small-note mt-1">{relativeRu(d.lastTickAt, now)}</div>
                      )}
                      {typeof d.error === "string" && d.error.trim() && (
                        <div className="small-note mt-1 text-red-600 line-clamp-2" title={d.error}>
                          {d.error}
                        </div>
                      )}
                      {Array.isArray(d.log) && d.log.length > 0 && (
                        <div className="small-note mt-0.5 opacity-70 line-clamp-1" title={String(d.log[d.log.length - 1]?.text || "")}>
                          {String(d.log[d.log.length - 1]?.text || "")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{nAcc}</TableCell>
                    <TableCell className="small-note">{relativeRu(t.created, now)}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        {st === "running" || st === "scheduled" ? (
                          <Button size="icon" variant="ghost" title="Пауза" onClick={() => onPause(t.id)}>
                            <Pause size={15} />
                          </Button>
                        ) : (
                          <Button size="icon" variant="ghost" title="Запуск" onClick={() => onPlay(t.id)}>
                            <Play size={15} />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" title="Лог" onClick={() => onLog(t)}>
                          <ScrollText size={15} />
                        </Button>
                        <Button size="icon" variant="ghost" title="Доставки" onClick={() => onStats(t)}>
                          <BarChart3 size={15} />
                        </Button>
                        <Button size="icon" variant="ghost" title="Изменить" onClick={() => onEdit(t)}>
                          <Pencil size={15} />
                        </Button>
                        <Button size="icon" variant="ghost" title="Удалить" onClick={() => onDelete(t)}>
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

type FormProps = {
  form: any;
  setForm: (fn: (f: any) => any) => void;
  accounts: { id: string; data: any }[];
  audienceTasks: { id: string; data: any }[];
};

export function MailingTaskFields({ form, setForm, accounts, audienceTasks }: FormProps) {
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
      const next = on ? [...new Set([...cur, id])].slice(0, 50) : cur.filter((x) => x !== id);
      return { ...f, accountIds: next };
    });
  };

  const toggleAllAcc = (on: boolean) => {
    setForm((f: any) => ({
      ...f,
      accountIds: on ? workable.map((a) => a.id).slice(0, 50) : [],
    }));
  };

  const source = (form.sourceKind || "audience") as MailingSourceKind;
  const content = (form.contentMode || "ai") as MailingContentMode;

  return (
    <div className="space-y-4">
      <label className="field">
        Название задачи
        <Input
          value={form.name || ""}
          onChange={(e) => setForm((f: any) => ({ ...f, name: e.target.value }))}
          placeholder="Рассылка сентябрь"
        />
      </label>

      <label className="field">
        Источник
        <select
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          value={source}
          onChange={(e) => {
            const v = e.target.value as MailingSourceKind;
            setForm((f: any) => ({
              ...f,
              sourceKind: v,
              deliveryMode: v === "audience" ? "dm" : f.deliveryMode || "dm",
            }));
          }}
        >
          <option value="audience">База аудитории</option>
          <option value="leads">Лиды</option>
        </select>
      </label>

      {source === "audience" ? (
        <label className="field">
          База аудитории
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            value={form.audienceTaskId || ""}
            onChange={(e) => setForm((f: any) => ({ ...f, audienceTaskId: e.target.value }))}
          >
            <option value="">Выберите базу</option>
            {audienceTasks.map((a) => (
              <option key={a.id} value={a.id}>
                {displayTgHandle(a.data?.url || a.data?.name || a.id)} · {a.data?.collected || 0} чел.
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label className="field">
            Фильтр лидов
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={form.leadFilter || "hot_warm"}
              onChange={(e) =>
                setForm((f: any) => ({
                  ...f,
                  leadFilter: e.target.value as MailingLeadFilter,
                }))
              }
            >
              {(Object.keys(MAILING_LEAD_FILTER_LABELS) as MailingLeadFilter[]).map((k) => (
                <option key={k} value={k}>
                  {MAILING_LEAD_FILTER_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Куда отправлять
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={form.deliveryMode || "dm"}
              onChange={(e) =>
                setForm((f: any) => ({
                  ...f,
                  deliveryMode: e.target.value as MailingDeliveryMode,
                }))
              }
            >
              {MAILING_DELIVERY_MODES.map((m) => (
                <option key={m} value={m}>
                  {m === "dm" ? "Личные сообщения" : "Ответ в чат (reply)"}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <label className="field">
        Тип контента
        <select
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          value={content}
          onChange={(e) =>
            setForm((f: any) => ({
              ...f,
              contentMode: e.target.value as MailingContentMode,
            }))
          }
        >
          <option value="ai">AI — уникальные тексты (пул)</option>
          <option value="template">Текст / Spintax</option>
        </select>
      </label>

      {content === "template" ? (
        <label className="field">
          Сообщение (поддерживает Spintax {"{привет|здравствуйте}"})
          <Textarea
            rows={5}
            value={form.templateText || ""}
            onChange={(e) => setForm((f: any) => ({ ...f, templateText: e.target.value }))}
            placeholder="{Привет|Здравствуйте}! {Можем|Готовы} рассказать о…"
          />
        </label>
      ) : (
        <p className="small-note">
          Тексты генерируются пакетами из настроек AI-ассистента (продукт, тон, CTA).
          Каждому получателю — свой вариант.
        </p>
      )}

      {form.deliveryMode !== "chat" && content === "ai" && (
        <div className="mailing-soft-block">
          <div className="mailing-soft-head">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={form.dmSoftCloseEnabled !== false}
                onCheckedChange={(v) =>
                  setForm((f: any) => ({ ...f, dmSoftCloseEnabled: v === true }))
                }
              />
              Мягкое закрытие в ЛС (AI)
            </label>
            <span className="badge neutral">только личка</span>
          </div>
          <p className="small-note">
            AI вплетает в каждое сообщение: извинение за беспокойство и просьбу не
            мутить / не банить, если предложение не подошло. В режиме «в чат» блок не
            используется.
          </p>
          <Textarea
            rows={3}
            disabled={form.dmSoftCloseEnabled === false}
            value={form.dmSoftClose ?? DEFAULT_DM_SOFT_CLOSE}
            onChange={(e) => setForm((f: any) => ({ ...f, dmSoftClose: e.target.value }))}
            placeholder={DEFAULT_DM_SOFT_CLOSE}
          />
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={!!form.silent}
          onCheckedChange={(v) => setForm((f: any) => ({ ...f, silent: v === true }))}
        />
        Отправлять без звука
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={!!form.deleteDialogAfter}
          onCheckedChange={(v) =>
            setForm((f: any) => ({ ...f, deleteDialogAfter: v === true }))
          }
          disabled={form.deliveryMode === "chat"}
        />
        Удалять диалог после отправки (только ЛС)
      </label>

      <label className="field">
        Сообщений за тик (за раз)
        <Input
          type="number"
          min={1}
          max={10}
          value={form.batchPerTick ?? 1}
          onChange={(e) =>
            setForm((f: any) => ({
              ...f,
              batchPerTick: Math.max(1, Math.min(10, Number(e.target.value) || 1)),
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
            value={form.dailyLimit ?? 200}
            onChange={(e) =>
              setForm((f: any) => ({
                ...f,
                dailyLimit: Number(e.target.value) || 200,
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
          {form.dailyLimitEnabled ? "Включён" : "Выключить"}
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
          {[10, 20, 30, 50, 70, 90].map((n) => (
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
            value={form.pauseFromSec ?? 45}
            onChange={(e) =>
              setForm((f: any) => ({
                ...f,
                pauseFromSec: Number(e.target.value) || 45,
              }))
            }
          />
        </label>
        <label className="field">
          Пауза до, сек
          <Input
            type="number"
            min={1}
            value={form.pauseToSec ?? 90}
            onChange={(e) =>
              setForm((f: any) => ({
                ...f,
                pauseToSec: Number(e.target.value) || 90,
              }))
            }
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={form.pauseBetweenAccounts !== false}
          onCheckedChange={(v) =>
            setForm((f: any) => ({ ...f, pauseBetweenAccounts: v === true }))
          }
        />
        Пауза между подключениями (смешанный режим аккаунтов)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={form.autoStart !== false}
          onCheckedChange={(v) => setForm((f: any) => ({ ...f, autoStart: v === true }))}
        />
        Автозапуск задачи
      </label>

      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-sm font-medium">Рабочие аккаунты (до 50, ротация)</p>
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
                  <Checkbox checked={on} onCheckedChange={(v) => toggleAcc(a.id, v === true)} />
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

export function MailingDeliveriesView({
  deliveries,
}: {
  deliveries: {
    at?: string;
    username?: string;
    userId?: string;
    ok?: boolean;
    link?: string;
    error?: string;
    textPreview?: string;
    mode?: string;
  }[];
}) {
  if (!deliveries?.length) {
    return <p className="muted">Пока нет записей о доставке.</p>;
  }
  return (
    <div className="space-y-2 max-h-[50vh] overflow-y-auto">
      {deliveries
        .slice()
        .reverse()
        .map((d, i) => (
          <div key={`${d.at}-${i}`} className="border rounded-md p-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className={`badge ${d.ok ? "success" : "danger"}`}>
                {d.ok ? "ok" : "fail"} · {d.mode || "dm"}
              </span>
              <span className="small-note">{d.at ? relativeRu(d.at) : ""}</span>
            </div>
            <div className="mt-1 font-medium">
              {d.username ? `@${d.username}` : d.userId ? `id${d.userId}` : "—"}
            </div>
            {d.textPreview && <p className="small-note mt-1 line-clamp-2">{d.textPreview}</p>}
            {d.ok && d.link ? (
              <a
                className="inline-flex items-center gap-1 text-[var(--spike-primary)] mt-1"
                href={d.link}
                target="_blank"
                rel="noreferrer"
              >
                Открыть сообщение <ExternalLink size={12} />
              </a>
            ) : d.error ? (
              <p className="text-red-500 mt-1">{d.error}</p>
            ) : null}
          </div>
        ))}
    </div>
  );
}
