"use client";

// Píxel de TikTok (ws1-t5). No pinta nada. Carga el SDK DESPUÉS de lo principal
// (idle o a los 4 s, lo que llegue primero) y SOLO en páginas de DaleControl
// (esPaginaDaleControl): ni en el panel ni en /paciente ni en las páginas
// públicas de las clínicas (/[slug], /reservar/*). El page() lo
// manda el propio arranque; las navegaciones internas mandan otro por ruta,
// igual que MetaPixelPageview.

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isPrivatePath } from "@/lib/analytics/ga4";
import { cargarPixelTiktok } from "@/lib/analytics/tiktok-events";
import { esPaginaDaleControl } from "@/lib/analytics/tiktok-pixel";
import { registrarDestinosEmbudo } from "@/lib/analytics/tiktok-embudo";

type PageFn = () => void;

export function TiktokPixel() {
  const pathname = usePathname();
  const arrancado = useRef(false);

  // Destinos del embudo (TikTok ViewContent/ClickButton, Lead de Meta, Ads
  // «Clic en WhatsApp»): una vez por carga, en todas las rutas; cada destino
  // revisa por su cuenta que la página sea pública / de DaleControl.
  useEffect(() => {
    registrarDestinosEmbudo();
  }, []);

  useEffect(() => {
    // Solo páginas de DaleControl: nunca /[slug] de clínicas ni /reservar/*.
    if (!pathname || isPrivatePath(pathname) || !esPaginaDaleControl(pathname)) return;

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
