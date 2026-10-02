'use client';

import { useLayoutEffect, useRef, useState } from 'react';

type Props = {
  text: string;
  /** Raw server string (VK code) — tooltip only, never the visible text. */
  title?: string;
  className?: string;
};

/**
 * Reasons and errors: two lines, then a tap expands the rest (panel fix 4 — no single-line ellipsis).
 * A real button only when the text is actually clamped, so short reasons stay plain text.
 */
export function VkClampText({ text, title, className = '' }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open, clamped]);

  if (!text) return null;
  const cls = `vk-clamp ${open ? 'is-open' : ''} ${className}`;
  if (!clamped && !open) {
    return (
      <span className={cls} title={title || undefined}>
        <span ref={ref} className="vk-clamp-body">{text}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`${cls} is-toggle`}
      aria-expanded={open}
      title={title || undefined}
      onClick={() => setOpen((v) => !v)}
    >
      <span ref={ref} className="vk-clamp-body">{text}</span>
      <span className="vk-clamp-more">{open ? 'свернуть' : 'полностью'}</span>
    </button>
  );
}
