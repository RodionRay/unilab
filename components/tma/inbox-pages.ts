/**
 * Inbox load-more joins keyset pages whose order is live (prio flips when a lead is viewed or gets a reply),
 * so a later page may repeat a lead already shown. The first occurrence wins; React keys stay unique.
 */
export function uniqueById<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}
