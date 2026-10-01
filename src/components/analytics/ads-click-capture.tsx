"use client";

// Captura del clic de Google Ads (gclid / gbraid / wbraid) al llegar (WS1-T6),
// y — WS1-T10 — del fbclid de Meta y de los UTM (source/medium/campaign/content).
//
// No pinta nada. En rutas públicas, si la URL trae un id de clic o UTM, se lo
// avisa al servidor (POST /api/ads/click), que siembra las cookies de 90 días
// con las que después el alta guarda el clic ligado a la clínica. Es la única forma de
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
import { extraerFbclid } from "@/lib/ads/meta-click";
import { extraerUtm, tieneUtm } from "@/lib/ads/utm";

export function AdsClickCapture() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || isPrivatePath(pathname)) return;
    const params = new URLSearchParams(window.location.search);
    const ids = extraerClickIds(params);
    const fbclid = extraerFbclid(params);
    const utm = extraerUtm(params);
    if (!tieneClickId(ids) && !fbclid && !tieneUtm(utm)) return;

    // Solo Google: la misma marca y el mismo cuerpo de siempre.
    let marca = `dc.ads-click.${ids.gclid ?? ""}.${ids.gbraid ?? ""}.${ids.wbraid ?? ""}`;
    const cuerpo: Record<string, string | undefined> = { ...ids };
    if (fbclid) cuerpo.fbclid = fbclid;
    if (tieneUtm(utm)) {
      cuerpo.utm_source = utm.source;
      cuerpo.utm_medium = utm.medium;
      cuerpo.utm_campaign = utm.campaign;
      cuerpo.utm_content = utm.content;
    }
    if (fbclid || tieneUtm(utm)) {
      marca += `.${fbclid ?? ""}.${utm.source ?? ""}.${utm.medium ?? ""}.${utm.campaign ?? ""}.${utm.content ?? ""}`;
    }
    try {
      if (window.sessionStorage.getItem(marca)) return;
    } catch {
      // sin storage: se avisa igual; el servidor no renueva un mismo gclid
    }

    fetch("/api/ads/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
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
