"use client";

import { useEffect } from "react";

/**
 * Registra un click de afiliado (fire-and-forget, no bloquea el render).
 * Dedupe por sesión de navegador (sessionStorage) por ref+path.
 * Cualquier fallo se ignora: el tracking JAMÁS rompe la página.
 */
export function RefClickTracker({ refCode }: { refCode: string | null | undefined }) {
  useEffect(() => {
    if (!refCode) return;
    const ref = String(refCode).slice(0, 64);
    const path = window.location.pathname.slice(0, 120);

    let campaign: string | null = null;
    try {
      const sp = new URLSearchParams(window.location.search);
      campaign = (sp.get("c") ?? sp.get("utm_campaign") ?? "").slice(0, 64) || null;
    } catch {
      /* noop */
    }

    try {
      const key = `dc_aff_click:${ref}:${path}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* modo privado: registramos igual, sin dedupe */
    }

    const body = JSON.stringify({ ref, path, campaign });
    try {
      const beaconOk =
        typeof navigator.sendBeacon === "function" &&
        navigator.sendBeacon("/api/afiliados/track", new Blob([body], { type: "application/json" }));
      if (!beaconOk) {
        void fetch("/api/afiliados/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      /* nunca rompas la página por tracking */
    }
  }, [refCode]);

  return null;
}
