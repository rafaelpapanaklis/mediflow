"use client";

// page_view de GA4 en cada cambio de ruta.
//
// Next App Router no dispara page_view solo: el `config` inicial mediría la
// primera página de la visita y ninguna más (una visita de 5 páginas contaría
// 1). Por eso GA4 se configura con send_page_view:false en el layout y el ÚNICO
// page_view —ni cero ni dos— sale de aquí.
//
// Solo rutas públicas: en el panel no se manda nada (isPrivatePath). El tag de
// Google Ads no se toca y sigue cargando en todas las rutas.

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { GA4_MEASUREMENT_ID, isPrivatePath } from "@/lib/analytics/ga4";

type GtagFn = (...args: unknown[]) => void;

/** Reintento mientras gtag.js aún no está: 100ms x 40 ≈ 4s y se rinde. */
const RETRY_MS = 100;
const MAX_RETRIES = 40;

function GaPageviewInner() {
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
      const gtag = (window as unknown as { gtag?: GtagFn }).gtag;
      // Los <Script> del layout son afterInteractive, así que en la primera
      // carga este efecto suele correr ANTES de que exista window.gtag: sin el
      // reintento se perdería el page_view de entrada de cada visita. Cuando
      // gtag ya es función, el bloque inline del layout ya encoló el config de
      // GA4, así que el evento no llega antes que su destino.
      if (typeof gtag !== "function") {
        if (tries++ >= MAX_RETRIES) return; // gtag bloqueado (adblock) → se deja pasar
        timer = window.setTimeout(send, RETRY_MS);
        return;
      }

      gtag("event", "page_view", {
        // send_to acota el evento a GA4. Sin esto el page_view se emitiría
        // también al destino de Google Ads (AW-...), que no debe cambiar.
        send_to: GA4_MEASUREMENT_ID,
        page_path: query ? `${pathname}?${query}` : pathname,
        page_location: window.location.href,
        page_title: document.title,
      });
    };

    send();
    return () => window.clearTimeout(timer);
  }, [pathname, query]);

  return null;
}

/** useSearchParams exige un <Suspense> en App Router: sin él `next build` falla
 *  con missing-suspense-with-csr-bailout y las páginas públicas perderían el
 *  prerender. El boundary envuelve un componente que renderiza null, así que
 *  solo él sale del prerender, no la página. */
export function GaPageview() {
  return (
    <Suspense fallback={null}>
      <GaPageviewInner />
    </Suspense>
  );
}

export default GaPageview;
