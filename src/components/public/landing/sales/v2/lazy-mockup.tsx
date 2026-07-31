"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { MOCK_BOX } from "./mock-box";

/**
 * Mockups del panel montados SOLO cuando el usuario se acerca a ellos.
 *
 * POR QUÉ: los 6 mockups de "Funciones" son server components y su DOM completo
 * viajaba en el HTML inicial y ADEMÁS duplicado dentro del payload RSC
 * (self.__next_f), que es más de la mitad del peso del home. Con `ssr: false`
 * desaparecen de los dos sitios y bajan en un chunk aparte al hacer scroll.
 *
 * EL PRISMA DEL HERO NO SE DIFIERE: es el bloque LCP y se queda en SSR.
 *
 * CLS = 0: mientras no está montado, la propia caja (`.dcv2-lazy`) fija el alto
 * EXACTO que ocupará el mockup real — tabla medida en Chrome, `.dcv2-lazy--*`
 * en landing-v2.css. El mismo hueco se reutiliza como `loading` de next/dynamic
 * para que tampoco se colapse entre "empieza el import" y "el chunk ya está".
 * Encima el rootMargin de 400px hace que el montaje ocurra siempre con el
 * mockup fuera de pantalla.
 */

export type LazyMockupName = "agenda" | "pacientes" | "presupuesto" | "cbct" | "importar" | "inbox";

const LAZY: Record<LazyMockupName, ComponentType> = {
  agenda: dynamic(() => import("./mockups").then((m) => m.AgendaMock), { ssr: false }),
  pacientes: dynamic(() => import("./mockups").then((m) => m.PacientesMock), { ssr: false }),
  presupuesto: dynamic(() => import("./mockups").then((m) => m.PresupuestoMock), { ssr: false }),
  cbct: dynamic(() => import("./mockups").then((m) => m.CbctMock), { ssr: false }),
  importar: dynamic(() => import("./mockups").then((m) => m.ImportarMock), { ssr: false }),
  inbox: dynamic(() => import("./mockups").then((m) => m.InboxIaMock), { ssr: false }),
};

/**
 * Caja del mockup.
 *
 * `.dcv2-lazy` es el CONTENEDOR de las container queries; `.dcv2-lazy__h`
 * lleva el `min-height` reservado y envuelve SIEMPRE al mockup (montado o no).
 * Como el alto reservado se redondea hacia ARRIBA, al montar el mockup la caja
 * ya medía lo mismo o más → no se mueve ni un píxel, ni siquiera si el alto
 * real varía un poco con el devicePixelRatio o con el ancho del scrollbar.
 */
export function LazyMockup({ name }: { name: LazyMockupName }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    // Sin IntersectionObserver (navegador viejo) montamos ya: el hueco nunca
    // se queda vacío.
    if (!el || typeof IntersectionObserver === "undefined") {
      setShow(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true);
          io.disconnect();
        }
      },
      // 400px de margen: cuando el mockup entra en pantalla ya está pintado,
      // y cualquier ajuste de alto ocurre fuera del viewport.
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Mock = LAZY[name];
  return (
    <div ref={ref} className={`dcv2-lazy dcv2-lazy--${name}`} style={MOCK_BOX}>
      <div className="dcv2-lazy__h">{show ? <Mock /> : null}</div>
    </div>
  );
}
