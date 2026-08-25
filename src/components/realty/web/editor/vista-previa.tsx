"use client";

/* ═══════════════════════════════════════════════════════════════════════
   VISTA PREVIA EN VIVO — SIN IFRAME, SIN postMessage, SIN debounce.

   Los bloques de la web pública son componentes PUROS: reciben un objeto y
   ya. Eso permite pintar EXACTAMENTE el mismo árbol aquí, en el navegador,
   que el que el servidor pinta en /i/[slug]. No hay canal que sincronizar
   ni allowlist de campos que mantener: lo que se ve es lo que se publica,
   por construcción y no por disciplina.

   El marco se ESCALA con transform en vez de recortar: a 390 px de ancho
   la plantilla se pinta a 390 px de verdad (con sus @container resueltos a
   móvil) y se encoge para caber en la columna. Con un simple `width` la
   plantilla creería que está en escritorio y la vista previa "móvil"
   mentiría.

   ⚠️ El ResizeObserver se vuelve a montar cuando cambia `modo` a propósito:
   una pestaña oculta no entrega avisos y al volver el marco tendría la
   medida vieja.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from "react";
import type { RealtyWebData } from "@/lib/realty/landing";
import { PlantillaRealtyWeb } from "@/components/realty/web";
import { LimiteVistaPrevia } from "@/components/realty/web/editor/limite-error";

export type ModoVista = "movil" | "escritorio";

const ANCHO: Record<ModoVista, number> = { movil: 390, escritorio: 1280 };

export function VistaPrevia({ data, modo }: { data: RealtyWebData; modo: ModoVista }) {
  const marco = useRef<HTMLDivElement>(null);
  const [caja, setCaja] = useState({ ancho: 0, alto: 0 });

  useEffect(() => {
    const el = marco.current;
    if (!el) return;
    const medir = () => setCaja({ ancho: el.clientWidth, alto: el.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    window.addEventListener("resize", medir);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", medir);
    };
  }, [modo]);

  const base = ANCHO[modo];
  // Nunca AMPLÍA: en una pantalla ancha, la vista móvil se ve a tamaño real
  // y no como un póster.
  const escala = caja.ancho > 0 ? Math.min(1, caja.ancho / base) : 1;
  const alto = escala > 0 ? caja.alto / escala : caja.alto;

  return (
    <div ref={marco} className="dcrwe-previa" data-modo={modo}>
      <div
        className="dcrwe-previa-lienzo"
        style={{
          width: base,
          height: alto || undefined,
          transform: `scale(${escala})`,
          transformOrigin: "top left",
        }}
      >
        <LimiteVistaPrevia reintentarCon={data}>
          <PlantillaRealtyWeb data={data} />
        </LimiteVistaPrevia>
      </div>
    </div>
  );
}
