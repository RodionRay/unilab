/** Order of source scans inside one auto-rescan tick (app/api/cron/auto-rescan/route.ts::tickOwner). */

export type ScanItem = { kind: "group" | "vk"; id: string };

/** AM-12: Telegram groups and VK sources alternate, so neither platform starves the other. */
export function interleaveScans(groupIds: readonly string[], vkSourceIds: readonly string[]): ScanItem[] {
  const out: ScanItem[] = [];
  for (let i = 0; i < Math.max(groupIds.length, vkSourceIds.length); i++) {
    if (i < groupIds.length) out.push({ kind: "group", id: groupIds[i] });
    if (i < vkSourceIds.length) out.push({ kind: "vk", id: vkSourceIds[i] });
  }
  return out;
}
