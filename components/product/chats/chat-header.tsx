"use client";

import type { ReactNode, Ref } from "react";
import { ArrowLeft, Copy, ExternalLink, Moon, MoreVertical, Pencil, Send, Sun, Trash2, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatTheme } from "./chat-theme";
import { ChatAvatar } from "./chat-avatar";

export type ChatHeaderProps = {
  leadId: string;
  name: string;
  username: string;
  groupName: string;
  accountName: string;
  /** Profile (t.me/username) or the source post; "" hides the button. */
  telegramHref: string;
  theme: ChatTheme;
  readOnly: boolean;
  canCopy: boolean;
  /** Focus target when the chat opens full-screen (narrow layouts). */
  headingRef?: Ref<HTMLHeadingElement>;
  /** External badges (e.g. account penalty) rendered inside `[data-slot=chat-header-badges]`. */
  badges?: ReactNode;
  onThemeToggle: () => void;
  onBack: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
};

export function ChatHeader({
  leadId,
  name,
  username,
  groupName,
  accountName,
  telegramHref,
  theme,
  readOnly,
  canCopy,
  headingRef,
  badges,
  onThemeToggle,
  onBack,
  onEdit,
  onCopy,
  onDelete,
}: ChatHeaderProps) {
  const themeLabel = theme === "dark" ? "Светлая тема переписок" : "Тёмная тема переписок";
  return (
    <header className="chat-header">
      <Button variant="ghost" size="icon" className="chat-icon-btn chat-back" data-chat-back aria-label="Назад к списку" onClick={onBack}>
        <ArrowLeft aria-hidden />
      </Button>
      <ChatAvatar id={leadId} name={name} size="md" />
      <div className="chat-header-info">
        <div className="chat-header-title">
          <h2 className="chat-header-name" ref={headingRef} tabIndex={-1}>
            {name}
          </h2>
          <span data-slot="chat-header-badges" className="chat-header-badges">
            {badges}
          </span>
        </div>
        <p className="chat-header-sub">
          {username ? (
            <span className="chat-header-seg is-username" title={`@${username}`}>
              <span className="chat-header-seg-text">@{username}</span>
            </span>
          ) : null}
          {accountName ? (
            <span className="chat-header-seg is-account" title={`Переписка идёт с аккаунта «${accountName}»`}>
              <Send size={12} aria-hidden />
              <span className="chat-header-seg-text">через {accountName}</span>
            </span>
          ) : null}
          {groupName ? (
            <span className="chat-header-seg is-group" title={`Запрос найден в «${groupName}»`}>
              <UsersRound size={13} aria-hidden />
              <span className="chat-header-seg-text">{groupName}</span>
            </span>
          ) : null}
        </p>
      </div>
      <div className="chat-header-actions">
        <Button variant="ghost" size="icon" className="chat-icon-btn chat-theme-btn" aria-label={themeLabel} title={themeLabel} onClick={onThemeToggle}>
          {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
        </Button>
        {telegramHref ? (
          <Button asChild variant="ghost" size="icon" className="chat-icon-btn">
            <a href={telegramHref} target="_blank" rel="noreferrer" aria-label="Открыть в Telegram" title="Открыть в Telegram">
              <ExternalLink aria-hidden />
            </a>
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="chat-icon-btn" aria-label="Действия с диалогом">
              <MoreVertical aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="chat-menu" data-chat-theme={theme}>
            <DropdownMenuItem onSelect={onThemeToggle}>
              {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
              {themeLabel}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={readOnly} onSelect={onEdit}>
              <Pencil aria-hidden />
              Правки лида
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canCopy} onSelect={onCopy}>
              <Copy aria-hidden />
              Копировать текст
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={readOnly} onSelect={onDelete}>
              <Trash2 aria-hidden />
              Удалить лид
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
