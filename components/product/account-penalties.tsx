"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { accountEventTitle, type AccountEvent, type AccountEventCounts } from "@/lib/account-events";

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Счётчики журнала штрафов в строке аккаунта: 24 ч · 7 дн · всего; клик открывает историю. */
export function AccountPenaltyCell({ counts, onOpen }: { counts?: AccountEventCounts; onOpen: () => void }) {
  const c = counts ?? { day: 0, week: 0, all: 0, lastAt: "" };
  const label = `Штрафы Telegram: ${c.day} за 24 ч, ${c.week} за 7 дней, ${c.all} всего. Открыть историю`;
  return (
    <button
      type="button"
      className={`acc-penalties ${c.day ? "is-hot" : c.all ? "is-some" : "is-none"}`}
      onClick={onOpen}
      aria-label={label}
      title={c.lastAt ? `Последний: ${fmtWhen(c.lastAt)}` : "Штрафов не было"}
    >
      <span><em>{c.day}</em> 24 ч</span>
      <span><em>{c.week}</em> 7 дн</span>
      <span><em>{c.all}</em> всего</span>
    </button>
  );
}

type LoadState = { status: "loading" | "ok" | "error"; events: AccountEvent[]; error: string };

/** Body of the dialog; remounted per account/retry (key) so the effect only sets state from the promise. */
function PenaltyHistory({ accountId, load, onRetry }: { accountId: string; load: (id: string) => Promise<AccountEvent[]>; onRetry: () => void }) {
  const [state, setState] = useState<LoadState>({ status: "loading", events: [], error: "" });
  useEffect(() => {
    let alive = true;
    load(accountId)
      .then((events) => {
        if (alive) setState({ status: "ok", events, error: "" });
      })
      .catch((e: unknown) => {
        if (alive) setState({ status: "error", events: [], error: String((e as Error)?.message || e) });
      });
    return () => {
      alive = false;
    };
  }, [accountId, load]);
  if (state.status === "loading") return <p className="small-note" role="status">Загружаем историю…</p>;
  if (state.status === "error") {
    return (
      <div role="alert" className="small-note">
        Не удалось загрузить историю: {state.error}{" "}
        <button type="button" className="underline" onClick={onRetry}>Повторить</button>
      </div>
    );
  }
  if (!state.events.length) {
    return <p className="small-note">Штрафов не было. Журнал пополняется при каждом FloodWait, спамблоке и проверке @SpamBot.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[132px]">Когда</TableHead>
          <TableHead>Что</TableHead>
          <TableHead>Причина</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {state.events.map((e) => (
          <TableRow key={e.id}>
            <TableCell className="whitespace-nowrap tabular-nums">{fmtWhen(e.at)}</TableCell>
            <TableCell>{accountEventTitle(e)}</TableCell>
            <TableCell className="small-note [overflow-wrap:anywhere]">{e.reason}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** История штрафов одного аккаунта (до 50 последних), грузится при открытии. */
export function AccountPenaltyDialog({
  account,
  counts,
  onClose,
  load,
}: {
  account: { id: string; name: string } | null;
  counts?: AccountEventCounts;
  onClose: () => void;
  load: (accountId: string) => Promise<AccountEvent[]>;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <Dialog open={!!account} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Штрафы Telegram · {account?.name}</DialogTitle>
          <DialogDescription>
            {counts ? `${counts.day} за 24 ч, ${counts.week} за 7 дней, ${counts.all} всего. ` : ""}
            Спамблок, FloodWait, @SpamBot, заморозка и ошибки приватности: каждый случай с датой и местом.
          </DialogDescription>
        </DialogHeader>
        {account ? (
          <PenaltyHistory key={`${account.id}:${attempt}`} accountId={account.id} load={load} onRetry={() => setAttempt((n) => n + 1)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
