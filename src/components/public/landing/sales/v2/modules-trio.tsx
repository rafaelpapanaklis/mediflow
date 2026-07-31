import type { ReactNode } from "react";
import { MODULES_TRIO } from "./landing-data";
import { AnalyticsMini, EquipoMini, PaginaWebMini } from "./mockups";

/**
 * Trío oscuro: analytics, equipo y página web. Los 3 mini-mockups se quedan en
 * SSR — su marcado es una fracción del de los mockups grandes y difiriéndolos
 * no se recuperaría nada apreciable.
 */
const MINI: Record<string, ReactNode> = {
  analytics: <AnalyticsMini />,
  equipo: <EquipoMini />,
  web: <PaginaWebMini />,
};

export function ModulesTrio() {
  return (
    <section aria-label="Más módulos del panel" style={{ background: "#0f172a" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(56px,7vw,92px) 20px" }}>
        <div data-reveal="" style={{ textAlign: "center", maxWidth: 720, margin: "0 auto" }}>
          <h2 className="dcv4-balance" style={{ fontSize: "clamp(26px,3.2vw,40px)", lineHeight: 1.1, letterSpacing: "-0.032em", fontWeight: 800, color: "#ffffff" }}>
            {MODULES_TRIO.title}
          </h2>
          <p style={{ marginTop: 14, fontSize: "clamp(15.5px,1.4vw,18px)", color: "#cbd5e1" }}>{MODULES_TRIO.subtitle}</p>
        </div>
        <div style={{ marginTop: "clamp(30px,4vw,48px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(272px,1fr))", gap: "clamp(16px,2vw,24px)" }}>
          {MODULES_TRIO.items.map((m) => (
            <article key={m.id} data-reveal="" className="dcv4-trio" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: "clamp(18px,2.2vw,24px)" }}>
              <div aria-hidden="true">{MINI[m.id]}</div>
              <h3 style={{ marginTop: 16, fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: "#ffffff" }}>{m.title}</h3>
              <p className="dcv4-pretty" style={{ marginTop: 8, fontSize: 14.5, lineHeight: 1.58, color: "#cbd5e1" }}>{m.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
