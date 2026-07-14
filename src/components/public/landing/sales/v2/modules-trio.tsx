import type { ReactNode } from "react";
import { MODULES_TRIO } from "./landing-data";
import { AnalyticsMock, EquipoMock, PaginaWebMock } from "./mockups";

const MOCKUPS: Record<string, ReactNode> = {
  "analytics": <AnalyticsMock />,
  "equipo": <EquipoMock />,
  "pagina-web": <PaginaWebMock />,
};

export function ModulesTrio() {
  return (
    <section aria-label="Más módulos del panel" style={{ background: "#f8fafc", padding: "30px 20px 50px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <h3 style={{ textAlign: "center", fontSize: "clamp(22px,2.6vw,28px)", fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 8px" }}>{MODULES_TRIO.title}</h3>
        <p style={{ textAlign: "center", fontSize: 15, color: "#64748b", margin: "0 0 30px" }}>{MODULES_TRIO.subtitle}</p>
        {/* Los 3 mockups se estiran a la MISMA altura (CAMBIOS §1). */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 20 }}>
          {MODULES_TRIO.items.map((m) => (
            <div key={m.id} style={{ display: "flex", flexDirection: "column" }}>
              <div aria-hidden="true" style={{ flex: 1, display: "flex", flexDirection: "column", marginBottom: 14 }}>{MOCKUPS[m.mockup]}</div>
              <b style={{ fontSize: 16, display: "block", marginBottom: 4 }}>{m.title}</b>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: "#64748b", margin: 0 }}>{m.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
