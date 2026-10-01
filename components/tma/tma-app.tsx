"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createTmaClient, deepLinkLeadId, type InboxPage, type InboxRow, type TmaApiError, type TmaClient } from "@/lib/tma/client";
import { WS_KEY_RE, type SessionResponse } from "@/lib/tma/contract";
import { TmaSessionProvider, toApiError, useFeedQuery, useOnline, useTmaSession, type TmaSession } from "@/components/tma/context";
import { BootErrorGate, BootSkeleton, NotLinkedGate, OutsideTelegramGate, SessionExpiredGate, UnavailableGate } from "@/components/tma/gates";
import { InboxScreen } from "@/components/tma/inbox-screen";
import { LeadScreen } from "@/components/tma/lead-screen";
import { AccountsScreen } from "@/components/tma/accounts-screen";
import { TasksScreen } from "@/components/tma/tasks-screen";
import { OverviewScreen, type TabId } from "@/components/tma/overview-screen";
import { TabBar } from "@/components/tma/tab-bar";
import { OfflineBanner } from "@/components/tma/parts";
import { atLeast, getWebApp, type TgWebApp } from "@/components/tma/telegram";

type Phase =
  | { kind: "boot" }
  | { kind: "outside" }
  | { kind: "unavailable" }
  | { kind: "expired" }
  | { kind: "not_linked"; botLink: string }
  | { kind: "error"; message: string }
  | { kind: "ready"; client: TmaClient; session: SessionResponse; initialLead: string | null };

const THEME_KEYS = [
  "bg_color",
  "text_color",
  "hint_color",
  "link_color",
  "button_color",
  "button_text_color",
  "secondary_bg_color",
  "header_bg_color",
  "bottom_bar_bg_color",
  "accent_text_color",
  "section_bg_color",
  "section_header_text_color",
  "section_separator_color",
  "subtitle_text_color",
  "destructive_text_color",
] as const;

/** Writes Telegram theme params as `--tg-theme-*` (same names the SDK uses); theme.css maps them to tokens. */
function applyTheme(app: TgWebApp): void {
  const style = document.documentElement.style;
  for (const key of THEME_KEYS) {
    const value = app.themeParams[key];
    const name = `--tg-theme-${key.replace(/_/g, "-")}`;
    if (value) style.setProperty(name, value);
    else style.removeProperty(name);
  }
}

function subscribeTheme(cb: () => void): () => void {
  const app = getWebApp();
  app?.onEvent("themeChanged", cb);
  return () => app?.offEvent("themeChanged", cb);
}

function useColorScheme(): "light" | "dark" {
  return useSyncExternalStore(
    subscribeTheme,
    () => getWebApp()?.colorScheme ?? "light",
    () => "light",
  );
}

function phaseForError(err: TmaApiError): Phase {
  switch (err.code) {
    case "not_linked":
      return { kind: "not_linked", botLink: err.botLink };
    case "workspace_unavailable":
      return { kind: "unavailable" };
    case "invalid_init_data":
    case "init_data_expired":
    case "session_expired":
      return { kind: "expired" };
    default:
      return { kind: "error", message: err.message };
  }
}

export function TmaApp({ wsKey }: { wsKey: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "boot" });
  const [attempt, setAttempt] = useState(0);
  const scheme = useColorScheme();
  const online = useOnline();

  // Telegram shell: theme, ready/expand, swipe lock. Runs once the SDK (loaded before this bundle) is present.
  useEffect(() => {
    const app = getWebApp();
    if (!app) return;
    const sync = () => applyTheme(app);
    sync();
    app.onEvent("themeChanged", sync);
    app.ready();
    app.expand();
    if (atLeast(app, "7.7")) app.disableVerticalSwipes?.();
    if (atLeast(app, "6.1")) app.setHeaderColor?.("bg_color");
    return () => app.offEvent("themeChanged", sync);
  }, []);

  // Session exchange (REQ-S3: no initData → no API calls at all).
  useEffect(() => {
    let alive = true;
    async function start() {
      await Promise.resolve();
      const app = getWebApp();
      if (!app || !app.initData) {
        if (alive) setPhase({ kind: "outside" });
        return;
      }
      if (!WS_KEY_RE.test(wsKey)) {
        if (alive) setPhase({ kind: "unavailable" });
        return;
      }
      if (alive) setPhase({ kind: "boot" });
      const client = createTmaClient({ wsKey, initData: app.initData });
      try {
        const session = await client.openSession();
        const initialLead = deepLinkLeadId(window.location.hash, app.initDataUnsafe?.start_param);
        if (alive) setPhase({ kind: "ready", client, session, initialLead });
      } catch (e) {
        if (alive) setPhase(phaseForError(toApiError(e)));
      }
    }
    void start();
    return () => {
      alive = false;
    };
  }, [wsKey, attempt]);

  const onFatal = useCallback(() => setPhase({ kind: "expired" }), []);
  const app = getWebApp();

  return (
    <div className={scheme === "dark" ? "tma-root dark" : "tma-root"} data-phase={phase.kind}>
      {phase.kind === "boot" ? <BootSkeleton /> : null}
      {phase.kind === "outside" ? <OutsideTelegramGate /> : null}
      {phase.kind === "unavailable" ? <UnavailableGate /> : null}
      {phase.kind === "expired" ? <SessionExpiredGate app={app} /> : null}
      {phase.kind === "not_linked" ? <NotLinkedGate app={app} botLink={phase.botLink} /> : null}
      {phase.kind === "error" ? <BootErrorGate message={phase.message} offline={!online} onRetry={() => setAttempt((n) => n + 1)} /> : null}
      {phase.kind === "ready" ? (
        <ReadyApp client={phase.client} session={phase.session} initialLead={phase.initialLead} app={app} onFatal={onFatal} online={online} />
      ) : null}
    </div>
  );
}

const ALL_TABS: TabId[] = ["inbox", "accounts", "tasks", "overview"];
const TAB_ACCESS: Record<TabId, string[]> = {
  inbox: ["leads", "chats"],
  accounts: ["accounts"],
  tasks: ["mailing", "audience", "invite", "groups"],
  overview: ["overview"],
};

function visibleTabs(me: SessionResponse["me"]): Set<TabId> {
  if (me.role === "owner" || me.role === "admin") return new Set(ALL_TABS);
  const tabs = ALL_TABS.filter((t) => TAB_ACCESS[t].some((k) => me.access.includes(k)));
  return new Set(tabs.length ? tabs : ALL_TABS);
}

function ReadyApp({
  client,
  session,
  initialLead,
  app,
  onFatal,
  online,
}: {
  client: TmaClient;
  session: SessionResponse;
  initialLead: string | null;
  app: TgWebApp | null;
  onFatal(error: TmaApiError): void;
  online: boolean;
}) {
  const ctx = useMemo<TmaSession>(
    () => ({ client, app, me: session.me, workspace: session.workspace, onFatal }),
    [client, app, session, onFatal],
  );
  const tabs = useMemo(() => visibleTabs(session.me), [session.me]);
  const [tab, setTab] = useState<TabId>(tabs.has("inbox") ? "inbox" : (ALL_TABS.find((t) => tabs.has(t)) ?? "inbox"));
  const [mounted, setMounted] = useState<ReadonlySet<TabId>>(() => new Set([tab]));
  const [lead, setLead] = useState<string | null>(initialLead);
  const [viewed, setViewed] = useState<ReadonlySet<string>>(() => new Set());
  const [inboxCounts, setInboxCounts] = useState<InboxPage["counts"] | null>(null);

  const select = useCallback((next: TabId) => {
    setTab(next);
    setMounted((m) => (m.has(next) ? m : new Set([...m, next])));
  }, []);
  const openLead = useCallback((item: InboxRow) => setLead(item.id), []);
  const markViewed = useCallback((id: string) => setViewed((v) => (v.has(id) ? v : new Set([...v, id]))), []);

  // BackButton for the pushed lead screen (REQ-S2).
  useEffect(() => {
    if (!app || !atLeast(app, "6.1")) return;
    const back = app.BackButton;
    if (!lead) {
      back.hide();
      return;
    }
    const onBack = () => setLead(null);
    back.onClick(onBack);
    back.show();
    return () => {
      back.offClick(onBack);
      back.hide();
    };
  }, [app, lead]);

  return (
    <TmaSessionProvider value={ctx}>
      <OverviewHost
        tab={tab}
        lead={lead}
        tabs={tabs}
        mounted={mounted}
        online={online}
        inboxCounts={inboxCounts}
        viewed={viewed}
        onSelect={select}
        onOpenLead={openLead}
        onViewed={markViewed}
        onInboxCounts={setInboxCounts}
      />
    </TmaSessionProvider>
  );
}

/** Lives inside the provider: owns the overview read (badges + the Сводка tab) and lays out the screens. */
function OverviewHost({
  tab,
  lead,
  tabs,
  mounted,
  online,
  inboxCounts,
  viewed,
  onSelect,
  onOpenLead,
  onViewed,
  onInboxCounts,
}: {
  tab: TabId;
  lead: string | null;
  tabs: ReadonlySet<TabId>;
  mounted: ReadonlySet<TabId>;
  online: boolean;
  inboxCounts: InboxPage["counts"] | null;
  viewed: ReadonlySet<string>;
  onSelect(tab: TabId): void;
  onOpenLead(item: InboxRow): void;
  onViewed(id: string): void;
  onInboxCounts(c: InboxPage["counts"]): void;
}) {
  const { client } = useTmaSession();
  const overview = useFeedQuery("overview", () => client.feed("overview"));
  const surface = !lead && tab === "inbox" ? "plain" : "grouped";

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".tma-root");
    if (root) root.dataset.surface = surface;
  }, [surface]);

  const unread = inboxCounts?.unread ?? 0;
  const badges = {
    inbox: { count: unread, tone: "info" as const },
    accounts: { count: overview.data?.accounts.problems ?? 0, tone: "danger" as const },
    tasks: { count: overview.data?.tasks.error ?? 0, tone: "danger" as const },
  };

  return (
    <>
      {!online ? <OfflineBanner /> : null}
      {lead ? (
        <section aria-label="Лид" className="flex min-h-0 flex-1 flex-col" data-screen="lead">
          <LeadScreen leadId={lead} onViewed={onViewed} />
        </section>
      ) : null}
      {(["inbox", "accounts", "tasks", "overview"] as const).map((id) =>
        mounted.has(id) ? (
          <section
            key={id}
            hidden={Boolean(lead) || tab !== id}
            className={Boolean(lead) || tab !== id ? "hidden" : "flex min-h-0 flex-1 flex-col"}
            data-screen={id}
          >
            {id === "inbox" ? <InboxScreen onOpen={onOpenLead} viewed={viewed} onCounts={onInboxCounts} /> : null}
            {id === "accounts" ? <AccountsScreen /> : null}
            {id === "tasks" ? <TasksScreen /> : null}
            {id === "overview" ? <OverviewScreen feed={overview} onGo={onSelect} /> : null}
          </section>
        ) : null,
      )}
      {!lead ? <TabBar active={tab} visible={tabs} badges={badges} onSelect={onSelect} /> : null}
    </>
  );
}
