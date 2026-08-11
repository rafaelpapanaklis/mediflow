"use client";

// PageView del píxel de Meta en cada cambio de ruta.
//
// Next App Router no dispara PageView solo: el snippet de arranque mediría la
// primera página de la visita y ninguna más (una visita de 5 páginas contaría
// 1). Por eso el layout hace ÚNICAMENTE fbq('init', ...) y el único PageView
// —ni cero ni dos— sale de aquí, igual que el page_view de GA4 con
// send_page_view:false.
//
// Solo rutas públicas: en el panel no se manda nada (isPrivatePath). No es solo
// higiene de medición — /paciente y /portal son datos de pacientes y no pueden
// generar señales hacia Meta.

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { isPrivatePath } from "@/lib/analytics/ga4";

type FbqFn = (...args: unknown[]) => void;

/** Reintento mientras fbevents.js aún no está: 100ms x 40 ≈ 4s y se rinde. */
const RETRY_MS = 100;
const MAX_RETRIES = 40;

function MetaPixelPageviewInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // El objeto de searchParams cambia de referencia entre renders; el string no.
  // Como dep del efecto, garantiza un hit por navegación real y no uno por render.
  const query = searchParams?.toString() ?? "";

  useEffect(() => {
    if (!pathname || isPrivatePath(pathname)) return;

    let timer: number | undefined;
    let tries = 0;

    const send = () => {
      const fbq = (window as unknown as { fbq?: FbqFn }).fbq;
      // El <Script> del layout es afterInteractive, así que en la primera carga
      // este efecto corre ANTES de que exista window.fbq: sin el reintento se
      // perdería el PageView de entrada de cada visita, que es justo el evento
      // al que optimiza la campaña. Cuando fbq ya es función, el snippet inline
      // ya encoló el init, así que el evento no llega antes que su destino.
      if (typeof fbq !== "function") {
        // Se agotó: o hay adblock, o la visita empezó en una ruta privada y el
        // layout nunca arrancó el píxel. En los dos casos se calla y ya.
        if (tries++ >= MAX_RETRIES) return;
        timer = window.setTimeout(send, RETRY_MS);
        return;
      }

      // PageView no lleva la ruta como parámetro: el píxel lee location por su
      // cuenta y, al correr el efecto después de pintar, ya es la URL nueva.
      fbq("track", "PageView");
    };

    send();
    return () => window.clearTimeout(timer);
    // `query` no se lee en el cuerpo: está en las deps a propósito, para que un
    // cambio de solo query string (?utm_..., ?plan=...) cuente como navegación,
    // igual que la contaría una carga completa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, query]);

  return null;
}

/** useSearchParams exige un <Suspense> en App Router: sin él `next build` falla
 *  con missing-suspense-with-csr-bailout y las páginas públicas perderían el
 *  prerender. El boundary envuelve un componente que renderiza null, así que
 *  solo él sale del prerender, no la página. */
export function MetaPixelPageview() {
  return (
    <Suspense fallback={null}>
      <MetaPixelPageviewInner />
    </Suspense>
  );
}

export default MetaPixelPageview;
