'use client';
import { useEffect, useId, useMemo, useState } from 'react';
import { ExternalLink, Loader2, RotateCcw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { relativeTimeRu } from '@/lib/telegram-accounts';
import { toast } from '@/lib/workspace-notifications';
import { errorMessage, workspaceAction, type ActionError } from './api';
import { sendModeFor, type DraftKind } from './model';

export type QueueItem = {
  id: string;
  created: string;
  name: string;
  username: string;
  message: string;
  reason: string;
  score: number | null;
  sourceKind: string;
  chatName: string;
  accountName: string;
  draft: string;
  draftKind: DraftKind;
};

const SOURCE_LABEL: Record<string, string> = { group: 'в чате', discussion: 'в обсуждении', comment: 'в комментариях', dm: 'в личке' };
const KIND_LABEL: Record<DraftKind, string> = {
  group_reply: 'Ответ в чат',
  dm_first: 'Первое сообщение в личку',
  dm_continue: 'Продолжение в личке',
};

type Props = {
  items: readonly QueueItem[];
  telegramConnected: boolean;
  onOpenThread: (id: string) => void;
  onChanged: () => Promise<void> | void;
};

export function ApprovalQueue({ items, telegramConnected, onOpenThread, onChanged }: Props) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const visible = useMemo(() => items.filter((i) => !hidden.has(i.id)), [items, hidden]);
  const [selectedId, setSelectedId] = useState('');
  const selected = visible.find((i) => i.id === selectedId) ?? visible[0];
  const titleId = useId();

  useEffect(() => {
    // server state caught up: forget ids that are no longer in the queue
    setHidden((prev) => {
      const ids = new Set(items.map((i) => i.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const done = (id: string) => {
    setHidden((prev) => new Set([...prev, id]));
    void onChanged();
  };

  return (
    <section className="panel aiw-queue" aria-labelledby={titleId}>
      <div className="aiw-panel-head">
        <h2 id={titleId}>На одобрении <span className="aiw-count">{visible.length}</span></h2>
      </div>
      {!visible.length ? (
        <div className="aiw-empty is-compact">
          <p className="aiw-empty-title">Черновиков на одобрении нет</p>
          <p className="aiw-help">Когда AI найдёт горячего лида, он напишет черновик ответа. Без вашего клика ничего не отправится.</p>
        </div>
      ) : (
        <>
          <ul className="aiw-queue-list" aria-label="Черновики">
            {visible.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="aiw-queue-row"
                  aria-current={item.id === selected?.id ? 'true' : undefined}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="aiw-queue-who">
                    <span className="aiw-queue-name">{item.name || 'Без имени'}</span>
                    {item.score !== null && <span className="aiw-score" title="Оценка AI из 100">{item.score}</span>}
                  </span>
                  <span className="aiw-queue-snippet">{item.message}</span>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <DraftDetail
              key={selected.id}
              item={selected}
              telegramConnected={telegramConnected}
              onOpenThread={onOpenThread}
              onDone={done}
            />
          )}
        </>
      )}
    </section>
  );
}

type DetailProps = { item: QueueItem; telegramConnected: boolean; onOpenThread: (id: string) => void; onDone: (id: string) => void };

function DraftDetail({ item, telegramConnected, onOpenThread, onDone }: DetailProps) {
  const [text, setText] = useState(item.draft);
  const [busy, setBusy] = useState<'' | 'send' | 'dismiss' | 'regen'>('');
  const [clientMsgId] = useState(() => crypto.randomUUID());
  const fieldId = useId();
  const mode = sendModeFor(item.draftKind);

  async function send() {
    if (!text.trim()) return;
    setBusy('send');
    try {
      await workspaceAction({ action: 'send_lead_message', id: item.id, mode, text: text.trim(), clientMsgId });
      toast.success(mode === 'chat' ? 'Ответ отправлен в чат' : 'Сообщение отправлено в личку');
      onDone(item.id);
    } catch (e) {
      const err = e as ActionError;
      toast.error(err.data?.unknown ? `${errorMessage(e)} Проверьте переписку, прежде чем отправлять снова.` : errorMessage(e));
    } finally {
      setBusy('');
    }
  }

  async function dismiss() {
    setBusy('dismiss');
    try {
      await workspaceAction({ action: 'dismiss_draft', id: item.id });
      toast.success('Черновик отклонён, лид остался в «Лидах»');
      onDone(item.id);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy('');
    }
  }

  async function regenerate() {
    setBusy('regen');
    try {
      const r = await workspaceAction<{ draft?: string }>({ action: 'draft', id: item.id, kind: item.draftKind });
      if (r.draft) setText(r.draft);
      toast.success('AI написал новый вариант');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy('');
    }
  }

  const where = mode === 'chat' ? `в чат «${item.chatName || 'группа'}»` : `в личку${item.username ? ` @${item.username}` : ''}`;
  return (
    <article className="aiw-draft" aria-label={`Черновик для ${item.name}`}>
      <header className="aiw-draft-head">
        <div className="min-w-0">
          <p className="aiw-draft-name">{item.name || 'Без имени'}{item.username && <span className="aiw-muted"> @{item.username}</span>}</p>
          <p className="aiw-meta">{item.chatName ? `${item.chatName} · ` : ''}{SOURCE_LABEL[item.sourceKind] ?? 'в Telegram'} · {relativeTimeRu(item.created)}</p>
        </div>
        <Button variant="ghost" size="sm" className="aiw-link-btn" onClick={() => onOpenThread(item.id)}>
          Открыть переписку<ExternalLink size={13} />
        </Button>
      </header>
      <blockquote className="aiw-source">{item.message}</blockquote>
      {item.reason && <p className="aiw-why">Почему лид: {item.reason}</p>}
      <div className="aiw-field">
        <div className="aiw-label-row">
          <label className="aiw-label" htmlFor={fieldId}>{KIND_LABEL[item.draftKind]}</label>
          <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void regenerate()} aria-label="Написать черновик заново">
            {busy === 'regen' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}Заново
          </Button>
        </div>
        <Textarea id={fieldId} rows={5} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
      </div>
      <footer className="aiw-draft-foot">
        <div className="aiw-draft-actions">
          <Button disabled={!!busy || !text.trim() || !telegramConnected} onClick={() => void send()}>
            {busy === 'send' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}Отправить
          </Button>
          <Button variant="ghost" disabled={!!busy} onClick={() => void dismiss()}>
            {busy === 'dismiss' && <Loader2 size={15} className="animate-spin" />}Отклонить
          </Button>
        </div>
        <p className="aiw-meta">
          {telegramConnected ? `Уйдёт ${where}${item.accountName ? ` от ${item.accountName}` : ''}` : 'Telegram не подключён: отправка недоступна'}
        </p>
      </footer>
    </article>
  );
}
