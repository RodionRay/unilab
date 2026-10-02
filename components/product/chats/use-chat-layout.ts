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
