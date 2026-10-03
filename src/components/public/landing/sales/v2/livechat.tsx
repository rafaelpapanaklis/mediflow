"use client";

import { useEffect } from "react";
import Script from "next/script";

/**
 * Chat de LiveChat (livechat.com) — SOLO en la portada (src/app/page.tsx) y
 * en el blog (src/app/blog/layout.tsx). Ni panel, ni portal del paciente, ni
 * signup: el aviso de privacidad (sección 3) dice exactamente eso. Requiere
 * cdn.livechatinc.com / *.livechatinc.com / *.livechat-static.com en la CSP
 * (script-src, style-src, font-src, frame-src) — ver next.config.mjs.
 *
 * lazyOnload: se inyecta cuando el navegador está ocioso, no compite con el
 * render de la portada. next/script no repite un id ya cargado, y el guard
 * de window.LiveChatWidget evita una segunda inyección del tracking.js.
 *
 * Navegación del lado del cliente: el widget vive en <body> y sobrevive a un
 * cambio de ruta, así que al desmontar (p. ej. portada → /login) se oculta, y
 * al volver a montar (otra página con chat) se vuelve a mostrar minimizado.
 */
const LICENCIA = 19969055;

type Widget = { call: (metodo: string, ...args: unknown[]) => void };
let ocultadoAlSalir = false;

function widget(): Widget | undefined {
  return (window as unknown as { LiveChatWidget?: Widget }).LiveChatWidget;
}

export function LiveChat() {
  useEffect(() => {
    if (ocultadoAlSalir) {
      ocultadoAlSalir = false;
      widget()?.call("minimize");
    }
    return () => {
      const w = widget();
      if (!w) return;
      w.call("hide");
      ocultadoAlSalir = true;
    };
  }, []);

  return (
    <>
      <Script
        id="livechat-widget"
        strategy="lazyOnload"
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              if (window.LiveChatWidget) return; // ya inyectado — no duplicar
              window.__lc = window.__lc || {};
              window.__lc.license = ${LICENCIA};
              window.__lc.integration_name = "manual_onboarding";
              window.__lc.product_name = "livechat";
              ;(function(n,t,c){function i(n){return e._h?e._h.apply(null,n):e._q.push(n)}var e={_q:[],_h:null,_v:"2.0",on:function(){i(["on",c.call(arguments)])},once:function(){i(["once",c.call(arguments)])},off:function(){i(["off",c.call(arguments)])},get:function(){if(!e._h)throw new Error("[LiveChatWidget] You can't use getters before load.");return i(["get",c.call(arguments)])},call:function(){i(["call",c.call(arguments)])},init:function(){var n=t.createElement("script");n.async=!0,n.type="text/javascript",n.src="https://cdn.livechatinc.com/tracking.js",t.head.appendChild(n)}};!n.__lc.asyncInit&&e.init(),n.LiveChatWidget=n.LiveChatWidget||e}(window,document,[].slice));
            })();
          `,
        }}
      />
      <noscript>
        <a href={`https://www.livechat.com/chat-with/${LICENCIA}/`} rel="nofollow">
          Chat with us
        </a>
      </noscript>
    </>
  );
}
