"use client";

// Se monta una sola vez en el root layout → cubre landing + dashboard + portal.
// Dispara un pageview en cada cambio de ruta (usePathname). NO usa useSearchParams
// para no romper el SSG de la landing; la query (utm) se lee desde window en el core.
// No se rastrea /admin (uso del owner), /live (pantalla en clínica) ni lo que ve un
// paciente (/paciente, /portal y enlaces con token: ver PATIENT_PREFIXES).

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isTrackingIgnored } from "@/lib/analytics/constants";
import { start, stop, pageview } from "@/lib/analytics/tracker-core";

export function AnalyticsTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined" || !pathname) return;
    if (isTrackingIgnored(pathname)) {
      stop();
      return;
    }
    start();
    pageview(pathname);
  }, [pathname]);

  return null;
}

export default AnalyticsTracker;
