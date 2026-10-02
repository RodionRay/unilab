"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Chat surface palette (dark matches the app; light follows Telegram Desktop). Persisted per browser. */
export type ChatTheme = "dark" | "light";
export const CHAT_THEME_KEY = "unilab.chatTheme";
const EVENT = "unilab:chat-theme";

function read(): ChatTheme {
  try {
    return localStorage.getItem(CHAT_THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

export function useChatTheme(): [ChatTheme, (next: ChatTheme) => void] {
  const theme = useSyncExternalStore(subscribe, read, () => "dark" as const);
  const set = useCallback((next: ChatTheme) => {
    try {
      localStorage.setItem(CHAT_THEME_KEY, next);
    } catch {
      // storage blocked (private mode): nothing to persist, the chat stays on the default dark palette
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [theme, set];
}
