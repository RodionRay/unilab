"use client";

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
} from "react";

export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current?.closest(".us-landing") as HTMLElement | null;
    if (!root) return;
    const onMove = (e: PointerEvent) => {
      root.style.setProperty("--hx", `${e.clientX}px`);
      root.style.setProperty("--hy", `${e.clientY}px`);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return <div ref={ref} className="us-cursor-glow" aria-hidden />;
}

export function MagicCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`us-magic ${className}`.trim()}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
    >
      {children}
    </div>
  );
}

export function BorderGlow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="us-beam">
      <span className="us-beam-spin" aria-hidden />
      <div className={`us-beam-inner ${className}`.trim()}>{children}</div>
    </div>
  );
}

export function Marquee({
  items,
  reverse = false,
}: {
  items: string[];
  reverse?: boolean;
}) {
  const row = [...items, ...items];
  return (
    <div className="us-marquee" data-reverse={reverse || undefined}>
      <div className="us-marquee-track">
        {row.map((item, i) => (
          <span key={`${item}-${i}`}>{item}</span>
        ))}
      </div>
    </div>
  );
}

export function Ripple() {
  return (
    <div className="us-ripple" aria-hidden>
      <span />
      <span />
      <span />
    </div>
  );
}

export function Orbit() {
  return (
    <div className="us-orbit" aria-hidden>
      <i style={{ "--i": 0 } as CSSProperties} />
      <i style={{ "--i": 1 } as CSSProperties} />
      <i style={{ "--i": 2 } as CSSProperties} />
    </div>
  );
}
