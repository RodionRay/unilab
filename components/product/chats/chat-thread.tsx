"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Copy, CornerUpLeft, ExternalLink, RotateCw, UsersRound } from "lucide-react";
import { Bubble } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { describeSendError, type ChatThread, type ThreadMessage } from "@/lib/chat-view";
import { ChatTick } from "./chat-ticks";

export type ChatThreadProps = {
  /** Changes when another chat opens: resets the scroll position. */
  chatKey: string;
  thread: ChatThread;
  groupName: string;
  /** Hint under a thread with no replies yet. */
  emptyHint: string;
  messageHref: (message: ThreadMessage) => string;
  /** Resend of a failed message is possible now (connected, not read-only, nothing in flight). */
  canRetry: boolean;
  onRetry: (message: ThreadMessage) => void;
  onCopy: (text: string) => void;
};

/** Pixels from the bottom that still count as "at the bottom" (new messages keep the view pinned). */
const NEAR_BOTTOM_PX = 120;
const SHOW_DOWN_PX = 240;

/** Telegram Web A bubble tails ("appendix"): incoming points left, outgoing right. */
function Tail({ out }: { out: boolean }) {
  return out ? (
    <svg className="chat-tail" viewBox="0 0 11 20" width="11" height="20" aria-hidden>
      <path d="M6 17H0V0c.193 2.84.876 5.767 2.05 8.782.904 2.325 2.446 4.485 4.625 6.48A1 1 0 016 17z" />
    </svg>
  ) : (
    <svg className="chat-tail" viewBox="0 0 9 20" width="9" height="20" aria-hidden>
      <path d="M3 17h6V0c-.193 2.84-.876 5.767-2.05 8.782-.904 2.325-2.446 4.485-4.625 6.48A1 1 0 003 17z" />
    </svg>
  );
}

type BubbleProps = {
  m: ThreadMessage;
  groupName: string;
  href: string;
  canRetry: boolean;
  onRetry: (m: ThreadMessage) => void;
  onCopy: (text: string) => void;
};

function MessageBubble({ m, groupName, href, canRetry, onRetry, onCopy }: BubbleProps) {
  const out = m.side === "out";
  // Reserves room on the last line so the absolute time/ticks never overlap text (Telegram's in-bubble stamp).
  const spacer = m.time || m.tick ? <span className="chat-stamp-spacer" data-out={out || undefined} aria-hidden /> : null;
  return (
    <Bubble
      align={out ? "end" : "start"}
      className="chat-msg"
      data-chat-msg
      data-side={m.side}
      data-status={m.tick ?? "received"}
      data-first={m.first || undefined}
      data-last={m.last || undefined}
      data-source={m.source || undefined}
    >
      <div className="chat-msg-body">
        {m.last ? <Tail out={out} /> : null}
        {m.source ? (
          <span className="chat-source-label">
            <UsersRound size={13} aria-hidden />
            {groupName ? `Запрос в «${groupName}»` : "Исходный запрос"}
          </span>
        ) : null}
        {m.quote ? (
          <span className="chat-quote">
            <span className="chat-quote-title">
              <CornerUpLeft size={12} aria-hidden />
              Ответ в группе
            </span>
            <span className="chat-quote-text">{m.quote}</span>
          </span>
        ) : null}
        <p className="chat-text">
          {m.text}
          {href || m.tick === "failed" ? null : spacer}
        </p>
        {m.tick === "failed" ? <FailedNote m={m} canRetry={canRetry} onRetry={onRetry} onCopy={onCopy} /> : null}
        {href ? (
          <p className="chat-link-row">
            <a className="chat-link" href={href} target="_blank" rel="noreferrer">
              {m.source ? "Открыть исходное" : out ? "Смотреть в Telegram" : "Открыть в Telegram"}
              <ExternalLink size={12} aria-hidden />
            </a>
            {spacer}
          </p>
        ) : null}
        {m.time || m.tick ? (
          <span className="chat-stamp">
            {m.time ? <time dateTime={m.at}>{m.time}</time> : null}
            {m.tick ? <ChatTick state={m.tick} /> : null}
          </span>
        ) : null}
      </div>
    </Bubble>
  );
}

/** Failed send: plain-language reason (Telegram code in the tooltip) and the two ways out. */
function FailedNote({ m, canRetry, onRetry, onCopy }: Omit<BubbleProps, "groupName" | "href">) {
  const err = describeSendError(m.error);
  return (
    <div className="chat-error" role="note">
      <p className="chat-error-text" title={err.code || undefined}>
        {err.text}
      </p>
      <div className="chat-error-actions">
        <button type="button" className="chat-error-btn" data-chat-retry disabled={!canRetry} onClick={() => onRetry(m)}>
          <RotateCw size={13} aria-hidden />
          Повторить
        </button>
        <button type="button" className="chat-error-btn" onClick={() => onCopy(m.text)}>
          <Copy size={13} aria-hidden />
          Копировать
        </button>
      </div>
    </div>
  );
}

export function ChatThreadView({ chatKey, thread, groupName, emptyHint, messageHref, canRetry, onRetry, onCopy }: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const shownKey = useRef("");
  const [showDown, setShowDown] = useState(false);
  const count = thread.items.length;

  // Open: jump to the unread divider (unread chat) or to the newest message.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || shownKey.current === chatKey) return;
    shownKey.current = chatKey;
    const divider = dividerRef.current;
    el.scrollTop = divider ? Math.max(0, divider.offsetTop - 96) : el.scrollHeight;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, [chatKey, count]);

  // New message in the open chat: stay pinned to the bottom only if the user was there.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !nearBottom.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [count]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottom.current = distance < NEAR_BOTTOM_PX;
    const next = distance > SHOW_DOWN_PX;
    if (next !== showDown) setShowDown(next);
  }

  const onlySource = thread.items.filter((i) => i.kind === "message").length === 1;

  return (
    <div className="chat-log" data-chat-thread>
      <div className="chat-log-scroll" ref={scrollRef} onScroll={onScroll} tabIndex={0} role="log" aria-label="Сообщения">
        <div className="chat-log-col">
          {thread.items.map((item) => {
            if (item.kind === "date") {
              return (
                <Marker key={item.key} className="chat-date">
                  <MarkerContent className="chat-date-pill">{item.label}</MarkerContent>
                </Marker>
              );
            }
            if (item.kind === "unread") {
              return (
                <Marker key={item.key} ref={dividerRef} className="chat-unread-divider" data-unread-divider>
                  <MarkerContent>Непрочитанные сообщения</MarkerContent>
                </Marker>
              );
            }
            return (
              <MessageBubble
                key={item.key}
                m={item}
                groupName={groupName}
                href={messageHref(item)}
                canRetry={canRetry}
                onRetry={onRetry}
                onCopy={onCopy}
              />
            );
          })}
          {onlySource && emptyHint ? (
            <Marker className="chat-empty-hint">
              <MarkerContent>{emptyHint}</MarkerContent>
            </Marker>
          ) : null}
        </div>
      </div>
      <Button
        variant="secondary"
        size="icon"
        className="chat-down"
        data-visible={showDown || undefined}
        tabIndex={showDown ? 0 : -1}
        aria-hidden={!showDown}
        aria-label="К последним сообщениям"
        onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })}
      >
        <ArrowDown aria-hidden />
      </Button>
    </div>
  );
}
