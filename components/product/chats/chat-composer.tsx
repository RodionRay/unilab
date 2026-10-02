"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { BotMessageSquare, CornerUpLeft, Eye, Loader2, PlugZap, Reply, SendHorizontal, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { isSendShortcut } from "@/lib/chat-view";

export type ChatMode = "dm" | "chat";

export type ChatComposerProps = {
  text: string;
  mode: ChatMode;
  sending: boolean;
  readOnly: boolean;
  /** null = unknown (records not loaded): no «не подключён» notice, but nothing can be sent either. */
  telegramConnected: boolean | null;
  /** The lead has a Telegram id/username: a DM is possible. */
  dmAvailable: boolean;
  /** The lead is bound to a group with a link: a reply in the group is possible. */
  chatAvailable: boolean;
  sourceText: string;
  groupName: string;
  onTextChange: (text: string) => void;
  onModeChange: (mode: ChatMode) => void;
  onSend: (text: string, mode: ChatMode) => void;
  onDraft: () => void;
  onConnect: () => void;
  /** Host controls shown above the input (e.g. «Отправить позже»). */
  extras?: ReactNode;
};

type Notice = { icon: LucideIcon; text: string; action?: { label: string; run: () => void } };

function noticeFor(p: ChatComposerProps): Notice | null {
  if (p.readOnly) return { icon: Eye, text: "Режим наблюдателя: читать можно, отправка недоступна." };
  if (p.telegramConnected === false) return { icon: PlugZap, text: "Telegram не подключён.", action: { label: "Настроить аккаунты", run: p.onConnect } };
  if (p.mode === "dm" && !p.dmAvailable) {
    return {
      icon: TriangleAlert,
      text: "Нет связи с клиентом в личке: ответьте в группе.",
      action: p.chatAvailable ? { label: "Ответить в группе", run: () => p.onModeChange("chat") } : undefined,
    };
  }
  return null;
}

export function ChatComposer(props: ChatComposerProps) {
  const { text, mode, sending, readOnly, telegramConnected, dmAvailable, chatAvailable, sourceText, groupName } = props;
  const reachable = mode === "chat" ? chatAvailable : dmAvailable;
  const canSend = !readOnly && telegramConnected === true && reachable && !sending && text.trim().length > 0;
  const send = () => {
    if (canSend) props.onSend(text, mode);
  };
  const notice = noticeFor(props);

  return (
    <div className="chat-compose" data-mode={mode}>
      <div className="chat-compose-box">
        {mode === "chat" ? (
          <div className="chat-reply-bar">
            <CornerUpLeft size={18} className="chat-reply-icon" aria-hidden />
            <div className="chat-reply-body">
              <span className="chat-reply-title">Ответ в группе{groupName ? ` «${groupName}»` : ""}</span>
              <span className="chat-reply-text">{sourceText}</span>
            </div>
            <Button variant="ghost" size="icon-sm" className="chat-icon-btn" aria-label="Писать в личку" title="Писать в личку" onClick={() => props.onModeChange("dm")}>
              <X aria-hidden />
            </Button>
          </div>
        ) : null}
        {notice ? (
          <p className="chat-compose-notice" role="note">
            <notice.icon size={14} aria-hidden />
            <span>{notice.text}</span>
            {notice.action ? (
              <button type="button" className="chat-compose-notice-action" onClick={notice.action.run}>
                {notice.action.label}
              </button>
            ) : null}
          </p>
        ) : null}
        {props.extras ? <div className="chat-compose-extras">{props.extras}</div> : null}
        <div className="chat-compose-row">
          <Textarea
            data-chat-composer
            className="chat-input"
            rows={1}
            value={text}
            disabled={readOnly}
            aria-label={mode === "dm" ? "Сообщение клиенту в личку" : "Ответ в группу"}
            placeholder={readOnly ? "Только чтение" : mode === "dm" ? "Сообщение в личку…" : "Ответ в группу…"}
            onChange={(e) => props.onTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (!isSendShortcut(e)) return;
              e.preventDefault();
              send();
            }}
          />
          {mode === "dm" ? (
            <Button
              variant="ghost"
              size="icon"
              className="chat-icon-btn"
              disabled={readOnly || !chatAvailable}
              aria-label="Ответить в группе на исходный пост"
              title={chatAvailable ? "Ответить в группе на исходный пост" : "У лида нет ссылки на группу"}
              onClick={() => props.onModeChange("chat")}
            >
              <Reply aria-hidden />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="chat-icon-btn chat-ai-btn"
            disabled={readOnly || sending || telegramConnected !== true}
            aria-label="Черновик AI"
            title="Черновик AI: подготовить ответ"
            onClick={props.onDraft}
          >
            <BotMessageSquare aria-hidden />
          </Button>
        </div>
      </div>
      <Button className="chat-send" data-chat-send size="icon" disabled={!canSend} aria-label={mode === "dm" ? "Отправить в личку" : "Отправить в группу"} title="Отправить (Enter)" onClick={send}>
        {sending ? <Loader2 className="animate-spin" aria-hidden /> : <SendHorizontal aria-hidden />}
      </Button>
    </div>
  );
}
