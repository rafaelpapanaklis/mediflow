"use client";

// Se monta una sola vez en el root layout → cubre landing + dashboard + portal.
// Dispara un pageview en cada cambio de ruta (usePathname). NO usa useSearchParams
// para no romper el SSG de la landing; la query (utm) se lee desde window en el core.
// No se rastrea /admin (uso del owner) ni /live (pantalla en clínica).

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { IGNORED_PREFIXES } from "@/lib/analytics/constants";
import { start, stop, pageview } from "@/lib/analytics/tracker-core";

function isIgnored(path: string): boolean {
  return IGNORED_PREFIXES.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p));
}

export function AnalyticsTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined" || !pathname) return;
    if (isIgnored(pathname)) {
      stop();
      return;
    }
    start();
    pageview(pathname);
  }, [pathname]);

  return null;
}

export default AnalyticsTracker;
