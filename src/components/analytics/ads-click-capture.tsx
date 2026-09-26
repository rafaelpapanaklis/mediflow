"use client";

// Captura del clic de Google Ads (gclid / gbraid / wbraid) al llegar (WS1-T6).
//
// No pinta nada. En rutas públicas, si la URL trae un id de clic, se lo avisa al
// servidor (POST /api/ads/click), que siembra la cookie de 90 días con la que
// después el alta guarda el clic ligado a la clínica. Es la única forma de
// atribuir luego los pagos que no pasan por /dashboard/suspended/success (SPEI
// directo). Ver @/lib/ads/click-ids.
//
// Sin JS o con la petición bloqueada no pasa nada: el alta también lee `_gcl_aw`,
// la cookie de gtag.js, como respaldo. sessionStorage evita repetir el aviso al
// navegar dentro de la misma visita.

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isPrivatePath } from "@/lib/analytics/ga4";
import { extraerClickIds, tieneClickId } from "@/lib/ads/click-ids";

export function AdsClickCapture() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || isPrivatePath(pathname)) return;
    const ids = extraerClickIds(new URLSearchParams(window.location.search));
    if (!tieneClickId(ids)) return;

    const marca = `dc.ads-click.${ids.gclid ?? ""}.${ids.gbraid ?? ""}.${ids.wbraid ?? ""}`;
    try {
      if (window.sessionStorage.getItem(marca)) return;
    } catch {
      // sin storage: se avisa igual; el servidor no renueva un mismo gclid
    }

    fetch("/api/ads/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids),
      credentials: "same-origin",
      keepalive: true,
    })
      .then((r) => {
        if (!r.ok) return;
        try { window.sessionStorage.setItem(marca, "1"); } catch { /* sin storage */ }
      })
      .catch(() => {
        // bloqueado / sin red: el respaldo es _gcl_aw
      });
  }, [pathname]);

  return null;
}

export default AdsClickCapture;
