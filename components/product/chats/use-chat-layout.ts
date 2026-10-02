"use client";

import { useEffect, useState, type RefObject } from "react";

/** Below this panel width the chats run as one column (list → chat with back); matches the CSS container query. */
export const NARROW_PANEL_PX = 700;
/** Below this viewport width the open chat is fixed full-screen over the app chrome (CSS media query). */
const FULL_SCREEN_QUERY = "(max-width: 767px)";

export function useNarrowPanel(ref: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setNarrow(entry.contentRect.width < NARROW_PANEL_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return narrow;
}

/** Toasts keep announcing while the chat covers the page. */
const KEEP_LIVE = "[data-sonner-toaster], section[aria-label^='Notifications']";

/**
 * While the chat covers the whole phone screen, everything outside it is made `inert` (no Tab into the hidden top
 * bar, no screen-reader leaks). Siblings of each ancestor are marked and restored on close.
 */
export function useFullScreenChat(paneRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const pane = paneRef.current;
    if (!active || !pane || !window.matchMedia(FULL_SCREEN_QUERY).matches) return;
    const marked: HTMLElement[] = [];
    for (let node: HTMLElement | null = pane; node && node !== document.body; node = node.parentElement) {
      const parent: HTMLElement | null = node.parentElement;
      if (!parent) break;
      for (const sib of Array.from(parent.children)) {
        if (sib === node || !(sib instanceof HTMLElement) || sib.inert) continue;
        if (sib.matches(KEEP_LIVE) || sib.querySelector(KEEP_LIVE)) continue;
        sib.inert = true;
        marked.push(sib);
      }
    }
    return () => marked.forEach((el) => (el.inert = false));
  }, [paneRef, active]);
}

/**
 * While a chat is open, toasts sit at the top of the thread pane (under its header, centred), never over the newest
 * messages or the composer. Publishes the anchor as CSS vars on <html>; app/globals.css positions Sonner with them.
 */
export function usePaneToastAnchor(paneRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const pane = paneRef.current;
    if (!active || !pane) return;
    const root = document.documentElement;
    const place = () => {
      const rect = pane.getBoundingClientRect();
      const header = pane.querySelector(".chat-header")?.getBoundingClientRect();
      root.style.setProperty("--chat-toast-x", `${Math.round(rect.left + rect.width / 2)}px`);
      root.style.setProperty("--chat-toast-top", `${Math.round((header?.bottom ?? rect.top) + 12)}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(pane);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      root.style.removeProperty("--chat-toast-x");
      root.style.removeProperty("--chat-toast-top");
    };
  }, [paneRef, active]);
}
