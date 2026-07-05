import type { ReactNode } from "react";
import { SPOTLIGHTS, SPOTLIGHTS_HEADER } from "./landing-data";
import {
  AgendaMock, PacientesMock, PresupuestoMock, DicomMock,
  StlMock, ClinicaVisualMock, InboxMock, AsistenteIaMock,
} from "./mockups";

const MOCKUPS: Record<string, ReactNode> = {
  "agenda-semanal": <AgendaMock />,
  "tabla-pacientes": <PacientesMock />,
  "presupuesto": <PresupuestoMock />,
  "visor-dicom": <DicomMock />,
  "visor-stl": <StlMock />,
  "clinica-visual": <ClinicaVisualMock />,
  "inbox-whatsapp": <InboxMock />,
  "asistente-ia": <AsistenteIaMock />,
};

export function Spotlights() {
  return (
    <section id="funciones" style={{ scrollMarginTop: 80, background: "#f8fafc", padding: "80px 20px 40px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ textAlign: "center", maxWidth: 660, margin: "0 auto 56px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#2563eb", marginBottom: 12 }}>{SPOTLIGHTS_HEADER.eyebrow}</div>
          <h2 style={{ fontSize: "clamp(28px,3.4vw,40px)", lineHeight: 1.15, fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 12px" }}>{SPOTLIGHTS_HEADER.title}</h2>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: "#475569", margin: 0 }}>{SPOTLIGHTS_HEADER.subtitle}</p>
        </div>

        {SPOTLIGHTS.map((s, i) => {
          const mockupFirst = i % 2 === 1; // alternado: texto/mockup, mockup/texto…
          const last = i === SPOTLIGHTS.length - 1;
          return (
            <div
              key={s.id}
              style={{
                display: "flex",
                // wrap-reverse cuando el mockup va primero: en móvil el TEXTO
                // queda arriba en todas las filas (igual que el reference).
                flexWrap: mockupFirst ? "wrap-reverse" : "wrap",
                gap: 40,
                alignItems: "center",
                marginBottom: last ? 24 : 72,
              }}
            >
              {mockupFirst && (
                <div aria-hidden="true" style={{ flex: "1 1 380px", minWidth: 300 }}>{MOCKUPS[s.mockup]}</div>
              )}
              <div style={{ flex: "1 1 320px", minWidth: 300 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", borderRadius: 999, padding: "6px 13px", marginBottom: 14 }}>{s.badge}</div>
                <h3 style={{ fontSize: "clamp(24px,2.6vw,30px)", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.2, margin: "0 0 12px" }}>{s.title}</h3>
                <p style={{ fontSize: 16, lineHeight: 1.6, color: "#475569", margin: "0 0 18px" }}>{s.desc}</p>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10, fontSize: 15, color: "#334155" }}>
                  {s.bullets.map((b) => (
                    <li key={b} style={{ display: "flex", gap: 10 }}>
                      <span style={{ color: "#2563eb", fontWeight: 800 }}>✓</span> {b}
                    </li>
                  ))}
                </ul>
                {"disclaimer" in s && s.disclaimer && (
                  <p style={{ fontSize: 13, color: "#94a3b8", margin: "14px 0 0" }}>{s.disclaimer}</p>
                )}
              </div>
              {!mockupFirst && (
                <div aria-hidden="true" style={{ flex: "1 1 380px", minWidth: 300 }}>{MOCKUPS[s.mockup]}</div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
