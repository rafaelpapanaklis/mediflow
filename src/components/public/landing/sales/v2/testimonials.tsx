import type { CSSProperties } from "react";
import { TESTIMONIALS } from "./landing-data";

/**
 * Carrusel infinito de testimonios (CAMBIOS §4): lista duplicada ×2 con
 * testiScroll (translateX(-50%)), pausa al hover y degradados laterales.
 * Fotos como background-image (nunca <img> dinámico). Los retratos de
 * randomuser.me son PLACEHOLDER — sustituir por fotos licenciadas.
 */
const fade: CSSProperties = { position: "absolute", top: 0, bottom: 0, width: 90, zIndex: 2, pointerEvents: "none" };

export function Testimonials() {
  const doubled = [...TESTIMONIALS.items, ...TESTIMONIALS.items];
  return (
    <section aria-label="Testimonios" style={{ background: "#f8fafc", padding: "76px 0", overflow: "hidden" }}>
      <h2 style={{ textAlign: "center", fontSize: "clamp(28px,3.4vw,40px)", fontWeight: 800, letterSpacing: "-0.02em", margin: "0 20px 40px" }}>{TESTIMONIALS.title}</h2>
      <div style={{ position: "relative" }}>
        <div style={{ ...fade, left: 0, background: "linear-gradient(90deg,#f8fafc,rgba(248,250,252,0))" }} />
        <div style={{ ...fade, right: 0, background: "linear-gradient(270deg,#f8fafc,rgba(248,250,252,0))" }} />
        <div className="dcv2-testi-track" style={{ display: "flex", gap: 18, width: "max-content" }}>
          {doubled.map((t, i) => (
            <figure key={`${t.name}-${i}`} aria-hidden={i >= TESTIMONIALS.items.length || undefined} style={{ width: 330, flex: "0 0 auto", background: "#fff", border: "1px solid #e8edf5", borderRadius: 18, padding: 24, margin: 0, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ color: "#f59e0b", fontSize: 15, letterSpacing: 2 }} aria-label="5 estrellas">★★★★★</div>
              <blockquote style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "#334155" }}>&ldquo;{t.quote}&rdquo;</blockquote>
              <figcaption style={{ display: "flex", alignItems: "center", gap: 12, marginTop: "auto" }}>
                <span
                  aria-hidden="true"
                  style={{ display: "block", width: 46, height: 46, borderRadius: "50%", flex: "0 0 auto", border: "2px solid #dbeafe", background: "#dbeafe center/cover no-repeat", backgroundImage: `url(https://randomuser.me/api/portraits/${t.photo}.jpg)` }}
                />
                <span><b style={{ fontSize: 14.5, display: "block" }}>{t.name}</b><span style={{ fontSize: 12.5, color: "#64748b", lineHeight: 1.4, display: "block" }}>{t.role}</span></span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
