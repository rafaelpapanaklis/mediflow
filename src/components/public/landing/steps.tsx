"use client";

import { useState, type ReactNode } from "react";

const MONO = "var(--font-jetbrains-mono, ui-monospace, monospace)";
const SORA = "var(--font-sora, 'Sora', sans-serif)";

type Step = {
  num: string;
  title: string;
  desc: string;
  visual: ReactNode;
};

export function Steps() {
  const [active, setActive] = useState(0);

  const steps: Step[] = [
    {
      num: "01",
      title: "Configura tu clínica en 15 minutos",
      desc: "Importamos tus pacientes desde Excel, Dentrix, o el sistema que uses hoy. Sin perder datos, sin fricciones.",
      visual: (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            "Importar pacientes (1,247)",
            "Configurar agenda",
            "Conectar WhatsApp Business",
            "Subir tu RFC y CSD",
          ].map((s, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                background: "rgba(52,211,153,0.08)",
                border: "1px solid rgba(52,211,153,0.2)",
                fontSize: 12,
              }}
            >
              <span style={{ color: "#34d399" }}>✓</span>
              <span style={{ color: "var(--ld-fg)" }}>{s}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      num: "02",
      title: "Tu equipo empieza a usarla el primer día",
      desc: "Interfaz intuitiva. Sin manual. Tu recepcionista, higienistas y médicos se adaptan en horas, no en semanas.",
      visual: (
        <div style={{ position: "relative" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 8,
            }}
          >
            {[
              { role: "Recepción", icon: "📞" },
              { role: "Doctores", icon: "👩‍⚕️" },
              { role: "Admin", icon: "📊" },
            ].map((r, i) => (
              <div
                key={i}
                style={{
                  padding: 14,
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 22, marginBottom: 8 }}>{r.icon}</div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--ld-fg-muted)",
                    marginBottom: 4,
                  }}
                >
                  Rol
                </div>
                <div style={{ fontSize: 13, color: "var(--ld-fg)", fontWeight: 500 }}>
                  {r.role}
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 8,
              background: "rgba(124,58,237,0.08)",
              border: "1px solid rgba(124,58,237,0.2)",
              fontSize: 12,
              color: "var(--ld-fg-muted)",
            }}
          >
            Permisos granulares por rol · auditoría completa
          </div>
        </div>
      ),
    },
    {
      num: "03",
      title: "Atiende, factura y fideliza",
      desc: "Todo conectado. Cobras → se timbra CFDI → se envía al paciente → se registra en expediente. Sin tocar nada dos veces.",
      visual: (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            { t: "10:00", ev: "Consulta inicia", c: "#a78bfa" },
            { t: "10:45", ev: "Procedimiento registrado", c: "#a78bfa" },
            { t: "10:48", ev: "Pago recibido · $928", c: "#34d399" },
            { t: "10:48", ev: "CFDI 4.0 timbrado", c: "#34d399" },
            { t: "10:49", ev: "Factura enviada por WhatsApp", c: "#25d366" },
          ].map((e, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "50px 14px 1fr",
                gap: 10,
                alignItems: "center",
                fontSize: 12,
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  color: "var(--ld-fg-muted)",
                  fontSize: 10,
                }}
              >
                {e.t}
              </span>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 8,
                  background: e.c,
                  boxShadow: `0 0 8px ${e.c}80`,
                }}
              />
              <span style={{ color: "var(--ld-fg)" }}>{e.ev}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      num: "04",
      title: "Escala con confianza",
      desc: "Segunda sucursal. Tercera. Quinta. MediFlow crece contigo. Reportes consolidados, agenda unificada, inventario por ubicación.",
      visual: (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {["Polanco", "Roma", "Del Valle", "+2"].map((b, i) => (
              <div
                key={i}
                style={{
                  padding: "6px 12px",
                  borderRadius: 100,
                  background:
                    i === 0 ? "rgba(124,58,237,0.15)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${
                    i === 0 ? "rgba(124,58,237,0.3)" : "rgba(255,255,255,0.06)"
                  }`,
                  fontSize: 11,
                  color: i === 0 ? "#a78bfa" : "var(--ld-fg-muted)",
                }}
              >
                {b}
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {(
              [
                ["Ingresos 5 sucursales", "$1.2M", "#a78bfa"],
                ["Pacientes atendidos", "4,284", "#34d399"],
                ["Ocupación promedio", "87%", "#fbbf24"],
                ["Retención", "94%", "#38bdf8"],
              ] as const
            ).map(([l, v, c], i) => (
              <div
                key={i}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <div style={{ fontSize: 10, color: "var(--ld-fg-muted)" }}>{l}</div>
                <div
                  style={{
                    fontFamily: SORA,
                    fontWeight: 600,
                    fontSize: 20,
                    color: c,
                    marginTop: 4,
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>
        </div>
      ),
    },
  ];

  return (
    <section
      style={{
        position: "relative",
        padding: "120px 48px",
        maxWidth: 1280,
        margin: "0 auto",
      }}
    >
      <style>{`
        @media (max-width: 900px) {
          .ld-steps-grid {
            grid-template-columns: 1fr !important;
            gap: 24px !important;
          }
          .ld-steps-section {
            padding: 72px 20px !important;
          }
          .ld-steps-title {
            font-size: 34px !important;
          }
        }
      `}</style>

      <div className="ld-steps-section">
        <div style={{ maxWidth: 640, marginBottom: 64 }}>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 11,
              color: "var(--ld-brand-light)",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            Cómo funciona
          </div>
          <h2
            className="ld-steps-title"
            style={{
              fontFamily: SORA,
              fontWeight: 600,
              fontSize: 48,
              letterSpacing: "-0.035em",
              lineHeight: 1.05,
              margin: 0,
              color: "var(--ld-fg)",
            }}
          >
            De tu primera cita a tu quinta sucursal.
          </h2>
        </div>

        <div
          className="ld-steps-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.2fr",
            gap: 48,
            alignItems: "flex-start",
          }}
        >
          {/* Steps nav */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {steps.map((s, i) => (
              <div
                key={i}
                onClick={() => setActive(i)}
                onMouseEnter={() => setActive(i)}
                style={{
                  padding: "20px 24px",
                  borderRadius: 12,
                  cursor: "pointer",
                  background:
                    active === i
                      ? "linear-gradient(180deg, rgba(124,58,237,0.12), rgba(124,58,237,0.03))"
                      : "transparent",
                  border: `1px solid ${
                    active === i ? "rgba(124,58,237,0.3)" : "transparent"
                  }`,
                  transition: "all 0.3s",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 12,
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      color: active === i ? "#a78bfa" : "var(--ld-fg-muted)",
                    }}
                  >
                    {s.num}
                  </span>
                  <span
                    style={{
                      fontFamily: SORA,
                      fontWeight: 500,
                      fontSize: 17,
                      color: active === i ? "var(--ld-fg)" : "var(--ld-fg-muted)",
                      letterSpacing: "-0.015em",
                    }}
                  >
                    {s.title}
                  </span>
                </div>
                {active === i && (
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--ld-fg-muted)",
                      lineHeight: 1.55,
                      paddingLeft: 28,
                      marginTop: 10,
                    }}
                  >
                    {s.desc}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Visual panel */}
          <div
            style={{
              padding: 32,
              borderRadius: 16,
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.005))",
              border: "1px solid var(--ld-border)",
              minHeight: 400,
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: "var(--ld-fg-muted)",
                marginBottom: 20,
                letterSpacing: "0.08em",
              }}
            >
              PASO {steps[active].num}
            </div>
            {steps[active].visual}
          </div>
        </div>
      </div>
    </section>
  );
}
