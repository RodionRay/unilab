'use client';
import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { toast } from '@/lib/workspace-notifications';
import { errorMessage, workspaceAction } from './api';
import { pluralRu, type ProjectRecord } from './model';

type Props = {
  project: ProjectRecord | null;
  projects: readonly ProjectRecord[];
  groupCount: number;
  onClose: () => void;
  onDeleted: (moveToProjectId: string) => Promise<void> | void;
};

/** Delete needs a target project when the project still owns chats (spec REQ-1). */
export function DeleteProjectDialog({ project, projects, groupCount, onClose, onDeleted }: Props) {
  const others = projects.filter((p) => p.id !== project?.id);
  const [picked, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const selectId = useId();
  const target = others.some((p) => p.id === picked) ? picked : (others[0]?.id ?? '');

  const needsMove = groupCount > 0;
  const blocked = needsMove && !others.length;

  async function confirm() {
    if (!project) return;
    setBusy(true);
    try {
      await workspaceAction({ action: 'project_delete', id: project.id, ...(needsMove ? { moveToProjectId: target } : {}) });
      toast.success(`Проект «${project.data.name}» удалён`);
      onClose();
      await onDeleted(needsMove ? target : '');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const chats = `${groupCount} ${pluralRu(groupCount, 'чат', 'чата', 'чатов')}`;
  return (
    <Dialog open={!!project} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Удалить проект «{project?.data.name}»?</DialogTitle>
          <DialogDescription>
            {blocked
              ? `К проекту привязано ${chats}. Это единственный проект — создайте ещё один, чтобы было куда перенести чаты.`
              : needsMove
                ? `К проекту привязано ${chats}. Они и их лиды перейдут в выбранный проект. Карточку и примеры восстановить не получится.`
                : 'Карточку и примеры восстановить не получится. Чатов у проекта нет.'}
          </DialogDescription>
        </DialogHeader>
        {needsMove && !blocked && (
          <div className="aiw-field">
            <label className="aiw-label" htmlFor={selectId}>Куда перенести чаты</label>
            <NativeSelect id={selectId} className="w-full" value={target} onChange={(e) => setTarget(e.target.value)}>
              {others.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.data.name}</NativeSelectOption>)}
            </NativeSelect>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>Оставить проект</Button>
          <Button variant="destructive" disabled={busy || blocked || (needsMove && !target)} onClick={() => void confirm()}>
            {busy && <Loader2 size={15} className="animate-spin" />}Удалить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
