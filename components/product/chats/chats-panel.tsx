"use client";

import { useMemo, useState, type ReactNode } from "react";
import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { telegramMessageLink } from "@/lib/audience-invite";
import { buildThread, chatListItem, unsentDraft, type ChatLead, type ThreadMessage } from "@/lib/chat-view";
import { ChatComposer, type ChatMode } from "./chat-composer";
import { ChatHeader } from "./chat-header";
import { ChatList, type ChatFolder } from "./chat-list";
import { useChatTheme } from "./chat-theme";
import { ChatThreadView } from "./chat-thread";

export type ChatGroupRef = { name: string; url: string };

export type ChatsPanelProps = {
  /** Filtered and sorted chats of the current folder. */
  leads: readonly ChatLead[];
  /** The open chat (page `detail`); null = nothing selected. */
  activeLead: ChatLead | null;
  loading: boolean;
  folder: ChatFolder;
  counts: { fresh: number; viewed: number };
  query: string;
  groups: Readonly<Record<string, ChatGroupRef>>;
  accounts: Readonly<Record<string, string>>;
  text: string;
  mode: ChatMode;
  sending: boolean;
  readOnly: boolean;
  /** Rendered in the chat header `[data-slot=chat-header-badges]` (account penalty badge etc.). */
  headerBadges?: ReactNode;
  onFolderChange: (folder: ChatFolder) => void;
  onQueryChange: (query: string) => void;
  onTextChange: (text: string) => void;
  onModeChange: (mode: ChatMode) => void;
  onOpen: (lead: ChatLead) => void;
  /** Mobile back (and Esc-like close): clear the active chat. */
  onBack: () => void;
  onSend: (text: string, mode: ChatMode) => void;
  onDraft: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
};

type Outbox = { leadId: string; text: string; mode: ChatMode; at: string };

function NoChatSelected({ leads, onOpen }: { leads: readonly ChatLead[]; onOpen: (lead: ChatLead) => void }) {
  const firstUnread = leads.find((l) => chatListItem(l).unreadCount > 0) ?? null;
  return (
    <Empty className="chat-placeholder">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="chat-placeholder-icon">
          <MessagesSquare aria-hidden />
        </EmptyMedia>
        <EmptyTitle>Выберите диалог</EmptyTitle>
        <EmptyDescription>
          {firstUnread ? "Клиенты ждут ответа — откройте диалог, чтобы прочитать и ответить." : "Слева — все переписки с клиентами из Telegram."}
        </EmptyDescription>
      </EmptyHeader>
      {firstUnread ? (
        <EmptyContent>
          <Button onClick={() => onOpen(firstUnread)}>Открыть: {String(firstUnread.data.name || "диалог")}</Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

export function ChatsPanel(props: ChatsPanelProps) {
  const { leads, activeLead, groups, accounts, sending } = props;
  const [theme, setTheme] = useChatTheme();
  // Opening a chat marks it viewed in the same render, so the unread state is captured at click time.
  const [opened, setOpened] = useState<{ id: string; unread: boolean; index: number } | null>(null);
  const [outbox, setOutbox] = useState<Outbox | null>(null);

  const open = (lead: ChatLead) => {
    setOpened({ id: lead.id, unread: !lead.data.viewed, index: leads.findIndex((l) => l.id === lead.id) });
    props.onOpen(lead);
  };

  const activeId = activeLead?.id ?? null;
  // Opening a «Новые» chat moves it to «Просмотренные»; like Telegram's unread folder, it stays in place while open.
  const listLeads = useMemo(() => {
    if (!activeLead || !opened || opened.id !== activeLead.id || opened.index < 0) return leads;
    if (leads.some((l) => l.id === activeLead.id)) return leads;
    const next = [...leads];
    next.splice(Math.min(opened.index, next.length), 0, activeLead);
    return next;
  }, [leads, activeLead, opened]);
  const pending = sending && outbox && outbox.leadId === activeId ? outbox : null;
  const unread = activeLead && opened?.id === activeLead.id ? opened.unread : !activeLead?.data.viewed;
  const thread = useMemo(
    () => (activeLead ? buildThread(activeLead, { unread, pending }) : null),
    [activeLead, unread, pending],
  );

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
    <div className="chats-panel" data-chats-panel data-chat-theme={theme} data-chat-open={activeLead ? "true" : "false"}>
      <div className="chats-layout">
        <ChatList
          leads={listLeads}
          activeId={activeId}
          loading={props.loading}
          folder={props.folder}
          counts={props.counts}
          query={props.query}
          onFolderChange={props.onFolderChange}
          onQueryChange={props.onQueryChange}
          onOpen={open}
        />
        <section className="chat-pane" aria-label={activeLead ? `Диалог: ${String(activeLead.data.name || "")}` : "Диалог не выбран"}>
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
                badges={props.headerBadges}
                onThemeToggle={() => setTheme(theme === "dark" ? "light" : "dark")}
                onBack={props.onBack}
                onEdit={props.onEdit}
                onCopy={props.onCopy}
                onDelete={props.onDelete}
              />
              <ChatThreadView
                chatKey={activeLead.id}
                thread={thread}
                groupName={group?.name ?? ""}
                emptyHint={
                  unsentDraft(activeLead.data)
                    ? "Черновик AI уже в поле ввода — проверьте и отправьте."
                    : "Вы ещё не писали клиенту. Напишите сами или нажмите «Черновик AI» справа от поля ввода."
                }
                messageHref={messageHref}
              />
              <ChatComposer
                text={props.text}
                mode={props.mode}
                sending={sending}
                readOnly={props.readOnly}
                dmAvailable={!!(activeLead.data.senderId || activeLead.data.senderUsername)}
                chatAvailable={!!groupUrl}
                sourceText={String(activeLead.data.message || "")}
                groupName={group?.name ?? ""}
                onTextChange={props.onTextChange}
                onModeChange={props.onModeChange}
                onDraft={props.onDraft}
                onSend={(text, mode) => {
                  setOutbox({ leadId: activeLead.id, text: text.trim(), mode, at: new Date().toISOString() });
                  props.onSend(text, mode);
                }}
              />
            </>
          ) : (
            <NoChatSelected leads={leads} onOpen={open} />
          )}
        </section>
      </div>
    </div>
  );
}
