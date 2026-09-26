"use client";

import { useEffect, useRef } from "react";

/**
 * «Apagar la luz de la sala»: una capa oscura que cubre la sección y cuya
 * opacidad va ligada al scroll. Al entrar la sección en pantalla se oscurece
 * (casi negro) para que la vista se centre en la pantalla del panel y las
 * tarjetas; al seguir bajando hacia la sección siguiente se vuelve a aclarar
 * hasta blanco.
 *
 * Cómo: en cada scroll (un solo rAF pendiente) se calcula el progreso a partir
 * de la caja de la sección y se escribe la variable `--cine` (0…1) en la
 * sección. La capa es `opacity: var(--cine)` (solo opacidad de UNA capa, sin
 * repintar el fondo de la página) y los textos y tarjetas se coordinan en CSS
 * con `color-mix()` sobre la misma variable. Con prefers-reduced-motion la
 * variable se queda en 0: estado fijo y legible, sin transición por scroll.
 *
 * Solo escucha el scroll mientras la sección está cerca (IntersectionObserver
 * con un margen de una pantalla); fuera de ahí no hace nada.
 */
const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number) => t * t * (3 - 2 * t);

export function CineFondo() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = ref.current;
    const sec = layer?.parentElement;
    if (!layer || !sec) return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      sec.style.setProperty("--cine", "0");
      return;
    }

    let raf = 0;
    let last = -1;
    const tick = () => {
      raf = 0;
      const r = sec.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // Entrada: oscuro del todo cuando el borde superior llega al 25 % de la pantalla.
      const entra = clamp((vh - r.top) / (vh * 0.75));
      // Salida: empieza a aclarar cuando el borde inferior cruza el fondo de la
      // pantalla y llega a blanco cuando está al 30 % (ya se va hacia WhatsApp).
      const sale = clamp((r.bottom - vh * 0.3) / (vh * 0.7));
      const v = Math.round(smooth(Math.min(entra, sale)) * 1000) / 1000;
      if (v !== last) {
        last = v;
        sec.style.setProperty("--cine", String(v));
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const escucha = (on: boolean) => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (on) {
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        onScroll();
      }
    };

    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((entries) => escucha(entries.some((e) => e.isIntersecting)), { rootMargin: "100% 0px" });
      io.observe(sec);
    } else {
      escucha(true);
    }
    tick();
    return () => {
      io?.disconnect();
      escucha(false);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <div ref={ref} className="dcv4-cine" aria-hidden="true" />;
}
