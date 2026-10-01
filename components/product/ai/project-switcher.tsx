'use client';
import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/lib/workspace-notifications';
import { errorMessage, workspaceAction } from './api';
import { newProjectData, type ProjectRecord } from './model';

export const MAX_PROJECTS = 10;

type Props = {
  projects: readonly ProjectRecord[];
  activeId: string;
  pendingByProject: ReadonlyMap<string, number>;
  onSelect: (id: string) => void;
  onCreate: () => void;
};

export function ProjectSwitcher({ projects, activeId, pendingByProject, onSelect, onCreate }: Props) {
  const full = projects.length >= MAX_PROJECTS;
  return (
    <div className="aiw-switcher">
      <nav className="aiw-tabs" aria-label="Проекты">
        {projects.map((p) => {
          const pending = pendingByProject.get(p.id) ?? 0;
          const active = p.id === activeId;
          return (
            <button
              key={p.id}
              type="button"
              className="aiw-tab"
              aria-current={active ? 'page' : undefined}
              data-active={active || undefined}
              onClick={() => onSelect(p.id)}
            >
              <span className="aiw-tab-name">{p.data.name}</span>
              {pending > 0 && (
                <span className="aiw-tab-count" aria-label={`на одобрении ${pending}`}>{pending}</span>
              )}
            </button>
          );
        })}
      </nav>
      <Button
        variant="ghost"
        size="sm"
        className="aiw-new-project"
        disabled={full}
        title={full ? `Не больше ${MAX_PROJECTS} проектов` : undefined}
        onClick={onCreate}
      >
        <Plus size={15} />Новый проект
      </Button>
    </div>
  );
}

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (id: string) => Promise<void> | void };

export function NewProjectDialog({ open, onOpenChange, onCreated }: DialogProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Назовите проект: так он будет подписан в списке.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await workspaceAction<{ id?: string }>({ action: 'project_create', data: newProjectData(name, url) });
      toast.success(`Проект «${name.trim()}» создан`);
      setName('');
      setUrl('');
      onOpenChange(false);
      await onCreated(String(r.id || ''));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый проект</DialogTitle>
          <DialogDescription>
            Проект — это то, что вы продаёте. У каждого свои чаты, своё описание для AI и свои лиды.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <label className="aiw-field">
            <span className="aiw-label">Название</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Например, Фулфилмент для WB" autoFocus aria-invalid={!!error || undefined} />
          </label>
          <label className="aiw-field">
            <span className="aiw-label">Сайт <span className="aiw-optional">необязательно</span></span>
            <Input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} placeholder="https://" />
            <span className="aiw-help">По сайту AI сможет сам заполнить карточку проекта.</span>
          </label>
          {error && <p role="alert" className="form-error">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Отменить</Button>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" size={15} />}Создать проект</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
