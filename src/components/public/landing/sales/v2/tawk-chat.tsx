"use client";

import Script from "next/script";

/**
 * Livechat Tawk.to — SOLO en la landing pública (no dashboard, no portal del
 * paciente, no signup: el widget estorba en formularios y el panel tiene su
 * propio soporte). Requiere https://embed.tawk.to y https://*.tawk.to en la
 * CSP (script-src / frame-src / font-src) — ver next.config.mjs.
 *
 * lazyOnload: se inyecta cuando el navegador está ocioso, no compite con el
 * render de la landing. El guard evita doble inyección si el componente se
 * re-monta (Tawk_API global ya presente).
 */
const TAWK_SRC = "https://embed.tawk.to/6a4835ca4b956a1d4cbbc9c5/1jsl147se";

export function TawkChat() {
  return (
    <Script
      id="tawk-livechat"
      strategy="lazyOnload"
      dangerouslySetInnerHTML={{
        __html: `
          (function () {
            if (window.Tawk_API) return; // ya inyectado — no duplicar
            window.Tawk_API = window.Tawk_API || {};
            window.Tawk_LoadStart = new Date();
            var s1 = document.createElement("script");
            var s0 = document.getElementsByTagName("script")[0];
            s1.async = true;
            s1.src = "${TAWK_SRC}";
            s1.charset = "UTF-8";
            s1.setAttribute("crossorigin", "*");
            s0.parentNode.insertBefore(s1, s0);
          })();
        `,
      }}
    />
  );
}
