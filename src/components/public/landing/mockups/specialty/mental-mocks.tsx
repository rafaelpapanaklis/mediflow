import React from "react";
import { MockShell, SectionTitle, Tag, Row, Dot } from "./mock-shell";

// ─── PSICO (DAP + scales) ────────────────────────────────────────────────────
export const PsicoMock: React.FC = () => (
  <MockShell title="Nota DAP · Sesión 12" accent="#38bdf8">
    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 12 }}>
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid var(--app-border)",
        }}
      >
        <Row style={{ marginBottom: 10 }}>
          <SectionTitle>Sesión 12 de 20</SectionTitle>
          <Tag color="#38bdf8">TCC</Tag>
        </Row>
        {(
          [
            [
              "D",
              "Datos",
              "Paciente refiere disminución de insomnio. Practica higiene del sueño desde sesión 10.",
            ],
            [
              "A",
              "Análisis",
              "Avance significativo en reestructuración cognitiva. Automatismos negativos reducidos.",
            ],
            [
              "P",
              "Plan",
              "Continuar registro automático. Introducir exposición gradual en sesión 13.",
            ],
          ] as const
        ).map(([l, t, c]) => (
          <div
            key={l}
            style={{
              display: "grid",
              gridTemplateColumns: "26px 1fr",
              gap: 8,
              padding: "8px 0",
              borderBottom: "1px dashed var(--app-border)",
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                background: "rgba(56,189,248,0.2)",
                display: "grid",
                placeItems: "center",
                fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                fontWeight: 600,
                fontSize: 10,
                color: "#38bdf8",
              }}
            >
              {l}
            </div>
            <div>
              <div
                style={{
                  fontSize: 9,
                  color: "var(--fg-muted)",
                  marginBottom: 2,
                  fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
                  textTransform: "uppercase",
                }}
              >
                {t}
              </div>
              <div style={{ fontSize: 11, color: "var(--fg)", lineHeight: 1.5 }}>{c}</div>
            </div>
          </div>
        ))}
      </div>
      <div>
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "rgba(56,189,248,0.06)",
            border: "1px solid rgba(56,189,248,0.2)",
            marginBottom: 10,
          }}
        >
          <Row>
            <SectionTitle>PHQ-9 · evolución</SectionTitle>
            <Tag color="#38bdf8">Leve</Tag>
          </Row>
          <svg viewBox="0 0 200 60" style={{ width: "100%", marginTop: 8 }}>
            <polyline
              points="0,15 25,16 50,20 75,22 100,28 125,35 150,42 175,48 200,52"
              stroke="#38bdf8"
              strokeWidth="1.5"
              fill="none"
            />
            {(
              [
                [0, 15, "19"],
                [100, 28, "12"],
                [200, 52, "6"],
              ] as const
            ).map(([x, y, v], i) => (
              <g key={i}>
                <circle cx={x} cy={y} r="3" fill="#38bdf8" />
                <text
                  x={x}
                  y={y - 6}
                  textAnchor="middle"
                  fontSize="7"
                  fill="#38bdf8"
                  fontFamily="monospace"
                >
                  {v}
                </text>
              </g>
            ))}
          </svg>
          <Row
            style={{
              fontSize: 10,
              color: "var(--fg-muted)",
              justifyContent: "space-between",
              marginTop: 4,
            }}
          >
            <span>Inicio (mod-grave)</span>
            <span style={{ color: "#34d399" }}>Actual: leve</span>
          </Row>
        </div>
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid var(--app-border)",
          }}
        >
          <SectionTitle>Tareas asignadas</SectionTitle>
          {["Registro de pensamientos", "Respiración diafragmática", "Diario de sueño"].map(
            (t) => (
              <Row key={t} style={{ padding: "5px 0", fontSize: 11 }}>
                <Dot c="#38bdf8" />
                <span style={{ flex: 1 }}>{t}</span>
                <span
                  style={{
                    fontSize: 9,
                    color: "var(--fg-muted)",
                    fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
                  }}
                >
                  6/7 d
                </span>
              </Row>
            )
          )}
        </div>
      </div>
    </div>
  </MockShell>
);

// ─── PSIQ ────────────────────────────────────────────────────────────────────
export const PsiqMock: React.FC = () => (
  <MockShell title="Receta controlada · Grupo II" accent="#38bdf8">
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid var(--app-border)",
        }}
      >
        <Row style={{ marginBottom: 10 }}>
          <SectionTitle>Receta #COF-24-0391</SectionTitle>
          <Tag color="#38bdf8">Grupo II</Tag>
        </Row>
        <div
          style={{
            fontSize: 11,
            color: "var(--fg)",
            lineHeight: 1.6,
            padding: "10px 0",
            borderTop: "1px dashed var(--app-border)",
            borderBottom: "1px dashed var(--app-border)",
          }}
        >
          <div>
            <strong style={{ color: "#38bdf8" }}>Metilfenidato</strong> 10 mg
          </div>
          <div style={{ color: "var(--fg-muted)", fontSize: 10.5, marginTop: 2 }}>
            1 tableta c/24h VO x 30 días
          </div>
        </div>
        <Row
          style={{
            marginTop: 10,
            padding: 8,
            borderRadius: 6,
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.2)",
          }}
        >
          <div style={{ fontSize: 20 }}>⚠</div>
          <div style={{ fontSize: 10.5, color: "var(--fg-muted)", lineHeight: 1.4 }}>
            Paciente en ISRS (Sertralina). Monitorear PA y FC.
          </div>
        </Row>
        <Row style={{ marginTop: 10, gap: 6 }}>
          <Tag color="#38bdf8">COFEPRIS #24-0391</Tag>
          <Tag color="#34d399">Firma digital ✓</Tag>
        </Row>
      </div>
      <div>
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "rgba(56,189,248,0.06)",
            border: "1px solid rgba(56,189,248,0.2)",
            marginBottom: 10,
          }}
        >
          <SectionTitle>Adherencia del paciente</SectionTitle>
          <div
            style={{
              fontFamily: "var(--font-sora, 'Sora', sans-serif)",
              fontWeight: 700,
              fontSize: 30,
              color: "#38bdf8",
              marginTop: 4,
            }}
          >
            92%
          </div>
          <div style={{ fontSize: 10, color: "var(--fg-muted)" }}>
            28/30 días registrados · últimos 30 d
          </div>
        </div>
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid var(--app-border)",
          }}
        >
          <Row style={{ marginBottom: 8 }}>
            <SectionTitle>Reporte COFEPRIS · abril</SectionTitle>
            <Tag color="#34d399">Listo</Tag>
          </Row>
          <Row style={{ fontSize: 11, color: "var(--fg-muted)" }}>
            <span>Recetas Grupo II</span>
            <span style={{ marginLeft: "auto", color: "var(--fg)" }}>18</span>
          </Row>
          <Row style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 4 }}>
            <span>Recetas Grupo III</span>
            <span style={{ marginLeft: "auto", color: "var(--fg)" }}>7</span>
          </Row>
        </div>
      </div>
    </div>
  </MockShell>
);
