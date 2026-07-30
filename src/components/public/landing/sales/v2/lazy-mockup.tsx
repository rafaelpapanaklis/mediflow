"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";

/**
 * Mockups del panel montados SOLO cuando el usuario se acerca a ellos.
 *
 * POR QUÉ: los mockups son server components y su DOM completo viajaba en el
 * HTML inicial y ADEMÁS duplicado dentro del payload RSC (self.__next_f), que
 * era el 54% de los 353 KB del home. Con `ssr: false` desaparecen de los dos
 * sitios y bajan en un chunk aparte al hacer scroll.
 *
 * EL DEL HERO NO SE DIFIERE: HeroDashboardMock es el elemento LCP y se queda
 * renderizado en el servidor (hero.tsx no se toca).
 *
 * TAMPOCO PacientesMock: su alto salta en 13 escalones entre 300 y 760 px de
 * ancho (tres de ellos de 1 px) porque las barras de filtros reenvuelven el
 * texto; no hay forma de reservar el hueco exacto, así que sigue en SSR.
 *
 * CLS = 0: mientras no está montado, `<Reserve>` deja un hueco con el alto
 * EXACTO que ocupará el mockup real (tabla medida en Chrome, .dcv2-lazy--* en
 * landing-v2.css). El mismo hueco se reutiliza como `loading` de next/dynamic
 * para que tampoco se colapse en el intervalo entre "empieza el import" y
 * "el chunk ya está". Encima el rootMargin de 400px hace que el montaje
 * ocurra siempre con el mockup fuera de pantalla.
 */

export type LazyMockupName =
  | "agenda-semanal"
  | "presupuesto"
  | "visor-dicom-stl"
  | "clinica-isometrica"
  | "inbox-ia-split"
  | "analytics"
  | "equipo"
  | "pagina-web";

/** Hueco con el alto reservado del mockup (ver landing-v2.css). */
function Reserve({ name }: { name: LazyMockupName }) {
  return <div className={`dcv2-lazy__ph dcv2-lazy--${name}`} />;
}

const LAZY: Record<LazyMockupName, ComponentType> = {
  "agenda-semanal": dynamic(() => import("./mockups").then((m) => m.AgendaMock), {
    ssr: false,
    loading: () => <Reserve name="agenda-semanal" />,
  }),
  "presupuesto": dynamic(() => import("./mockups").then((m) => m.PresupuestoMock), {
    ssr: false,
    loading: () => <Reserve name="presupuesto" />,
  }),
  "visor-dicom-stl": dynamic(() => import("./mockups").then((m) => m.DicomStlMock), {
    ssr: false,
    loading: () => <Reserve name="visor-dicom-stl" />,
  }),
  "clinica-isometrica": dynamic(() => import("./mockups").then((m) => m.ClinicaIsometricaMock), {
    ssr: false,
    loading: () => <Reserve name="clinica-isometrica" />,
  }),
  "inbox-ia-split": dynamic(() => import("./mockups").then((m) => m.InboxIaSplitMock), {
    ssr: false,
    loading: () => <Reserve name="inbox-ia-split" />,
  }),
  "analytics": dynamic(() => import("./mockups").then((m) => m.AnalyticsMock), {
    ssr: false,
    loading: () => <Reserve name="analytics" />,
  }),
  "equipo": dynamic(() => import("./mockups").then((m) => m.EquipoMock), {
    ssr: false,
    loading: () => <Reserve name="equipo" />,
  }),
  "pagina-web": dynamic(() => import("./mockups").then((m) => m.PaginaWebMock), {
    ssr: false,
    loading: () => <Reserve name="pagina-web" />,
  }),
};

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
      // y el cambio de alto (si lo hubiera) ocurre fuera del viewport.
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Mock = LAZY[name];
  return (
    <div ref={ref} className="dcv2-lazy">
      {show ? <Mock /> : <Reserve name={name} />}
    </div>
  );
}
