"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { MiniRadio } from "./mockups/mini-radio";

const MONO = "var(--font-jetbrains-mono, ui-monospace, monospace)";
const SORA = "var(--font-sora, 'Sora', sans-serif)";

type FeatureCardProps = {
  span?: number;
  children: ReactNode;
  style?: CSSProperties;
};

function FeatureCard({ span = 1, children, style = {} }: FeatureCardProps) {
  return (
    <div
      className="ld-feature-card"
      style={{
        gridColumn: `span ${span}`,
        borderRadius: 16,
        border: "1px solid var(--ld-border)",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.005))",
        padding: 28,
        overflow: "hidden",
        position: "relative",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

type FeatureLabelProps = {
  kicker: string;
  title: string;
  desc: string;
  color?: string;
};

function FeatureLabel({ kicker, title, desc, color = "#a78bfa" }: FeatureLabelProps) {
  return (
    <>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11,
          color,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        {kicker}
      </div>
      <div
        style={{
          fontFamily: SORA,
          fontWeight: 600,
          fontSize: 22,
          letterSpacing: "-0.02em",
          lineHeight: 1.15,
          marginBottom: 8,
          color: "var(--ld-fg)",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 14,
          color: "var(--ld-fg-muted)",
          lineHeight: 1.55,
          maxWidth: 380,
        }}
      >
        {desc}
      </div>
    </>
  );
}

function MiniAgenda() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setActive((a) => (a + 1) % 4), 1800);
    return () => clearInterval(id);
  }, []);
  const slots = [
    { t: "9:00", name: "M. Ramírez", type: "consulta" },
    { t: "10:30", name: "J. López", type: "limpieza" },
    { t: "12:00", name: "A. Pérez", type: "control" },
    { t: "14:00", name: "C. Silva", type: "endodoncia" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 20 }}>
      {slots.map((s, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "50px 1fr auto",
            padding: "10px 12px",
            borderRadius: 8,
            background:
              active === i ? "rgba(124,58,237,0.15)" : "rgba(255,255,255,0.02)",
            border: `1px solid ${
              active === i ? "rgba(124,58,237,0.3)" : "rgba(255,255,255,0.05)"
            }`,
            fontSize: 12,
            alignItems: "center",
            transition: "all 0.3s",
          }}
        >
          <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--ld-fg-muted)" }}>
            {s.t}
          </span>
          <span style={{ color: "var(--ld-fg)", fontWeight: 500 }}>{s.name}</span>
          <span
            style={{
              fontSize: 10,
              color: "var(--ld-fg-muted)",
              padding: "2px 8px",
              borderRadius: 100,
              background: "rgba(255,255,255,0.03)",
            }}
          >
            {s.type}
          </span>
        </div>
      ))}
    </div>
  );
}

function MiniOdonto() {
  return (
    <div
      style={{
        marginTop: 20,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        alignItems: "center",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 20px)", gap: 3 }}>
        {Array.from({ length: 16 }).map((_, i) => {
          const caries = [3, 11].includes(i);
          const empaste = [6, 9].includes(i);
          return (
            <div
              key={i}
              style={{
                width: 20,
                height: 24,
                borderRadius: "8px 8px 4px 4px",
                background: caries
                  ? "rgba(251,191,36,0.25)"
                  : empaste
                    ? "rgba(52,211,153,0.2)"
                    : "rgba(255,255,255,0.04)",
                border: `1px solid ${
                  caries
                    ? "rgba(251,191,36,0.5)"
                    : empaste
                      ? "rgba(52,211,153,0.5)"
                      : "rgba(255,255,255,0.1)"
                }`,
              }}
            />
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 20px)", gap: 3 }}>
        {Array.from({ length: 16 }).map((_, i) => {
          const caries = [4].includes(i);
          return (
            <div
              key={i}
              style={{
                width: 20,
                height: 24,
                borderRadius: "4px 4px 8px 8px",
                background: caries ? "rgba(251,191,36,0.25)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${
                  caries ? "rgba(251,191,36,0.5)" : "rgba(255,255,255,0.1)"
                }`,
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          fontSize: 10,
          color: "var(--ld-fg-muted)",
          marginTop: 4,
        }}
      >
        <span>● Sano</span>
        <span style={{ color: "#fbbf24" }}>● Caries</span>
        <span style={{ color: "#34d399" }}>● Empaste</span>
      </div>
    </div>
  );
}

function MiniInventory() {
  const items = [
    { name: "Anestesia lidocaína", stock: 12, max: 50, color: "#fbbf24" },
    { name: "Guantes látex", stock: 340, max: 500, color: "#34d399" },
    { name: "Gasas estériles", stock: 8, max: 100, color: "#ef4444" },
  ];
  return (
    <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((item, i) => (
        <div key={i} style={{ fontSize: 11 }}>
          <div
            style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}
          >
            <span style={{ color: "var(--ld-fg)" }}>{item.name}</span>
            <span style={{ color: item.color, fontFamily: MONO }}>
              {item.stock}/{item.max}
            </span>
          </div>
          <div
            style={{
              height: 4,
              borderRadius: 4,
              background: "rgba(255,255,255,0.05)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${(item.stock / item.max) * 100}%`,
                height: "100%",
                background: item.color,
                borderRadius: 4,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniReports() {
  const bars = [40, 65, 45, 80, 55, 90, 70];
  return (
    <div style={{ marginTop: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 11, color: "var(--ld-fg-muted)" }}>
          Ingresos · últimos 7 días
        </span>
        <span
          style={{
            fontFamily: SORA,
            fontSize: 18,
            fontWeight: 600,
            color: "var(--ld-fg)",
          }}
        >
          $184,320
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, height: 80, alignItems: "flex-end" }}>
        {bars.map((b, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${b}%`,
              background: "linear-gradient(180deg, #a78bfa, #7c3aed)",
              borderRadius: 4,
              opacity: 0.3 + (i / bars.length) * 0.7,
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 8,
          fontSize: 9,
          color: "var(--ld-fg-muted)",
          fontFamily: MONO,
        }}
      >
        <span>L</span>
        <span>M</span>
        <span>X</span>
        <span>J</span>
        <span>V</span>
        <span>S</span>
        <span>D</span>
      </div>
    </div>
  );
}

function MiniPortal() {
  const rows = ["Limpieza · 15 mar", "Control · 22 feb", "Radiografía · 8 ene"];
  return (
    <div
      style={{
        marginTop: 20,
        padding: 14,
        borderRadius: 10,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 32,
            background: "linear-gradient(135deg, #a78bfa, #7c3aed)",
          }}
        />
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--ld-fg)" }}>
            María González
          </div>
          <div style={{ fontSize: 10, color: "var(--ld-fg-muted)" }}>
            Próxima cita · mañana 10:00
          </div>
        </div>
      </div>
      <div style={{ fontSize: 10, color: "var(--ld-fg-muted)", marginBottom: 6 }}>
        HISTORIAL
      </div>
      {rows.map((h, i) => (
        <div
          key={i}
          style={{
            fontSize: 11,
            color: "var(--ld-fg)",
            padding: "4px 0",
            borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none",
          }}
        >
          {h}
        </div>
      ))}
    </div>
  );
}

export function Features() {
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
        @media (max-width: 768px) {
          .ld-features-grid {
            grid-template-columns: 1fr !important;
          }
          .ld-features-grid > .ld-feature-card {
            grid-column: span 1 !important;
          }
          .ld-features-section {
            padding: 72px 20px !important;
          }
          .ld-features-title {
            font-size: 34px !important;
          }
        }
      `}</style>

      <div
        className="ld-features-section"
        style={{ position: "relative" }}
      >
        <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 64px" }}>
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
            Todo en una plataforma
          </div>
          <h2
            className="ld-features-title"
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
            Reemplaza 6 herramientas
            <br />
            con <span style={{ color: "var(--ld-brand-light)" }}>una sola</span>.
          </h2>
          <p
            style={{
              fontSize: 17,
              color: "var(--ld-fg-muted)",
              marginTop: 20,
              lineHeight: 1.5,
            }}
          >
            Agenda, expediente, factura, inventario, radiografías y portal del paciente.
            Todo conectado, todo en tiempo real.
          </p>
        </div>

        <div
          className="ld-features-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: 16,
            gridAutoRows: "minmax(280px, auto)",
          }}
        >
          {/* 01 Agenda */}
          <FeatureCard span={3}>
            <FeatureLabel
              kicker="01 · Agenda"
              title="Citas con recordatorios por WhatsApp"
              desc="Tu equipo deja de llamar uno por uno. MediFlow envía confirmaciones y recordatorios automáticos, y el paciente responde con un tap."
            />
            <MiniAgenda />
          </FeatureCard>

          {/* 02 Facturación / CFDI */}
          <FeatureCard span={3}>
            <FeatureLabel
              kicker="02 · Facturación"
              title="CFDI 4.0 timbrado en 2 clicks"
              color="#34d399"
              desc="Conectado directamente al SAT. Generas factura al cobrar, sin cambiar de sistema ni subir archivos a otro portal."
            />
            <div
              style={{
                marginTop: 20,
                padding: 16,
                borderRadius: 10,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ld-fg-muted)",
                  fontFamily: MONO,
                  marginBottom: 10,
                }}
              >
                UUID: A1B2C3D4-E5F6-...
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <div>
                  <div style={{ fontSize: 10, color: "var(--ld-fg-muted)" }}>Emisor</div>
                  <div style={{ fontSize: 12, color: "var(--ld-fg)" }}>
                    Clínica Vida SA de CV
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--ld-fg-muted)" }}>
                    Receptor
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ld-fg)" }}>XAXX010101000</div>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  paddingTop: 8,
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <span style={{ fontSize: 11, color: "#34d399" }}>✓ Timbrada · Vigente</span>
                <span
                  style={{
                    fontSize: 12,
                    fontFamily: SORA,
                    fontWeight: 600,
                    color: "var(--ld-fg)",
                  }}
                >
                  $928.00 MXN
                </span>
              </div>
            </div>
          </FeatureCard>

          {/* 03 Odontograma */}
          <FeatureCard span={2}>
            <FeatureLabel
              kicker="03 · Dental"
              title="Odontograma interactivo"
              desc="Clickea, marca, anota. Diseñado para dentistas reales."
            />
            <MiniOdonto />
          </FeatureCard>

          {/* 04 Radiografías IA */}
          <FeatureCard
            span={2}
            style={{
              background:
                "linear-gradient(180deg, rgba(124,58,237,0.08), rgba(124,58,237,0.02))",
              border: "1px solid rgba(124,58,237,0.2)",
            }}
          >
            <FeatureLabel
              kicker="04 · IA"
              title="Análisis automático de radiografías"
              color="#fbbf24"
              desc="IA de última generación detecta caries, lesiones y anomalías."
            />
            <div style={{ marginTop: 20 }}>
              <MiniRadio />
            </div>
          </FeatureCard>

          {/* 05 Inventario */}
          <FeatureCard span={2}>
            <FeatureLabel
              kicker="05 · Inventario"
              title="Stock en tiempo real"
              color="#34d399"
              desc="Alertas automáticas antes de quedarte sin insumos."
            />
            <MiniInventory />
          </FeatureCard>

          {/* 06 Portal */}
          <FeatureCard span={2}>
            <FeatureLabel
              kicker="06 · Pacientes"
              title="Portal del paciente"
              desc="Tus pacientes agendan, pagan y consultan su historial — desde su teléfono."
            />
            <MiniPortal />
          </FeatureCard>

          {/* 07 Reportes */}
          <FeatureCard span={2}>
            <FeatureLabel
              kicker="07 · Reportes"
              title="Analytics que entiendes"
              desc="Ingresos, ocupación, retención — sin Excel."
            />
            <MiniReports />
          </FeatureCard>

          {/* 08 Landing */}
          <FeatureCard
            span={2}
            style={{
              background:
                "linear-gradient(180deg, rgba(52,211,153,0.06), rgba(52,211,153,0.01))",
              border: "1px solid rgba(52,211,153,0.15)",
            }}
          >
            <FeatureLabel
              kicker="08 · Landing"
              title="Página web para tu clínica"
              color="#34d399"
              desc="URL personalizada para que pacientes agenden online 24/7."
            />
            <div
              style={{
                marginTop: 20,
                padding: 14,
                borderRadius: 10,
                background: "#0a0a10",
                border: "1px solid rgba(255,255,255,0.05)",
                fontFamily: MONO,
                fontSize: 11,
              }}
            >
              <div style={{ color: "var(--ld-fg-muted)", marginBottom: 8 }}>
                tuClinica.mediflow.mx
              </div>
              <div
                style={{
                  padding: 10,
                  borderRadius: 6,
                  background: "rgba(52,211,153,0.1)",
                  color: "#34d399",
                  fontSize: 10,
                  textAlign: "center",
                }}
              >
                ✓ 12 reservas esta semana
              </div>
            </div>
          </FeatureCard>
        </div>
      </div>
    </section>
  );
}
