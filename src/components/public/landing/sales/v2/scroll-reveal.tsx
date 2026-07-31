"use client";

import { useEffect } from "react";

/**
 * Aparición al hacer scroll de todo lo marcado con `data-reveal` (el diseño lo
 * resuelve igual: un solo observador para toda la página).
 *
 * Por qué así y no con un wrapper por sección: las secciones se quedan siendo
 * server components — el marcado NO entra al bundle de cliente, sólo estas
 * ~25 líneas.
 *
 * Reglas de seguridad:
 *  - sólo toca `opacity`/`transform` (nunca propiedades de layout) → CLS 0;
 *  - el estado inicial lo pone el propio JS, así que sin JS todo se ve;
 *  - con `prefers-reduced-motion` no hace nada;
 *  - el hero NO lleva `data-reveal`: el LCP no puede quedar en opacity 0.
 */
export function ScrollReveal() {
  useEffect(() => {
    if (
      typeof IntersectionObserver === "undefined" ||
      (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    ) {
      return;
    }

    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (els.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.classList.remove("dcv4-reveal-init");
          el.classList.add("dcv4-reveal-on");
          io.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.1 },
    );

    for (const el of els) {
      el.classList.add("dcv4-reveal-init");
      io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  return null;
}
