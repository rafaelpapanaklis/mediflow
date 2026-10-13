"use client";

// Píxel de TikTok (ws1-t5). No pinta nada. Carga el SDK DESPUÉS de lo principal
// (idle o a los 4 s, lo que llegue primero) y solo en rutas públicas
// (isPrivatePath); en el panel y en /paciente nunca se define ttq. El page() lo
// manda el propio arranque; las navegaciones internas mandan otro por ruta,
// igual que MetaPixelPageview.

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isPrivatePath } from "@/lib/analytics/ga4";
import { cargarPixelTiktok } from "@/lib/analytics/tiktok-events";

type PageFn = () => void;

export function TiktokPixel() {
  const pathname = usePathname();
  const arrancado = useRef(false);

  useEffect(() => {
    if (!pathname || isPrivatePath(pathname)) return;

    if (arrancado.current) {
      // navegación interna: un page() por ruta (el del arranque ya contó la primera)
      try {
        (window as unknown as { ttq?: { page?: PageFn } }).ttq?.page?.();
      } catch { /* medir nunca rompe nada */ }
      return;
    }

    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const arrancar = () => {
      if (arrancado.current) return;
      arrancado.current = cargarPixelTiktok();
    };
    let idleId: number | undefined;
    let timer: number | undefined;
    if (typeof w.requestIdleCallback === "function") {
      idleId = w.requestIdleCallback(arrancar, { timeout: 4000 });
    } else {
      timer = window.setTimeout(arrancar, 3000);
    }
    return () => {
      if (idleId !== undefined) w.cancelIdleCallback?.(idleId);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pathname]);

  return null;
}

export default TiktokPixel;
