"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Escenario 3D en CSS para una pieza grande (el marco del panel, el teléfono):
 *  · entra en pantalla inclinada hacia atrás y se endereza sola (clase
 *    `is-in`, transición en CSS);
 *  · después sigue al puntero unos grados, como el prisma del hero;
 *  · con prefers-reduced-motion se queda plana y quieta.
 *
 * Los hijos llegan ya renderizados en el servidor: este archivo aporta unas
 * pocas líneas de JS y nada de marcado.
 */
export function Tilt3D({
  children,
  max = 5,
  className,
}: {
  children: ReactNode;
  /** Grados máximos de inclinación al seguir el puntero. */
  max?: number;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const reduced = useRef(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    reduced.current = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced.current || typeof IntersectionObserver === "undefined") {
      el.classList.add("is-in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.classList.add("is-in");
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={wrap}
      className={`dcv4-tilt${className ? ` ${className}` : ""}`}
      onMouseMove={(e) => {
        const el = stage.current;
        if (!el || reduced.current) return;
        const r = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `rotateY(${(x * max).toFixed(2)}deg) rotateX(${(-y * max * 0.7).toFixed(2)}deg)`;
      }}
      onMouseLeave={() => {
        const el = stage.current;
        if (el) el.style.transform = "";
      }}
    >
      <div ref={stage} className="dcv4-tilt__stage">
        {children}
      </div>
    </div>
  );
}
