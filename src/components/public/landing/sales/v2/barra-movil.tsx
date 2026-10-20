"use client";

import { useEffect, useState } from "react";
import { WHATSAPP_CTA } from "./landing-data";
import { BotonWhatsapp, EnlaceEmpezar } from "./cta-embudo";
import { barraVisible } from "./barra-movil-logica";
import { abrirTarjetaWhatsapp } from "./whatsapp-widget-eventos";

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
 * El botón flotante de WhatsApp (whatsapp-widget.tsx, que reemplazó a LiveChat)
 * se asienta encima de esta barra en celular (landing-v2.css, `.dcv4-wawidget`).
 */

export function BarraMovil() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const hero = document.getElementById("inicio");
    if (!hero || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(barraVisible(e.isIntersecting)), { threshold: 0 });
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  // El botón flotante de WhatsApp lee esta marca (landing-v2.css): con la barra a la vista
  // no se pintan dos botones de WhatsApp y la tarjeta se asienta encima de la barra.
  useEffect(() => {
    if (visible) document.body.setAttribute("data-barra-movil", "");
    else document.body.removeAttribute("data-barra-movil");
    return () => document.body.removeAttribute("data-barra-movil");
  }, [visible]);

  return (
    <>
      <div className="dcv4-barra" data-visible={visible ? "" : undefined} role="region" aria-label="Acciones rápidas">
        <EnlaceEmpezar href="#precios" origen="barra_movil" className="dcv2-btn-primary dcv4-barra__btn">
          {WHATSAPP_CTA.barStart}
        </EnlaceEmpezar>
        <BotonWhatsapp origen="barra_movil" className="dcv2-btn-wa dcv4-barra__btn" glyphSize={19} alClic={(teclado) => abrirTarjetaWhatsapp(teclado)}>
          {WHATSAPP_CTA.barWhatsapp}
        </BotonWhatsapp>
      </div>
      <div aria-hidden="true" className="dcv4-barra__hueco" />
    </>
  );
}
