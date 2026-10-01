'use client';
import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ApprovalQueue, type QueueItem } from './approval-queue';
import { DeleteProjectDialog } from './delete-project-dialog';
import { FunnelPanel } from './funnel-panel';
import { approvalQueue, isDraftKind, projectIdOf, type ProjectRecord, type WorkspaceRecord } from './model';
import { ProjectCardEditor } from './project-card-editor';
import { NewProjectDialog, ProjectSwitcher } from './project-switcher';

type Props = {
  records: readonly WorkspaceRecord[];
  projects: readonly ProjectRecord[];
  loading: boolean;
  error: string;
  aiKeyReady: boolean;
  telegramConnected: boolean;
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  onRefresh: () => Promise<void>;
  onOpenThread: (leadId: string) => void;
  onGoGroups: () => void;
  onRescan: () => Promise<void>;
};

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export function AiWorkspace(props: Props) {
  const { records, projects, loading, error, activeProjectId, onSelectProject, onRefresh } = props;
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ProjectRecord | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const groups = useMemo(() => records.filter((r) => r.kind === 'group'), [records]);
  const leads = useMemo(() => records.filter((r) => r.kind === 'lead'), [records]);
  const project = projects.find((p) => p.id === activeProjectId) ?? null;
  const groupCountOf = useCallback(
    (id: string) => groups.filter((g) => projectIdOf(g.data, projects) === id).length,
    [groups, projects],
  );

  const pendingByProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of projects) m.set(p.id, approvalQueue(leads, projects, p.id).length);
    return m;
  }, [leads, projects]);

  const queue = useMemo<QueueItem[]>(() => {
    const names = new Map(records.map((r) => [r.id, text(r.data.name)]));
    return approvalQueue(leads, projects, activeProjectId).map((l) => ({
      id: l.id,
      created: l.created,
      name: text(l.data.name),
      username: text(l.data.senderUsername),
      message: text(l.data.message),
      reason: text(l.data.reason),
      score: typeof l.data.score === 'number' ? l.data.score : null,
      sourceKind: text(l.data.sourceKind) || text(l.data.messageKind),
      chatName: names.get(text(l.data.groupId)) || text(l.data.source),
      accountName: names.get(text(l.data.accountId)) || '',
      draft: text(l.data.draft),
      draftKind: isDraftKind(l.data.draftKind) ? l.data.draftKind : 'group_reply',
    }));
  }, [records, leads, projects, activeProjectId]);

  const select = (id: string) => {
    if (id === activeProjectId) return;
    if (dirty) setPendingSwitch(id);
    else onSelectProject(id);
  };

  const refreshAll = useCallback(async () => {
    await onRefresh();
    setReloadKey((k) => k + 1);
  }, [onRefresh]);

  if (loading) return <WorkspaceSkeleton />;

  if (error && !records.length) {
    return (
      <div className="panel aiw-alert is-error aiw-page-error" role="alert">
        <AlertTriangle size={20} aria-hidden />
        <div className="min-w-0">
          <p className="aiw-alert-title">Не получилось загрузить проекты</p>
          <p className="aiw-help">{error}</p>
        </div>
        <Button variant="outline" onClick={() => void onRefresh()}>Повторить</Button>
      </div>
    );
  }

  const newProject = (
    <NewProjectDialog
      open={creating}
      onOpenChange={setCreating}
      onCreated={async (id) => { await onRefresh(); if (id) onSelectProject(id); }}
    />
  );

  if (!project) {
    return (
      <div className="aiw">
        <section className="panel aiw-first">
          <div className="aiw-first-copy">
            <h2>Создайте первый проект</h2>
            <p className="aiw-help">Опишите, что продаёте, и привяжите чаты. AI прочитает каждое новое сообщение и покажет, сколько из них — ваши клиенты.</p>
            <Button onClick={() => setCreating(true)}><Plus size={16} />Создать проект</Button>
          </div>
          <figure className="aiw-first-preview" aria-label="Так будет выглядеть воронка проекта">
            <figcaption className="aiw-meta">Так выглядит воронка проекта (пример)</figcaption>
            <p className="aiw-headline is-small">Из <strong>540</strong> сообщений за 7 дней AI нашёл <strong className="is-lead">9 лидов</strong></p>
            {[['Собрано', 540, 100], ['Короткие', 196, 36], ['Стоп-слова', 142, 26], ['Не лид', 61, 11], ['Лиды', 9, 2]].map(([label, count, pct]) => (
              <div key={label} className="aiw-row-main is-static" data-tone={label === 'Лиды' ? 'lead' : label === 'Собрано' ? 'total' : 'neutral'}>
                <span className="aiw-row-label"><span className="aiw-row-name">{label}</span></span>
                <span className="aiw-row-figures"><span className="aiw-row-count">{count}</span></span>
                <span className="aiw-row-bar" aria-hidden><span style={{ width: `${pct}%` }} /></span>
              </div>
            ))}
          </figure>
        </section>
        {newProject}
      </div>
    );
  }

  return (
    <div className="aiw">
      <ProjectSwitcher
        projects={projects}
        activeId={project.id}
        pendingByProject={pendingByProject}
        onSelect={select}
        onCreate={() => setCreating(true)}
      />
      <div className="aiw-top">
        <FunnelPanel
          projectId={project.id}
          groupCount={groupCountOf(project.id)}
          aiKeyReady={props.aiKeyReady}
          reloadKey={reloadKey}
          onGoGroups={props.onGoGroups}
          onRescan={async () => { await props.onRescan(); await onRefresh(); }}
        />
        <ApprovalQueue
          items={queue}
          telegramConnected={props.telegramConnected}
          onOpenThread={props.onOpenThread}
          onChanged={onRefresh}
        />
      </div>
      <ProjectCardEditor
        key={project.id}
        project={project}
        aiKeyReady={props.aiKeyReady}
        onDirtyChange={setDirty}
        onSaved={refreshAll}
        onDelete={() => setDeleting(project)}
      />
      {newProject}
      <DeleteProjectDialog
        project={deleting}
        projects={projects}
        groupCount={deleting ? groupCountOf(deleting.id) : 0}
        onClose={() => setDeleting(null)}
        onDeleted={async (moveTo) => { setDirty(false); await onRefresh(); onSelectProject(moveTo || ''); }}
      />
      <AlertDialog open={pendingSwitch !== null} onOpenChange={(o) => { if (!o) setPendingSwitch(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Карточка не сохранена</AlertDialogTitle>
            <AlertDialogDescription>Если перейти в другой проект, изменения в карточке «{project.data.name}» пропадут.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Остаться</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const id = pendingSwitch; setPendingSwitch(null); setDirty(false); if (id) onSelectProject(id); }}>
              Перейти без сохранения
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="aiw" aria-busy="true" aria-label="Загружаем AI-ассистента">
      <div className="aiw-switcher"><Skeleton className="h-9 w-48 rounded-full" /><Skeleton className="h-9 w-40 rounded-full" /></div>
      <div className="aiw-top">
        <div className="panel aiw-skeleton">
          <Skeleton className="h-9 w-4/5" />
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="aiw-skeleton-row"><Skeleton className="h-4 w-32" /><Skeleton className="h-2 flex-1" /><Skeleton className="h-4 w-12" /></div>
          ))}
        </div>
        <div className="panel aiw-skeleton">
          <Skeleton className="h-6 w-40" />
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    </div>
  );
}
