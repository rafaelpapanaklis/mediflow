"use client";

import { useEffect, useRef, useState } from "react";
import { STATS } from "./landing-data";

/**
 * Banda de prueba social con contadores que suben al entrar en pantalla.
 *
 * CLS 0 y sin parpadeo:
 *  - el alto del número se reserva con `min-height: 1.15em` (igual que el
 *    diseño), así que la cifra puede cambiar sin mover nada;
 *  - el HTML del servidor trae ya el valor FINAL. La animación sólo arranca si
 *    la banda está FUERA de pantalla al montar; si el usuario ya la tiene
 *    delante, se queda en el valor final en vez de saltar a 0 y volver a subir.
 */

function format(value: number, kind: (typeof STATS)[number]["format"]): string {
  if (kind === "plus-suffix") return `${value}+`;
  if (kind === "plus-thousands") return `+${value.toLocaleString("en-US")}`;
  return `+${value}M`;
}

const FINAL = STATS.map((s) => s.to);

export function SocialProofBar() {
  const ref = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<number[]>(FINAL);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") return;

    // Ya visible al montar → nos quedamos en el valor final (sin flash).
    const box = el.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) return;

    let raf = 0;
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      const t0 = performance.now();
      const dur = 1400;
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        setValues(FINAL.map((n) => Math.round(n * e)));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };

    setValues(FINAL.map(() => 0));
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) {
          run();
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section
      aria-label="Prueba social"
      style={{ background: "linear-gradient(120deg,#131a3a 0%,#1e3a8a 55%,#312e81 100%)", borderTop: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div
        ref={ref}
        style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(38px,4.6vw,58px) 20px", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(215px,1fr))", gap: "clamp(22px,3vw,40px)", textAlign: "center" }}
      >
        {STATS.map((s, i) => (
          <div key={s.label} data-reveal="">
            {/* `tabular-nums`: sin esto cada dígito tiene un ancho distinto y la
                cifra se ensancha/encoge en cada frame de la cuenta, lo que el
                navegador contabiliza como micro layout-shift (medido: 1.5e-4 de
                CLS). Con cifras tabulares el ancho sólo cambia al ganar un
                dígito, no en cada paso. */}
            <span style={{ display: "block", fontSize: "clamp(34px,3.8vw,52px)", fontWeight: 800, letterSpacing: "-0.03em", color: "#ffffff", minHeight: "1.15em", fontVariantNumeric: "tabular-nums" }}>
              {format(values[i], s.format)}
            </span>
            <span style={{ display: "block", marginTop: 6, fontSize: 15, color: "#dbeafe" }}>{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
