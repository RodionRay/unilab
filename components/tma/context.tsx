"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TmaApiError, type TmaClient } from "@/lib/tma/client";
import type { SessionResponse } from "@/lib/tma/contract";
import type { TgWebApp } from "@/components/tma/telegram";

export type TmaSession = {
  client: TmaClient;
  app: TgWebApp | null;
  me: SessionResponse["me"];
  workspace: SessionResponse["workspace"];
  /** Session-level failure (expired bearer) — the shell swaps to the gate screen. */
  onFatal(error: TmaApiError): void;
};

const TmaSessionContext = createContext<TmaSession | null>(null);
export const TmaSessionProvider = TmaSessionContext.Provider;

export function useTmaSession(): TmaSession {
  const ctx = useContext(TmaSessionContext);
  if (!ctx) throw new Error("useTmaSession outside TmaSessionProvider");
  return ctx;
}

export function toApiError(e: unknown): TmaApiError {
  return e instanceof TmaApiError ? e : new TmaApiError("Что-то пошло не так", "http", 0);
}

type FeedState<T> =
  | { key: string; status: "ready"; data: T }
  | { key: string; status: "error"; error: TmaApiError };

export type FeedResult<T> = {
  /** "loading" only when there is nothing to show yet; refreshes keep the previous data. */
  status: "loading" | "ready" | "error";
  data: T | null;
  error: TmaApiError | null;
  refreshing: boolean;
  /** A failed refresh while data is shown: the data stays, this carries the reason. */
  refreshError: TmaApiError | null;
  reload(): Promise<void>;
};

/**
 * Loads one feed projection. `key` identifies the request; when it changes the
 * hook shows "loading" until the new answer arrives. Session expiry is escalated
 * to the shell instead of being shown inline.
 */
export function useFeedQuery<T>(key: string, load: () => Promise<T>): FeedResult<T> {
  const { onFatal } = useTmaSession();
  const [state, setState] = useState<FeedState<T> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<TmaApiError | null>(null);
  const loadRef = useRef(load);
  const stateRef = useRef(state);
  useEffect(() => {
    loadRef.current = load;
    stateRef.current = state;
  });

  const run = useCallback(
    async (runKey: string, isAlive: () => boolean) => {
      try {
        const data = await loadRef.current();
        if (!isAlive()) return;
        setState({ key: runKey, status: "ready", data });
        setRefreshError(null);
      } catch (e) {
        const err = toApiError(e);
        if (err.code === "session_expired") onFatal(err);
        if (!isAlive()) return;
        const prev = stateRef.current;
        if (prev && prev.key === runKey && prev.status === "ready") setRefreshError(err);
        else setState({ key: runKey, status: "error", error: err });
      }
    },
    [onFatal],
  );

  useEffect(() => {
    let alive = true;
    void run(key, () => alive);
    return () => {
      alive = false;
    };
  }, [key, run]);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      await run(key, () => true);
    } finally {
      setRefreshing(false);
    }
  }, [key, run]);

  const current = state && state.key === key ? state : null;
  const base = { refreshing, refreshError, reload };
  if (!current) return { ...base, status: "loading", data: null, error: null };
  if (current.status === "error") return { ...base, status: "error", data: null, error: current.error };
  return { ...base, status: "ready", data: current.data, error: null };
}

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}
