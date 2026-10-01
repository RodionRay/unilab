"use client";

import { useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { AccountHealth, AccountItem } from "@/lib/tma/contract";
import { toApiError, useFeedQuery, useOnline, useTmaSession } from "@/components/tma/context";
import { formatChecked } from "@/components/tma/format";
import { EmptyState, ErrorState, InlineNotice, PullScroll, RefreshButton, ScreenHeader, Section, SectionSkeleton } from "@/components/tma/parts";
import { haptic } from "@/components/tma/telegram";

const GROUPS: { title: string; health: AccountHealth[] }[] = [
  { title: "Требуют внимания", health: ["error", "paused", "setup"] },
  { title: "На прогреве", health: ["warming"] },
  { title: "В работе", health: ["ok"] },
];

export function AccountsScreen() {
  const { client } = useTmaSession();
  const online = useOnline();
  const feed = useFeedQuery("accounts", () => client.feed("accounts"));
  const items = feed.data?.items ?? [];
  const problems = items.filter((a) => GROUPS[0]?.health.includes(a.health)).length;

  return (
    <>
      <ScreenHeader
        title="Аккаунты"
        meta={feed.data ? (problems ? `${items.length} всего · ${problems} с проблемами` : `${items.length} всего · все в порядке`) : undefined}
        action={<RefreshButton onClick={() => void feed.reload()} busy={feed.refreshing} />}
      />
      <PullScroll onRefresh={feed.reload} className="pt-1">
        {feed.refreshError ? <InlineNotice tone="danger">Не удалось обновить: {feed.refreshError.message}</InlineNotice> : null}
        {feed.status === "loading" ? <SectionSkeleton sections={2} rows={2} /> : null}
        {feed.status === "error" && feed.error ? <ErrorState error={feed.error} online={online} onRetry={() => void feed.reload()} /> : null}
        {feed.status === "ready" && items.length === 0 ? (
          <EmptyState title="Аккаунтов нет" text="Подключите Telegram-аккаунты в UniLab на компьютере — здесь появится их состояние и лимиты." />
        ) : null}
        {GROUPS.map((g) => {
          const rows = items.filter((a) => g.health.includes(a.health));
          if (rows.length === 0) return null;
          return (
            <Section key={g.title} title={g.title} aside={rows.length}>
              <ul>
                {rows.map((a) => (
                  <li key={a.id} className="border-b border-(--tma-separator) last:border-b-0">
                    <AccountRow account={a} onChecked={feed.reload} />
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

const HEALTH_TONE: Record<AccountHealth, string> = {
  error: "text-(--tma-destructive)",
  paused: "text-(--tma-text)",
  setup: "text-(--tma-link)",
  warming: "text-(--tma-text)",
  ok: "text-(--tma-hint)",
};

function AccountRow({ account, onChecked }: { account: AccountItem; onChecked(): Promise<void> }) {
  const { client, app, onFatal } = useTmaSession();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const busy = checking || account.checking;

  async function check() {
    setChecking(true);
    setError("");
    try {
      await client.checkAccount(account.id);
      haptic(app, "success");
      await onChecked();
    } catch (e) {
      const err = toApiError(e);
      if (err.code === "session_expired") onFatal(err);
      haptic(app, "error");
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <article className="flex flex-col gap-2 px-4 py-3" data-testid="account-row">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[16px] font-semibold">{account.name}</h3>
          <p className="tma-num truncate text-[13px] text-(--tma-hint)">
            {account.phone}
            {account.username ? ` · @${account.username}` : ""}
          </p>
        </div>
        <span className={cn("shrink-0 pt-0.5 text-[13px] font-medium", HEALTH_TONE[account.health])}>{account.statusLabel}</span>
      </div>
      {account.reason ? (
        <p className={cn("text-[14px] leading-snug", account.health === "error" ? "text-(--tma-destructive)" : "text-(--tma-text)")}>{account.reason}</p>
      ) : null}
      {account.caps.length > 0 ? (
        <dl className="flex flex-col gap-2 pt-0.5">
          {account.caps.map((c) => {
            const pct = c.limit > 0 ? Math.min(100, Math.round((c.used / c.limit) * 100)) : 0;
            const full = c.limit > 0 && c.used >= c.limit;
            return (
              <div key={c.label} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <dt className="text-(--tma-hint)">{c.label}</dt>
                  <dd className={cn("tma-num font-medium", full ? "text-(--tma-destructive)" : "text-(--tma-text)")}>
                    {c.used} из {c.limit}
                  </dd>
                </div>
                <Progress
                  value={pct}
                  aria-label={`${c.label}: ${c.used} из ${c.limit}`}
                  className={cn("h-1 bg-(--tma-fill-strong) *:data-[slot=progress-indicator]:bg-(--tma-text)", full && "*:data-[slot=progress-indicator]:bg-(--tma-destructive)")}
                />
              </div>
            );
          })}
        </dl>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-(--tma-hint)">{busy ? "проверяем…" : formatChecked(account.lastCheckedAt)}</span>
        <button
          type="button"
          onClick={() => void check()}
          disabled={busy}
          className="-mr-2 flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[15px] font-medium text-(--tma-link)"
        >
          {busy ? <Spinner className="size-4" /> : null}
          Проверить
        </button>
      </div>
      {error ? (
        <p role="alert" className="-mt-1 text-[13px] text-(--tma-destructive)">
          {error}
        </p>
      ) : null}
    </article>
  );
}
