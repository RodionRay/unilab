"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, Clock3, Flame } from "lucide-react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SendNonce } from "@/lib/tma/client";
import type { LeadFeed, LeadMessage, Temperature } from "@/lib/tma/contract";
import { toApiError, useFeedQuery, useOnline, useTmaSession } from "@/components/tma/context";
import { dayKey, formatClock, formatDayLabel } from "@/components/tma/format";
import { Avatar, ErrorState } from "@/components/tma/parts";
import { atLeast, haptic, MAIN_BUTTON_COLOR, MAIN_BUTTON_TEXT_COLOR } from "@/components/tma/telegram";

type Lead = LeadFeed["lead"];

const TEMPERATURE_LABEL: Record<Temperature, string> = { hot: "Горячий", warm: "Тёплый", cold: "Холодный" };

export function LeadScreen({ leadId, onViewed }: { leadId: string; onViewed(id: string): void }) {
  const { client, app } = useTmaSession();
  const online = useOnline();
  const feed = useFeedQuery(`lead:${leadId}`, () => client.feed("lead", { id: leadId }));

  // REQ-M2: mark viewed once per open; failures are not the user's problem here.
  const marked = useRef("");
  useEffect(() => {
    if (feed.status !== "ready" || marked.current === leadId) return;
    marked.current = leadId;
    onViewed(leadId);
    client.markLeadViewed(leadId).catch(() => undefined);
  }, [client, feed.status, leadId, onViewed]);

  if (feed.status === "loading") return <LeadSkeleton />;
  if (feed.status === "error" && feed.error) {
    return (
      <div className="tma-scroll">
        <ErrorState error={feed.error} online={online} onRetry={() => void feed.reload()} />
      </div>
    );
  }
  if (!feed.data) return null;
  return <LeadView key={leadId} lead={feed.data.lead} reload={feed.reload} hasMainButton={atLeast(app, "6.1")} />;
}

function LeadSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загрузка" className="tma-scroll flex flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-14 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      </div>
      <Skeleton className="h-16 w-4/5 rounded-2xl" />
      <Skeleton className="ml-auto h-12 w-3/5 rounded-2xl" />
      <Skeleton className="h-10 w-2/3 rounded-2xl" />
    </div>
  );
}

function LeadView({ lead, reload, hasMainButton }: { lead: Lead; reload(): Promise<void>; hasMainButton: boolean }) {
  const { client, app, onFatal } = useTmaSession();
  const [text, setText] = useState(lead.draft);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<LeadMessage | null>(null);
  const [sendError, setSendError] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState("");
  const nonce = useRef(new SendNonce());
  const inFlight = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);

  const trimmed = text.trim();
  const canSend = lead.canReply && trimmed.length > 0 && !sending;

  async function send() {
    const body = text.trim();
    if (inFlight.current || !lead.canReply || !body) return;
    inFlight.current = true;
    const clientMsgId = nonce.current.for(body);
    setSending(true);
    setSendError("");
    setPending({ from: "us", text: body, at: new Date().toISOString(), status: "pending" });
    try {
      await client.sendLeadMessage({ leadId: lead.id, text: body, clientMsgId });
      nonce.current.reset();
      haptic(app, "success");
      setText("");
      await reload();
      setPending(null);
    } catch (e) {
      const err = toApiError(e);
      if (err.code === "session_expired") onFatal(err);
      haptic(app, "error");
      setPending(null);
      setSendError(err.code === "network" ? "Нет соединения — сообщение не отправлено. Нажмите «Отправить» ещё раз." : err.message);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  // Native MainButton = the screen's one primary action (REQ-S2). The click handler is registered once and
  // reads the latest state through a ref, so a double tap during a send hits the inFlight guard.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    if (!app || !hasMainButton) return;
    const mb = app.MainButton;
    const onClick = () => void sendRef.current();
    mb.setParams({ text: "Отправить", color: MAIN_BUTTON_COLOR, text_color: MAIN_BUTTON_TEXT_COLOR });
    mb.onClick(onClick);
    mb.show();
    return () => {
      mb.offClick(onClick);
      mb.hideProgress();
      mb.hide();
    };
  }, [app, hasMainButton]);
  useEffect(() => {
    if (!app || !hasMainButton) return;
    const mb = app.MainButton;
    if (sending) mb.showProgress(false);
    else mb.hideProgress();
    mb.setParams({ is_active: canSend });
  }, [app, hasMainButton, canSend, sending]);

  async function makeDraft() {
    setDrafting(true);
    setDraftError("");
    try {
      const out = await client.draft(lead.id);
      setText(out.draft);
    } catch (e) {
      const err = toApiError(e);
      if (err.code === "session_expired") onFatal(err);
      setDraftError(err.message);
    } finally {
      setDrafting(false);
    }
  }

  const messages = pending ? [...lead.messages, pending] : lead.messages;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <>
      <div ref={scroller} className="tma-scroll" data-testid="lead-scroll">
        <LeadHeader lead={lead} />
        <OriginalMessage lead={lead} defaultOpen={lead.messages.length === 0} />
        <ol aria-label="Переписка" className="flex flex-col gap-1.5 px-3 pt-2 pb-4">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || dayKey(prev.at) !== dayKey(m.at);
            return (
              <Fragment key={`${m.at}-${i}`}>
                {newDay ? (
                  <li className="sticky top-1 z-10 flex justify-center py-1.5">
                    <span className="rounded-full bg-(--tma-fill-strong) px-2.5 py-0.5 text-[13px] font-medium text-(--tma-text) backdrop-blur-sm">
                      {formatDayLabel(m.at)}
                    </span>
                  </li>
                ) : null}
                <li>
                  <MessageBubble message={m} />
                </li>
              </Fragment>
            );
          })}
          {messages.length === 0 ? (
            <li className="py-4 text-center text-[13px] text-(--tma-hint)">Вы ещё не писали этому человеку</li>
          ) : null}
        </ol>
      </div>
      <div className="shrink-0 border-t border-(--tma-separator) bg-(--tma-bar) px-3 pt-2 pb-[max(8px,var(--tma-inset-bottom))]">
        {!lead.canReply ? (
          <p role="status" className="flex items-start gap-1.5 px-1 pb-2 text-[13px] text-(--tma-destructive)">
            <AlertCircle className="mt-px size-4 shrink-0" aria-hidden />
            {lead.replyBlockedReason || "Ответить сейчас нельзя"}
          </p>
        ) : null}
        {sendError ? (
          <p role="alert" className="px-1 pb-2 text-[13px] text-(--tma-destructive)">
            {sendError}
          </p>
        ) : null}
        <label htmlFor="tma-reply" className="sr-only">
          Ответ лиду
        </label>
        <Textarea
          id="tma-reply"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!lead.canReply || sending}
          placeholder="Сообщение"
          rows={1}
          className="max-h-[32svh] min-h-11 rounded-[20px] border-(--tma-separator) bg-(--tma-section) px-4 py-2.5 text-[16px] leading-snug shadow-none md:text-[16px] dark:bg-(--tma-section)"
        />
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={() => void makeDraft()}
            disabled={drafting || sending || !lead.canReply}
            className="flex min-h-10 items-center gap-1.5 rounded-full px-2 text-[14px] font-medium text-(--tma-link)"
          >
            {drafting ? <Spinner className="size-4" /> : null}
            {drafting ? "Готовим черновик…" : text.trim() ? "Переписать AI-черновиком" : "AI-черновик"}
          </button>
          {!hasMainButton ? (
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              className="min-h-10 rounded-full bg-(--tma-accent) px-4 text-[15px] font-semibold text-(--tma-accent-ink)"
            >
              Отправить
            </button>
          ) : null}
        </div>
        {draftError ? (
          <p role="alert" className="px-2 pb-1 text-[13px] text-(--tma-destructive)">
            {draftError}
          </p>
        ) : null}
      </div>
    </>
  );
}

function LeadHeader({ lead }: { lead: Lead }) {
  return (
    <header className="flex flex-col gap-3 px-4 pt-4 pb-3">
      <div className="flex items-center gap-3">
        <Avatar id={lead.id} name={lead.name} username={lead.username} size={56} />
        <div className="min-w-0 flex-1">
          <h1 tabIndex={-1} className="truncate text-[20px] leading-6 font-semibold outline-none">
            {lead.name || `@${lead.username}`}
          </h1>
          <p className="truncate text-[14px] text-(--tma-hint)">
            {lead.username ? `@${lead.username}` : "без username"} · {lead.source}
          </p>
        </div>
        <TemperatureChip value={lead.temperature} />
      </div>
      {lead.reason ? (
        <p className="text-[14px] leading-snug text-(--tma-hint)">
          <span className="font-medium text-(--tma-text)">Почему лид: </span>
          {lead.reason}
        </p>
      ) : null}
    </header>
  );
}

function TemperatureChip({ value }: { value: Temperature }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold",
        value === "hot" ? "bg-(--tma-accent) text-(--tma-accent-ink)" : "bg-(--tma-fill) text-(--tma-text)",
      )}
    >
      {value === "hot" ? <Flame className="size-3.5 fill-current" aria-hidden /> : null}
      {TEMPERATURE_LABEL[value]}
    </span>
  );
}

function OriginalMessage({ lead, defaultOpen }: { lead: Lead; defaultOpen: boolean }) {
  return (
    <details open={defaultOpen} className="group mx-4 mb-1 rounded-(--tma-radius-section) bg-(--tma-page) [.tma-root[data-surface=grouped]_&]:bg-(--tma-section)">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 text-[14px] font-medium [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate">Сообщение в группе «{lead.source}»</span>
        <ChevronDown className="size-4 shrink-0 text-(--tma-hint) transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <p className="px-3.5 pb-3 text-[15px] leading-snug whitespace-pre-wrap [overflow-wrap:anywhere]">{lead.message}</p>
    </details>
  );
}

function MessageBubble({ message }: { message: LeadMessage }) {
  const ours = message.from === "us";
  return (
    <Bubble align={ours ? "end" : "start"} variant="muted" className="max-w-[85%]" data-testid={`bubble-${message.status}`}>
      <BubbleContent
        className={cn(
          "rounded-[18px] px-3 py-1.5 text-[16px] leading-snug text-(--tma-text) [overflow-wrap:anywhere] whitespace-pre-wrap",
          ours ? "tma-tail-out bg-(--tma-bubble-out)!" : "tma-tail-in bg-(--tma-bubble-in)!",
          message.status === "failed" && "ring-1 ring-(--tma-destructive)",
        )}
      >
        {message.text}
        <span className="float-right mt-1.5 ml-2 flex translate-y-0.5 items-center gap-0.5 text-[12px] text-(--tma-hint)">
          <span className="tma-num">{formatClock(message.at)}</span>
          {ours ? <StatusIcon status={message.status} /> : null}
        </span>
      </BubbleContent>
      {message.status === "failed" ? (
        <p className="pr-1 text-right text-[12px] text-(--tma-destructive)">Не доставлено{message.error ? `: ${message.error}` : ""}</p>
      ) : null}
    </Bubble>
  );
}

function StatusIcon({ status }: { status: LeadMessage["status"] }) {
  if (status === "sent") return <Check className="size-3.5 text-(--tma-link)" aria-label="отправлено" />;
  if (status === "pending") return <Clock3 className="size-3.5" aria-label="отправляется" />;
  return <AlertCircle className="size-3.5 text-(--tma-destructive)" aria-label="не доставлено" />;
}
