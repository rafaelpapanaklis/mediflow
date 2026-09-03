"use client";

// El arnés del banco de pruebas. Ver la cabecera de page.tsx: fuera de
// desarrollo la página devuelve 404 y esto no se monta.

import { useEffect, useState } from "react";
import { LivePublicClient } from "../live/[slug]/live-public-client";
import mc from "../dashboard/clinic-layout/components/floor-tokens.module.css";

export function DevLiveHarness({
  payload,
  dark,
}: {
  payload: unknown;
  dark: boolean;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const real = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/live/")) {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return real(input as RequestInfo, init);
    }) as typeof window.fetch;
    // El toggle de tema del propio cliente persiste por slug; forzamos el
    // que pide la URL antes de montar.
    try {
      window.localStorage.setItem("live-theme-dev", dark ? "dark" : "light");
      window.localStorage.removeItem("mf:live-view:dev");
    } catch {
      /* noop */
    }
    setReady(true);
    return () => {
      window.fetch = real;
    };
  }, [payload, dark]);

  if (!ready) return null;
  return (
    <div className={mc.mcTokens}>
      <LivePublicClient
        slug="dev"
        clinicName="Clínica Dental Papanaklis"
        /* La categoría manda la paleta y el catálogo del mundo 3D. */
        category="DENTAL"
        logoUrl={null}
        city="Monterrey"
        showPatientNames={false}
      />
    </div>
  );
}
