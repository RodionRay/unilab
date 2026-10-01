/**
 * Группа закреплена за аккаунтом, который в неё вступил (или подал заявку): сканирует только участник,
 * поэтому `assign_group_accounts` такие группы пропускает, а окно выбора не даёт сменить аккаунт.
 */
export type GroupMembershipState = {
  membership?: unknown;
  status?: unknown;
  joinedAt?: unknown;
};

export function groupAccountLocked(d: GroupMembershipState | null | undefined): boolean {
  return d?.membership === 'joined' || d?.membership === 'pending' || d?.status === 'pending' || !!d?.joinedAt;
}

export type AssignOutcome = { updated?: unknown; skipped?: unknown };

/** Тост по фактическому ответу `assign_group_accounts`, а не по факту успешного запроса. */
export function assignOutcomeNotice(r: AssignOutcome): { ok: boolean; text: string } {
  const updated = Number(r.updated) || 0;
  const skipped = Number(r.skipped) || 0;
  if (!updated && skipped) {
    return { ok: false, text: 'Аккаунт не сменён: группа уже вступлена другим аккаунтом — сканирует только он' };
  }
  if (!updated) return { ok: false, text: 'Аккаунт не сменён: группа не найдена' };
  return { ok: true, text: 'Аккаунт назначен' };
}
