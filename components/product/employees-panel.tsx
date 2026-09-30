'use client';

import { useMemo, useState } from 'react';
import {
  Copy,
  Link2,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CRM_ACCESS_KEYS,
  CRM_ACCESS_LABELS,
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  accessForRole,
  type CrmAccess,
  type CrmAccessKey,
  type StaffRole,
  type WorkspaceInvite,
  type WorkspaceMember,
} from '@/lib/staff-types';

type Props = {
  members: WorkspaceMember[];
  invites: WorkspaceInvite[];
  busy?: boolean;
  onCreateInvite: (input: {
    role: StaffRole;
    access: CrmAccess;
    days: number;
  }) => Promise<string | null>;
  onRevokeInvite: (id: string) => void;
  onRevokeInvites: (ids: string[]) => void;
  onUpdateMember: (input: {
    id: string;
    role: StaffRole;
    access: CrmAccess;
  }) => void;
  onRemoveMember: (id: string) => void;
  onRemoveMembers: (ids: string[]) => void;
  onClearAll: () => void;
};

function AccessGrid({
  access,
  onChange,
}: {
  access: CrmAccess;
  onChange: (next: CrmAccess) => void;
}) {
  return (
    <div className="staff-access-grid">
      {CRM_ACCESS_KEYS.filter((k) => k !== 'staff').map((key) => (
        <label key={key} className="staff-access-item">
          <Checkbox
            checked={!!access[key]}
            onCheckedChange={(v) =>
              onChange({ ...access, [key]: v === true, staff: false })
            }
          />
          <span>{CRM_ACCESS_LABELS[key]}</span>
        </label>
      ))}
    </div>
  );
}

function accessSummary(access: CrmAccess) {
  const on = CRM_ACCESS_KEYS.filter((k) => k !== 'staff' && access[k]);
  if (on.length >= CRM_ACCESS_KEYS.length - 1) return 'Полный доступ к CRM';
  if (!on.length) return 'Без доступов';
  return (
    on
      .slice(0, 4)
      .map((k) => CRM_ACCESS_LABELS[k as CrmAccessKey])
      .join(', ') + (on.length > 4 ? ` +${on.length - 4}` : '')
  );
}

export function EmployeesPanel({
  members,
  invites,
  busy,
  onCreateInvite,
  onRevokeInvite,
  onRevokeInvites,
  onUpdateMember,
  onRemoveMember,
  onRemoveMembers,
  onClearAll,
}: Props) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editMember, setEditMember] = useState<WorkspaceMember | null>(null);
  const [role, setRole] = useState<StaffRole>('manager');
  const [access, setAccess] = useState<CrmAccess>(() => accessForRole('manager'));
  const [days, setDays] = useState('7');
  const [createdUrl, setCreatedUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [selectedInvites, setSelectedInvites] = useState<string[]>([]);

  const openInvite = () => {
    setRole('manager');
    setAccess(accessForRole('manager'));
    setDays('7');
    setCreatedUrl('');
    setCopied(false);
    setInviteOpen(true);
  };

  const openEdit = (m: WorkspaceMember) => {
    setEditMember(m);
    setRole(m.role);
    setAccess({ ...m.access, staff: false });
  };

  const pending = useMemo(() => invites, [invites]);
  const allMembersSelected =
    members.length > 0 && selectedMembers.length === members.length;
  const allInvitesSelected =
    pending.length > 0 && selectedInvites.length === pending.length;

  const toggleMember = (id: string, on: boolean) => {
    setSelectedMembers((prev) =>
      on ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id),
    );
  };

  const toggleInvite = (id: string, on: boolean) => {
    setSelectedInvites((prev) =>
      on ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id),
    );
  };

  return (
    <div className="task-module">
      <div className="toolbar">
        <div className="relative w-full sm:w-80">
          <Users className="absolute left-3 top-2.5 text-[var(--spike-muted)]" size={16} />
          <Input
            className="pl-9"
            readOnly
            value={`${members.length} сотрудников · ${pending.length} приглашений`}
            aria-label="Сводка по сотрудникам"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedMembers.length > 0 && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                onRemoveMembers(selectedMembers);
                setSelectedMembers([]);
              }}
            >
              <Trash2 size={15} />
              Удалить выбранных ({selectedMembers.length})
            </Button>
          )}
          {(members.length > 0 || pending.length > 0) && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (
                  !confirm(
                    'Удалить всех сотрудников и активные приглашения? Это действие нельзя отменить.',
                  )
                )
                  return;
                onClearAll();
                setSelectedMembers([]);
                setSelectedInvites([]);
              }}
            >
              <Trash2 size={15} />
              Удалить всех
            </Button>
          )}
          <Button onClick={openInvite} disabled={busy}>
            <Plus size={16} />
            Пригласить по ссылке
          </Button>
        </div>
      </div>

      <div className="panel">
        <div className="mb-4">
          <h3 className="text-base font-semibold">Команда</h3>
          <p className="small-note mt-1">
            Роли и доступы к разделам CRM. Владелец кабинета всегда с полными правами и в списке не
            показывается.
          </p>
        </div>
        {members.length === 0 ? (
          <div className="empty-panel">
            <div className="icon-box mx-auto mb-3">
              <UserPlus size={22} />
            </div>
            <p className="font-semibold">Пока нет сотрудников</p>
            <p className="small-note mt-1">
              Создайте ссылку-приглашение и отправьте коллеге. После входа он попадёт в ваш кабинет.
            </p>
            <Button className="mt-4" onClick={openInvite} disabled={busy}>
              <Link2 size={15} />
              Создать ссылку
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allMembersSelected}
                    onCheckedChange={(v) =>
                      setSelectedMembers(v === true ? members.map((m) => m.id) : [])
                    }
                    aria-label="Выбрать всех сотрудников"
                  />
                </TableHead>
                <TableHead>Сотрудник</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead>Доступы CRM</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedMembers.includes(m.id)}
                      onCheckedChange={(v) => toggleMember(m.id, v === true)}
                      aria-label={`Выбрать ${m.name || m.email || m.id}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <strong className="block truncate">{m.name || 'Без имени'}</strong>
                      <span className="small-note truncate block">{m.email || m.userId}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="badge">{STAFF_ROLE_LABELS[m.role]}</span>
                  </TableCell>
                  <TableCell>
                    <span className="small-note">{accessSummary(m.access)}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(m)}
                        aria-label="Изменить"
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          onRemoveMember(m.id);
                          setSelectedMembers((prev) => prev.filter((id) => id !== m.id));
                        }}
                        aria-label="Удалить"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {pending.length > 0 && (
        <div className="panel mt-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">Ожидают перехода по ссылке</h3>
              <p className="small-note mt-1">
                Ссылку можно скопировать повторно, пока приглашение активно.
              </p>
            </div>
            {selectedInvites.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  onRevokeInvites(selectedInvites);
                  setSelectedInvites([]);
                }}
              >
                <Trash2 size={14} />
                Отозвать выбранные ({selectedInvites.length})
              </Button>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allInvitesSelected}
                    onCheckedChange={(v) =>
                      setSelectedInvites(v === true ? pending.map((i) => i.id) : [])
                    }
                    aria-label="Выбрать все приглашения"
                  />
                </TableHead>
                <TableHead>Роль</TableHead>
                <TableHead>Доступы</TableHead>
                <TableHead>Действует до</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((inv) => {
                const url =
                  typeof window !== 'undefined'
                    ? `${window.location.origin}/invite/${inv.token}`
                    : `/invite/${inv.token}`;
                return (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedInvites.includes(inv.id)}
                        onCheckedChange={(v) => toggleInvite(inv.id, v === true)}
                        aria-label="Выбрать приглашение"
                      />
                    </TableCell>
                    <TableCell>
                      <span className="badge warning">{STAFF_ROLE_LABELS[inv.role]}</span>
                    </TableCell>
                    <TableCell>
                      <span className="small-note">{accessSummary(inv.access)}</span>
                    </TableCell>
                    <TableCell className="small-note whitespace-nowrap">
                      {new Date(inv.expiresAt).toLocaleString('ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(url);
                            } catch {
                              /* */
                            }
                          }}
                        >
                          <Copy size={14} />
                          Копировать
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            onRevokeInvite(inv.id);
                            setSelectedInvites((prev) => prev.filter((id) => id !== inv.id));
                          }}
                          aria-label="Отозвать"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Приглашение сотрудника</DialogTitle>
            <DialogDescription>
              Выберите роль и доступы к CRM — коллега перейдёт по ссылке, войдёт или
              зарегистрируется и попадёт в ваш кабинет.
            </DialogDescription>
          </DialogHeader>
          {createdUrl ? (
            <div className="space-y-3">
              <p className="text-sm">Ссылка готова. Отправьте её сотруднику:</p>
              <div className="flex gap-2">
                <Input readOnly value={createdUrl} />
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(createdUrl);
                      setCopied(true);
                    } catch {
                      /* */
                    }
                  }}
                >
                  <Copy size={15} />
                  {copied ? 'Скопировано' : 'Копировать'}
                </Button>
              </div>
              <Button className="w-full" onClick={() => setInviteOpen(false)}>
                Готово
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Роль</label>
                <Select
                  value={role}
                  onValueChange={(v) => {
                    const next = v as StaffRole;
                    setRole(next);
                    setAccess(accessForRole(next));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAFF_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {STAFF_ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Срок ссылки (дней)</label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Доступы к CRM</label>
                <AccessGrid access={access} onChange={setAccess} />
              </div>
              <Button
                className="w-full"
                disabled={busy}
                onClick={async () => {
                  const url = await onCreateInvite({
                    role,
                    access,
                    days: Math.min(30, Math.max(1, Number(days) || 7)),
                  });
                  if (url) {
                    setCreatedUrl(url);
                    setCopied(false);
                  }
                }}
              >
                <Link2 size={15} />
                Создать ссылку
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editMember} onOpenChange={(o) => !o && setEditMember(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Доступы сотрудника</DialogTitle>
            <DialogDescription>
              {editMember?.name || editMember?.email || 'Сотрудник'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Роль</label>
              <Select
                value={role}
                onValueChange={(v) => {
                  const next = v as StaffRole;
                  setRole(next);
                  setAccess(accessForRole(next));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAFF_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {STAFF_ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <AccessGrid access={access} onChange={setAccess} />
            <Button
              className="w-full"
              disabled={busy || !editMember}
              onClick={() => {
                if (!editMember) return;
                onUpdateMember({ id: editMember.id, role, access });
                setEditMember(null);
              }}
            >
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
