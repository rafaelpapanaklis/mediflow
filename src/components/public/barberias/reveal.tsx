"use client";

import { useEffect } from "react";

/**
 * Aparición al hacer scroll de todo lo marcado con `data-reveal` — el mismo
 * patrón que la landing dental (sales/v2/scroll-reveal.tsx): un solo
 * observador para toda la página y las secciones siguen siendo server
 * components; al bundle de cliente solo van estas líneas.
 *
 * Reglas:
 *  - solo toca opacity/transform (nunca layout) → CLS 0;
 *  - el estado inicial lo pone este JS, así que sin JS todo se ve;
 *  - con prefers-reduced-motion no hace nada;
 *  - la portada NO lleva data-reveal: el LCP no puede quedar en opacity 0.
 */
export function BarberReveal() {
  useEffect(() => {
    if (
      typeof IntersectionObserver === "undefined" ||
      (typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    ) {
      return;
    }
    const els = Array.from(document.querySelectorAll<HTMLElement>(".dcbl [data-reveal]"));
    if (els.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.classList.remove("dcbl-reveal-init");
          el.classList.add("dcbl-reveal-on");
          io.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );

    for (const el of els) {
      // Lo que ya está en pantalla al hidratar se queda como está: no hay
      // que "esconderlo" para volverlo a enseñar.
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.92 && r.bottom > 0) continue;
      el.classList.add("dcbl-reveal-init");
      io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  return null;
}
