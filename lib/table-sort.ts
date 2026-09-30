export type SortDirection = "asc" | "desc";
export type SortValueType = "string" | "number" | "date" | "status";

export type SortState = {
  key: string | null;
  dir: SortDirection;
};

/** Toggle asc↔desc on same column; new column starts with defaultDir. */
export function toggleSortState(
  prev: SortState,
  nextKey: string,
  defaultDir: SortDirection = "asc",
): SortState {
  if (prev.key === nextKey) {
    return { key: nextKey, dir: prev.dir === "asc" ? "desc" : "asc" };
  }
  return { key: nextKey, dir: defaultDir };
}

function isEmpty(v: unknown): boolean {
  return v == null || v === "" || (typeof v === "number" && Number.isNaN(v));
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toTime(v: unknown): number | null {
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function toText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** Compare two cell values. Empty values always sort last (both directions). */
export function compareSortValues(
  a: unknown,
  b: unknown,
  type: SortValueType = "string",
): number {
  const aEmpty = isEmpty(a);
  const bEmpty = isEmpty(b);
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  if (type === "number") {
    const an = toNumber(a);
    const bn = toNumber(b);
    if (an == null && bn == null) return toText(a).localeCompare(toText(b), "ru", { sensitivity: "base", numeric: true });
    if (an == null) return 1;
    if (bn == null) return -1;
    return an - bn;
  }

  if (type === "date") {
    const at = toTime(a);
    const bt = toTime(b);
    if (at == null && bt == null) return 0;
    if (at == null) return 1;
    if (bt == null) return -1;
    return at - bt;
  }

  // string + status (labels / codes)
  return toText(a).localeCompare(toText(b), "ru", {
    sensitivity: "base",
    numeric: true,
  });
}

export function sortRows<T>(
  rows: readonly T[],
  state: SortState,
  getValue: (row: T, key: string) => unknown,
  getType?: (key: string) => SortValueType,
): T[] {
  if (!state.key) return [...rows];
  const key = state.key;
  const type = getType?.(key) ?? "string";
  const mul = state.dir === "asc" ? 1 : -1;
  return [...rows].sort((ra, rb) => {
    const va = getValue(ra, key);
    const vb = getValue(rb, key);
    const aEmpty = isEmpty(va);
    const bEmpty = isEmpty(vb);
    // Empty values stay at the end regardless of direction.
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    return compareSortValues(va, vb, type) * mul;
  });
}

export function defaultDirForType(type: SortValueType): SortDirection {
  return type === "date" || type === "number" ? "desc" : "asc";
}
