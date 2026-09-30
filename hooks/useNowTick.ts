"use client";

import { useEffect, useState } from "react";

/** Тик раз в секунду — живые часы и обратный отсчёт паузы. */
export function useNowTick(enabled = true, ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [enabled, ms]);
  return now;
}
