"use client";

import { useRef, type ReactNode } from "react";

/**
 * Envoltura CLIENTE del prisma 3D del hero: sólo aporta el paralaje del mouse
 * (el diseño inclina el escenario ±4°/±3° siguiendo el cursor).
 *
 * Las 5 tarjetas llegan como `children` YA renderizadas en el servidor: así su
 * marcado viaja en el HTML/payload RSC y NO se compila dentro del bundle de
 * cliente. Este archivo se queda en unas pocas líneas de JS.
 *
 * El alto se reserva con `min-height` (igual que el diseño), así que el prisma
 * no puede mover nada al montar: CLS 0.
 *
 * Es decorativo (`aria-hidden`): las caras son maquetas del panel, no texto
 * que un lector de pantalla deba leer. `.dch3-stage` (hero-3d-v2.css) pausa
 * el giro mientras el ratón está encima; con prefers-reduced-motion no gira
 * ni sigue al ratón (landing-v2.css + `isReduced`).
 */
export function HeroStage({ children }: { children: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null);
  const reduced = useRef<boolean | null>(null);

  function isReduced() {
    if (reduced.current === null) {
      reduced.current =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
    return reduced.current;
  }

  return (
    <div
      className="dch3-stage"
      aria-hidden="true"
      onMouseMove={(e) => {
        const el = stage.current;
        if (!el || isReduced()) return;
        const r = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `rotateY(${(x * 4).toFixed(2)}deg) rotateX(${(-y * 3).toFixed(2)}deg)`;
      }}
      onMouseLeave={() => {
        const el = stage.current;
        if (el) el.style.transform = "rotateY(0deg) rotateX(0deg)";
      }}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 760,
        /* 370 px en el teléfono (antes 330): la cara frontal, con la perspectiva
           y el rotateX, asomaba por debajo y el pie del prisma la pisaba.
           25-sep-2026 (ws1-t5): medido girando el prisma en las 12 resoluciones,
           la cara frontal seguía pisando el pie hasta 20 px entre 600 y 1024 px
           (iPad vertical, móvil apaisado) y 7 px en PC. Como el prisma va
           centrado, cada px de más se reparte mitad arriba y mitad abajo:
           sube a 410/60vw/480 para dejar ≥ 8 px de aire en todos los anchos. */
        minHeight: "clamp(410px,60vw,480px)",
        marginTop: "clamp(14px,2vw,26px)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "14%",
          right: "14%",
          top: "20%",
          bottom: "4%",
          borderRadius: "50%",
          background: "radial-gradient(circle,rgba(96,165,250,0.28),rgba(96,165,250,0) 68%)",
          filter: "blur(8px)",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "24%",
          right: "24%",
          bottom: "2%",
          height: 44,
          borderRadius: "50%",
          background: "radial-gradient(ellipse,rgba(2,6,23,0.6),transparent 70%)",
        }}
      />
      <div ref={stage} style={{ perspective: "1300px", transition: "transform 0.3s ease" }}>
        <div
          className="dcv4-prism"
          style={{
            position: "relative",
            width: "clamp(200px,42vw,240px)",
            height: "clamp(258px,36vw,296px)",
            transformStyle: "preserve-3d",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
