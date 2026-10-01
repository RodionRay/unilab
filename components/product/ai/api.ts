/** POST `/api/workspace` action; same error shape as `app/app/page.tsx::api` (message + status + data). */
export type ActionError = Error & { status?: number; data?: Record<string, unknown> };

export async function workspaceAction<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch('/api/workspace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await r.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }
  if (!r.ok) {
    const err = new Error(typeof data.error === 'string' ? data.error : 'Ошибка соединения') as ActionError;
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : 'Неизвестная ошибка');
