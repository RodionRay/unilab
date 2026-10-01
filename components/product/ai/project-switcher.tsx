'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  const { ref, more } = useOverflowEdges(activeId, projects.length);
  return (
    <div className="aiw-switcher">
      <nav ref={ref} className="aiw-tabs" aria-label="Проекты" data-more-start={more.start || undefined} data-more-end={more.end || undefined}>
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

type Edges = { start: boolean; end: boolean };

/** Which sides of the scrolling tab strip hide tabs: drives the edge fade, so a cut-off tab reads as «scroll for more». */
function useOverflowEdges(activeId: string, count: number) {
  const ref = useRef<HTMLElement>(null);
  const [more, setMore] = useState<Edges>({ start: false, end: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setMore((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // bring the active tab into the strip without scrolling the page (scrollIntoView would)
    const tab = el.querySelector<HTMLElement>('[data-active]')?.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    if (tab && (tab.left < box.left || tab.right > box.right)) el.scrollLeft += tab.left - box.left - 24;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [activeId, count, measure]);
  return { ref, more };
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
