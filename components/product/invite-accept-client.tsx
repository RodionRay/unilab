'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  CRM_ACCESS_LABELS,
  STAFF_ROLE_LABELS,
  type CrmAccess,
  type StaffRole,
} from '@/lib/staff-types';

type InviteInfo = {
  role: StaffRole;
  access: CrmAccess;
  expiresAt: string;
  ownerName: string;
};

export function InviteAcceptClient() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = String(params?.token || '');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [me, setMe] = useState<{ userId: string; email: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/staff?token=${encodeURIComponent(token)}`, {
          cache: 'no-store',
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Не удалось загрузить приглашение');
        if (!cancelled) {
          setInvite(data.invite);
          setMe(data.me || null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const accept = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept_invite', token }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Не удалось принять приглашение');
      router.replace('/app');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const returnTo = `/invite/${token}`;

  return (
    <main className="login-shell">
      <div className="login-card" style={{ maxWidth: 480 }}>
        <div className="login-brand">
          <strong>UniLab</strong>
          <span>Приглашение в команду</span>
        </div>
        {loading ? (
          <p className="muted">Загрузка…</p>
        ) : error && !invite ? (
          <div className="space-y-4">
            <p className="text-sm" role="alert">
              {error}
            </p>
            <Link href="/login" className="text-link">
              Войти в кабинет
            </Link>
          </div>
        ) : invite ? (
          <div className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold">Вас пригласили в кабинет</h1>
              <p className="muted mt-2">
                {invite.ownerName} · роль «{STAFF_ROLE_LABELS[invite.role]}»
              </p>
              <p className="small-note mt-1">
                Ссылка до{' '}
                {new Date(invite.expiresAt).toLocaleString('ru-RU', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            <div className="staff-invite-access">
              <p className="text-sm font-medium mb-2">Доступы к CRM</p>
              <ul>
                {Object.entries(invite.access)
                  .filter(([k, v]) => k !== 'staff' && v)
                  .map(([k]) => (
                    <li key={k}>{CRM_ACCESS_LABELS[k as keyof typeof CRM_ACCESS_LABELS] || k}</li>
                  ))}
              </ul>
            </div>
            {error && (
              <p className="text-sm" role="alert" style={{ color: 'var(--spike-error)' }}>
                {error}
              </p>
            )}
            {me ? (
              <div className="space-y-3">
                <p className="small-note">
                  Вы вошли как {me.name || me.email}. После принятия откроется общий кабинет владельца.
                </p>
                <Button className="w-full" disabled={busy} onClick={() => void accept()}>
                  {busy ? 'Подключаем…' : 'Принять приглашение'}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="small-note">
                  Войдите или зарегистрируйтесь, чтобы присоединиться к кабинету.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/login?return_to=${encodeURIComponent(returnTo)}`}
                    className="us-btn us-btn-primary"
                    style={{ textDecoration: 'none' }}
                  >
                    Войти
                  </Link>
                  <Link
                    href={`/register?return_to=${encodeURIComponent(returnTo)}`}
                    className="us-btn us-btn-secondary"
                    style={{ textDecoration: 'none' }}
                  >
                    Регистрация
                  </Link>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
