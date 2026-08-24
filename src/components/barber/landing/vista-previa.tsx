"use client";

/* ═══════════════════════════════════════════════════════════════════════
   VISTA PREVIA EN VIVO.

   La misma plantilla que ve el cliente, con los datos que la barbería
   lleva escritos AHORA MISMO, sin guardar nada y sin iframe.

   Se puede porque las ocho plantillas son componentes puros: reciben un
   objeto y no tocan la base ni usan hooks. En el servidor pintan
   /b/[slug]; aquí pintan lo mismo en el navegador. Cero postMessage,
   cero ruta de preview pública, cero riesgo de que la vista previa y la
   página de verdad se separen — son literalmente el mismo componente.

   ── LA ESCALA ─────────────────────────────────────────────────────
   El lienzo se pinta al ANCHO REAL del dispositivo (390 px de celular,
   1280 px de escritorio) y se encoge con `transform: scale()` hasta
   caber en la columna. Así las @container de las plantillas miden el
   ancho de verdad y el "celular" se ve como un celular, no como una
   ventana angosta de escritorio.

   Y el lienzo es el que hace scroll (`overflow-y: auto`), así que es él
   el scrollport: las barras `position: sticky` de las plantillas —la de
   arriba en `clasica`, la de reserva de `portafolio`— se pegan DENTRO
   del marco y no a los bordes de la pantalla del editor.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from "react";
import { PlantillaBarberWeb } from "@/components/barber/templates";
import type { BarberWebData } from "@/components/barber/templates/types";
import { LimiteVistaPrevia } from "./limite-error";
import type { TFn } from "./controles";

export type ModoVista = "movil" | "escritorio";

const ANCHO: Record<ModoVista, number> = { movil: 390, escritorio: 1280 };

export function VistaPrevia({ data, modo, t }: { data: BarberWebData; modo: ModoVista; t: TFn }) {
  const marco = useRef<HTMLDivElement>(null);
  const [caja, setCaja] = useState({ ancho: 0, alto: 0 });

  /**
   * `modo` está en las dependencias A PROPÓSITO.
   *
   * Cambiar de celular a computadora cambia el ancho del marco (en celular
   * lleva un `max-width`), así que hay que volver a medir. Dejarlo solo en
   * manos del ResizeObserver es frágil: el observer entrega sus avisos
   * dentro del ciclo de pintado, y una pestaña que no pinta —oculta, en
   * segundo plano, minimizada— no los entrega NUNCA. Con `modo` en las
   * dependencias, el efecto vuelve a correr después del commit, cuando el
   * DOM ya tiene el `data-modo` nuevo, y `medir()` lee el ancho correcto
   * sin depender de que llegue ningún aviso.
   *
   * El observer se queda para lo que sí es asíncrono: que la columna del
   * editor cambie de ancho al plegarse el sidebar, sin que la ventana se
   * mueva. Y el listener de `resize` cubre el caso de la ventana.
   */
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
  // Nunca se amplía: una plantilla a 1280 px estirada a 1600 se ve borrosa
  // y miente sobre los tamaños de letra.
  const escala = caja.ancho > 0 ? Math.min(1, caja.ancho / base) : 1;
  const alto = escala > 0 ? caja.alto / escala : caja.alto;

  return (
    <div ref={marco} className="dcbwe-marco" data-modo={modo}>
      <div
        className="dcbwe-lienzo"
        style={{
          width: base,
          height: alto || undefined,
          transform: `scale(${escala})`,
          transformOrigin: "top left",
        }}
      >
        {/* El cortafuegos va DENTRO del lienzo y no fuera: un fallo al
            pintar la plantilla deja el marco, la escala y los botones de
            celular/computadora en su sitio, y sólo se sustituye la página
            de la barbería por el aviso. Ver ./limite-error.tsx. */}
        <LimiteVistaPrevia
          reintentarCon={data}
          titulo={t("vistaFalloTitulo")}
          cuerpo={t("vistaFalloCuerpo")}
          detalle={t("vistaFalloDetalle")}
        >
          <PlantillaBarberWeb data={data} />
        </LimiteVistaPrevia>
      </div>
    </div>
  );
}

/**
 * La misma plantilla, en miniatura, para el selector.
 *
 * No es una captura ni un dibujo: es la plantilla de verdad con los datos
 * de verdad, encogida. Por eso el selector nunca puede enseñar algo
 * distinto de lo que sale al elegirla.
 *
 * `aria-hidden` + `inert`: es una imagen a efectos prácticos, y sus
 * enlaces no deben poder recibir el foco con el tabulador desde el
 * editor. El botón de al lado es el control de verdad.
 */
export function MiniaturaPlantilla({ data, t }: { data: BarberWebData; t: TFn }) {
  const ANCHO_MINI = 1100;
  const ESCALA = 0.19;
  return (
    <div className="dcbwe-mini" aria-hidden>
      <div
        className="dcbwe-mini-lienzo"
        style={{
          width: ANCHO_MINI,
          height: 1180,
          transform: `scale(${ESCALA})`,
          transformOrigin: "top left",
        }}
        {...({ inert: "" } as Record<string, string>)}
      >
        {/* Las OCHO miniaturas son ocho plantillas completas montadas a la
            vez: sin cortafuegos, una sola de ellas rota tumbaría el editor
            con sólo abrir el selector. Cada una cae por su cuenta. */}
        <LimiteVistaPrevia reintentarCon={data} titulo={t("miniFallo")} cuerpo="" variante="mini">
          <PlantillaBarberWeb data={data} />
        </LimiteVistaPrevia>
      </div>
    </div>
  );
}
