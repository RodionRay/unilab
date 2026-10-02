"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { telegramMessageLink } from "@/lib/audience-invite";
import {
  buildThread,
  chatListItem,
  defaultMode,
  listWithOpened,
  makeOutbox,
  openedFrom,
  pendingFor,
  unreadOnOpen,
  unsentDraft,
  type ChatLead,
  type OpenedFrom,
  type Outbox,
  type ThreadMessage,
} from "@/lib/chat-view";
import { ChatComposer, type ChatMode } from "./chat-composer";
import { ChatHeader } from "./chat-header";
import { ChatList, type ChatFolder } from "./chat-list";
import { useChatTheme } from "./chat-theme";
import { ChatThreadView } from "./chat-thread";
import { useFullScreenChat, useNarrowPanel } from "./use-chat-layout";

export type ChatGroupRef = { name: string; url: string };

export type ChatsPanelProps = {
  /** Filtered and sorted chats of the current folder. */
  leads: readonly ChatLead[];
  /** The open chat (page `detail`, fresh from records); null = nothing selected. */
  activeLead: ChatLead | null;
  loading: boolean;
  folder: ChatFolder;
  /** Per folder; narrowed by the search when it is not empty. */
  counts: { fresh: number; viewed: number };
  query: string;
  groups: Readonly<Record<string, ChatGroupRef>>;
  accounts: Readonly<Record<string, string>>;
  text: string;
  mode: ChatMode;
  readOnly: boolean;
  telegramConnected: boolean;
  /** Rendered in the chat header `[data-slot=chat-header-badges]` (account penalty badge etc.). */
  headerBadges?: ReactNode;
  /** Optional badge next to the name in each list row. */
  renderRowBadge?: (lead: ChatLead) => ReactNode;
  onFolderChange: (folder: ChatFolder) => void;
  onQueryChange: (query: string) => void;
  onTextChange: (text: string) => void;
  onModeChange: (mode: ChatMode) => void;
  onOpen: (lead: ChatLead) => void;
  /** Back on narrow layouts / Esc: clear the active chat. */
  onBack: () => void;
  /** Sends the composer text; settles when the request is done (success or not). */
  onSend: (text: string, mode: ChatMode) => Promise<unknown>;
  /** Resends a failed message without touching the composer. */
  onRetry: (text: string, mode: ChatMode) => Promise<unknown>;
  onDraft: () => unknown;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: (text: string) => void;
  onAddLead: () => void;
  /** «Настроить аккаунты» when Telegram is not connected. */
  onConnect: () => void;
};

function NoChatSelected({ leads, onOpen }: { leads: readonly ChatLead[]; onOpen: (lead: ChatLead) => void }) {
  const firstUnread = leads.find((l) => chatListItem(l).unreadCount > 0) ?? null;
  return (
    <div className="chat-placeholder">
      <div className="chat-placeholder-card">
        <h2 className="chat-placeholder-title">Выберите диалог</h2>
        <p className="chat-placeholder-text">
          {firstUnread ? "Клиенты ждут ответа. Откройте диалог, чтобы прочитать и ответить." : "Слева все переписки с клиентами из Telegram."}
        </p>
        {firstUnread ? (
          <Button className="chat-placeholder-cta" onClick={() => onOpen(firstUnread)}>
            Открыть: {String(firstUnread.data.name || "диалог")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ChatsPanel(props: ChatsPanelProps) {
  const { leads, activeLead, groups, accounts, query, folder } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [theme, setTheme] = useChatTheme();
  const [opened, setOpened] = useState<OpenedFrom | null>(null);
  const [outbox, setOutbox] = useState<Outbox | null>(null);
  const [confirmDraft, setConfirmDraft] = useState(false);
  const narrow = useNarrowPanel(rootRef);
  const activeId = activeLead?.id ?? null;
  const sending = outbox !== null;

  const listLeads = useMemo(() => listWithOpened(leads, activeLead, opened, { query, folder }), [leads, activeLead, opened, query, folder]);

  // Stable handler for memoised rows: reads the latest props through a ref.
  const latest = useRef({ props, listLeads });
  useEffect(() => {
    latest.current = { props, listLeads };
  });
  const open = useCallback((lead: ChatLead) => {
    const { props: p, listLeads: list } = latest.current;
    setOpened(openedFrom(lead, list, p.query, p.folder));
    p.onOpen(lead);
    // after openLead's own prefill: never put an already-sent text back (Enter would send a duplicate)
    p.onTextChange(unsentDraft(lead.data));
    p.onModeChange(defaultMode(lead.data, !!p.groups[String(lead.data.groupId || "")]?.url));
  }, []);

  const send = async (text: string, mode: ChatMode, retry: boolean) => {
    if (!activeLead || outbox) return;
    const box = makeOutbox(activeLead, text, mode);
    setOutbox(box);
    try {
      await (retry ? props.onRetry(box.text, mode) : props.onSend(text, mode));
    } finally {
      setOutbox((cur) => (cur === box ? null : cur));
    }
  };

  const pending = useMemo(() => pendingFor(outbox, activeLead), [outbox, activeLead]);
  const unread = activeLead ? unreadOnOpen(activeLead, opened) : false;
  const thread = useMemo(() => (activeLead ? buildThread(activeLead, { unread, pending }) : null), [activeLead, unread, pending]);

  // Narrow layouts: focus the chat title on open, the opened row on back.
  const lastOpenedId = useRef<string | null>(null);
  useEffect(() => {
    if (!narrow) return;
    if (activeId) {
      lastOpenedId.current = activeId;
      headingRef.current?.focus();
    } else if (lastOpenedId.current) {
      rootRef.current?.querySelector<HTMLElement>(`[data-chat-item][data-lead-id="${CSS.escape(lastOpenedId.current)}"]`)?.focus();
    }
  }, [activeId, narrow]);

  // Phones: the chat covers the app chrome, so the chrome must leave the tab order.
  useFullScreenChat(paneRef, narrow && activeId !== null);

  const onPaneKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || !narrow || !activeLead) return;
    if ((e.target as HTMLElement).closest('[role="menu"],[role="dialog"],[role="alertdialog"]')) return;
    e.preventDefault();
    props.onBack();
  };

  const requestDraft = () => {
    if (props.text.trim()) setConfirmDraft(true);
    else void props.onDraft();
  };

  const group = activeLead ? groups[String(activeLead.data.groupId || "")] : undefined;
  const groupUrl = group?.url ?? "";
  const username = String(activeLead?.data.senderUsername || "");
  const sourceHref = activeLead ? telegramMessageLink(groupUrl, String(activeLead.data.tgMsgId || "")) : "";
  const messageHref = (m: ThreadMessage): string => {
    if (m.source) return sourceHref;
    if (m.side !== "out" || (m.tick !== "sent" && m.tick !== "read")) return "";
    // DM message ids live in the private chat: only group replies have a public link.
    return m.link || (m.mode === "chat" ? telegramMessageLink(groupUrl, m.messageId, m.chatId) : "");
  };

  return (
    <div ref={rootRef} className="chats-panel" data-chats-panel data-chat-theme={theme} data-chat-open={activeLead ? "true" : "false"}>
      <div className="chats-layout">
        <ChatList
          leads={listLeads}
          activeId={activeId}
          loading={props.loading}
          folder={folder}
          counts={props.counts}
          query={query}
          readOnly={props.readOnly}
          renderRowBadge={props.renderRowBadge}
          onFolderChange={props.onFolderChange}
          onQueryChange={props.onQueryChange}
          onOpen={open}
          onAddLead={props.onAddLead}
        />
        <section
          ref={paneRef}
          className="chat-pane"
          aria-label={activeLead ? `Диалог: ${String(activeLead.data.name || "")}` : "Диалог не выбран"}
          onKeyDown={onPaneKey}
        >
          {activeLead && thread ? (
            <>
              <ChatHeader
                leadId={activeLead.id}
                name={String(activeLead.data.name || "Без имени")}
                username={username}
                groupName={group?.name ?? ""}
                accountName={accounts[String(activeLead.data.accountId || "")] ?? ""}
                telegramHref={username ? `https://t.me/${username}` : sourceHref}
                theme={theme}
                readOnly={props.readOnly}
                canCopy={props.text.length > 0}
                headingRef={headingRef}
                badges={props.headerBadges}
                onThemeToggle={() => setTheme(theme === "dark" ? "light" : "dark")}
                onBack={props.onBack}
                onEdit={props.onEdit}
                onCopy={() => props.onCopy(props.text)}
                onDelete={props.onDelete}
              />
              <ChatThreadView
                chatKey={activeLead.id}
                thread={thread}
                groupName={group?.name ?? ""}
                emptyHint={
                  unsentDraft(activeLead.data)
                    ? "Черновик AI уже в поле ввода. Проверьте и отправьте."
                    : "Вы ещё не писали клиенту. Напишите сами или нажмите «Черновик AI» справа от поля ввода."
                }
                messageHref={messageHref}
                canRetry={!props.readOnly && props.telegramConnected && !sending}
                onRetry={(m) => void send(m.text, m.mode, true)}
                onCopy={props.onCopy}
              />
              <ChatComposer
                text={props.text}
                mode={props.mode}
                sending={sending}
                readOnly={props.readOnly}
                telegramConnected={props.telegramConnected}
                dmAvailable={!!(activeLead.data.senderId || activeLead.data.senderUsername)}
                chatAvailable={!!groupUrl}
                sourceText={String(activeLead.data.message || "")}
                groupName={group?.name ?? ""}
                onTextChange={props.onTextChange}
                onModeChange={props.onModeChange}
                onDraft={requestDraft}
                onConnect={props.onConnect}
                onSend={(text, mode) => void send(text, mode, false)}
              />
            </>
          ) : (
            <NoChatSelected leads={listLeads} onOpen={open} />
          )}
        </section>
      </div>
      <AlertDialog open={confirmDraft} onOpenChange={setConfirmDraft}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Заменить текст черновиком?</AlertDialogTitle>
            <AlertDialogDescription>В поле ввода уже есть текст. Черновик AI заменит его целиком.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Оставить мой текст</AlertDialogCancel>
            <AlertDialogAction onClick={() => void props.onDraft()}>Заменить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
