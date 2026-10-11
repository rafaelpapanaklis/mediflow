"use client";

import { useEffect, useRef, useState } from "react";
import { WHATSAPP_CTA } from "./landing-data";
import { BotonWhatsapp, EnlaceEmpezar } from "./cta-embudo";
import { ANCHO_MOVIL_MAX, accionLiveChat, barraVisible, type VisibilidadLiveChat } from "./barra-movil-logica";

/**
 * Barra fija al pie en celular (11-oct-2026, ws1-t4, punto 1b del encargo de
 * ws7): «Empezar» (→ #precios, `clic_empezar` origen barra_movil) y «WhatsApp»
 * (`whatsapp_clic` origen barra_movil). Solo bajo 760 px (landing-v2.css,
 * `.dcv4-barra`); en escritorio ni se pinta ni ocupa sitio.
 *
 * Aparece cuando el hero sale de pantalla (IntersectionObserver sobre #inicio):
 * mientras el hero se ve, ya tiene sus propios botones. Al pie lleva un
 * espaciador en flujo para que el footer no quede tapado.
 *
 * LiveChat: la decisión y sus razones están en barra-movil-logica.ts
 * (`accionLiveChat`). Resumen: en móvil, mientras la barra se ve, el lanzador
 * del chat se oculta; cuando la barra se va, vuelve minimizado; si la persona
 * está chateando no se toca; en escritorio nada cambia.
 */

type Widget = { call: (metodo: string, ...args: unknown[]) => void; get: (q: string) => unknown };

function widget(): Widget | undefined {
  return (window as unknown as { LiveChatWidget?: Widget }).LiveChatWidget;
}

/** `get` lanza antes de cargar: entonces no se sabe (undefined). */
function estadoChat(w: Widget | undefined): VisibilidadLiveChat | undefined {
  try {
    const s = w?.get("state") as { visibility?: VisibilidadLiveChat } | undefined;
    return s?.visibility;
  } catch {
    return undefined;
  }
}

export function BarraMovil() {
  const [visible, setVisible] = useState(false);
  const ocultadoPorLaBarra = useRef(false);

  useEffect(() => {
    const hero = document.getElementById("inicio");
    if (!hero || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(barraVisible(e.isIntersecting)), { threshold: 0 });
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const aplicar = () => {
      const w = widget();
      if (!w) return;
      const accion = accionLiveChat({
        movil: window.innerWidth <= ANCHO_MOVIL_MAX,
        barraVisible: visible,
        estadoChat: estadoChat(w),
        ocultadoPorLaBarra: ocultadoPorLaBarra.current,
      });
      if (!accion) return;
      w.call(accion);
      ocultadoPorLaBarra.current = accion === "hide";
    };
    aplicar();
    // Girar el teléfono o estirar la ventana cambia «movil»: se vuelve a decidir.
    window.addEventListener("resize", aplicar);
    return () => window.removeEventListener("resize", aplicar);
  }, [visible]);

  // Al salir de la portada se devuelve el lanzador tal como estaba (livechat.tsx
  // lo esconde después si la ruta nueva no lleva chat).
  useEffect(
    () => () => {
      if (ocultadoPorLaBarra.current) widget()?.call("minimize");
    },
    [],
  );

  return (
    <>
      <div className="dcv4-barra" data-visible={visible ? "" : undefined} role="region" aria-label="Acciones rápidas">
        <EnlaceEmpezar href="#precios" origen="barra_movil" className="dcv2-btn-primary dcv4-barra__btn">
          {WHATSAPP_CTA.barStart}
        </EnlaceEmpezar>
        <BotonWhatsapp origen="barra_movil" className="dcv2-btn-wa dcv4-barra__btn" glyphSize={19}>
          {WHATSAPP_CTA.barWhatsapp}
        </BotonWhatsapp>
      </div>
      <div aria-hidden="true" className="dcv4-barra__hueco" />
    </>
  );
}
