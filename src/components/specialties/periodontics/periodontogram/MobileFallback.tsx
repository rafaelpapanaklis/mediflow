"use client";
// Periodontics — banner mobile (read-only): debajo de 1024px no permitimos
// captura del periodontograma. Solo lectura. SPEC §1, §11 ("Mobile cap").

import { useEffect, useState } from "react";

const BREAKPOINT_PX = 1024;

export function useIsMobilePerio(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${BREAKPOINT_PX - 1}px)`);
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

export function MobileFallbackBanner() {
  return (
    <div
      role="status"
      style={{
        margin: "12px 0",
        padding: "12px 14px",
        borderRadius: 8,
        background: "var(--warning-soft, rgba(234,179,8,0.12))",
        border: "1px solid var(--warning, #eab308)",
        color: "var(--text-1, #e5e7eb)",
        fontSize: 13,
        textAlign: "center",
      }}
    >
      Para captura, abre desde tablet o escritorio. En mobile el periodontograma
      es solo lectura.
    </div>
  );
}
