"use client";

import { BotMessageSquare, CornerUpLeft, Eye, Loader2, Reply, SendHorizontal, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { isSendShortcut } from "@/lib/chat-view";

export type ChatMode = "dm" | "chat";

export type ChatComposerProps = {
  text: string;
  mode: ChatMode;
  sending: boolean;
  readOnly: boolean;
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
};

export function ChatComposer(props: ChatComposerProps) {
  const { text, mode, sending, readOnly, dmAvailable, chatAvailable, sourceText, groupName } = props;
  const canSend = !readOnly && !sending && text.trim().length > 0;
  const send = () => {
    if (canSend) props.onSend(text, mode);
  };
  const notice = readOnly
    ? { icon: Eye, text: "Режим наблюдателя: читать можно, отправка недоступна." }
    : mode === "dm" && !dmAvailable
      ? { icon: TriangleAlert, text: "Нет Telegram id клиента — пересканируйте группу или ответьте в группе." }
      : null;

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
            {notice.text}
          </p>
        ) : null}
        <div className="chat-compose-row">
          <Button
            variant="ghost"
            size="icon"
            className="chat-icon-btn"
            aria-pressed={mode === "chat"}
            disabled={readOnly || (!chatAvailable && mode === "dm")}
            aria-label="Ответить в группе на исходный пост"
            title={chatAvailable ? "Ответить в группе на исходный пост" : "У лида нет ссылки на группу"}
            onClick={() => props.onModeChange(mode === "chat" ? "dm" : "chat")}
          >
            <Reply aria-hidden />
          </Button>
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
          <Button
            variant="ghost"
            size="icon"
            className="chat-icon-btn chat-ai-btn"
            disabled={readOnly || sending}
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
