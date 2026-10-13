"use client";

// Embudo (ws1-t9): `landing_vista` al abrir la portada. Una vez por sesión de
// navegador (registrarPaso lo marca); no pinta nada. El registro_vista sale del
// propio formulario de /signup. En rutas privadas registrarPaso no hace nada.

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { registrarPasoCuandoHayGtag } from "@/lib/analytics/embudo";

export function EmbudoVistas() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname !== "/") return;
    return registrarPasoCuandoHayGtag("landing_vista");
  }, [pathname]);
  return null;
}
