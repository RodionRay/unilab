"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  defaultDirForType,
  sortRows,
  toggleSortState,
  type SortDirection,
  type SortState,
  type SortValueType,
} from "@/lib/table-sort";

type Options = {
  defaultKey?: string | null;
  defaultDir?: SortDirection;
  types?: Record<string, SortValueType>;
  /** When this changes, sort state resets to defaults. */
  resetKey?: string | number;
};

export function useTableSort<T>(
  rows: readonly T[],
  getValue: (row: T, key: string) => unknown,
  options?: Options,
) {
  const defaultKey = options?.defaultKey ?? null;
  const types = options?.types;
  const initialDir =
    options?.defaultDir ??
    (defaultKey && types?.[defaultKey]
      ? defaultDirForType(types[defaultKey])
      : "asc");

  const [state, setState] = useState<SortState>({
    key: defaultKey,
    dir: initialDir,
  });

  useEffect(() => {
    if (options?.resetKey === undefined) return;
    setState({
      key: defaultKey,
      dir:
        options?.defaultDir ??
        (defaultKey && types?.[defaultKey]
          ? defaultDirForType(types[defaultKey])
          : "asc"),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when resetKey changes
  }, [options?.resetKey]);

  const onSort = useCallback(
    (key: string) => {
      const type = types?.[key] ?? "string";
      const startDir = options?.defaultDir ?? defaultDirForType(type);
      setState((prev) => toggleSortState(prev, key, startDir));
    },
    [options?.defaultDir, types],
  );

  const sorted = useMemo(
    () =>
      sortRows(rows, state, getValue, (key) => types?.[key] ?? "string"),
    [rows, state, getValue, types],
  );

  return {
    sorted,
    sortKey: state.key,
    sortDir: state.dir,
    onSort,
  };
}
