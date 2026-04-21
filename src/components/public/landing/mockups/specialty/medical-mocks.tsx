import React from "react";
import { MockShell, SectionTitle, Tag, Row, Dot } from "./mock-shell";

// ─── MEDICAL: General (SOAP note) ────────────────────────────────────────────
export const GeneralMock: React.FC = () => (
  <MockShell title="Nota clínica · Consulta 15 abr" accent="#34d399">
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid var(--app-border)",
        }}
      >
        <Row style={{ marginBottom: 12 }}>
          <SectionTitle>SOAP</SectionTitle>
          <Tag color="#34d399">NOM-024 ✓</Tag>
        </Row>
        {(
          [
            [
              "S",
              "Subjetivo",
              "Paciente femenina 34 a. refiere cefalea occipital de 3 días, intensidad 6/10, sin aura. Niega vómito, fotofobia leve.",
            ],
            [
              "O",
              "Objetivo",
              "TA 128/82, FC 76, T° 36.7, SatO₂ 98%. Consciente, orientada. Pares craneales sin alteración.",
            ],
            ["A", "Análisis", "Cefalea tensional vs. migraña sin aura. CIE-10: G44.2"],
            [
              "P",
              "Plan",
              "Paracetamol 500 mg c/8h VO x 3 d. Higiene del sueño. Control en 1 semana.",
            ],
          ] as const
        ).map(([l, t, c]) => (
          <div
            key={l}
            style={{
              display: "grid",
              gridTemplateColumns: "28px 1fr",
              gap: 10,
              padding: "8px 0",
              borderBottom: "1px dashed var(--app-border)",
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                background: "rgba(52,211,153,0.15)",
                display: "grid",
                placeItems: "center",
                color: "#34d399",
                fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                fontWeight: 600,
                fontSize: 11,
              }}
            >
              {l}
            </div>
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--fg-muted)",
                  marginBottom: 2,
                  fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {t}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--fg)", lineHeight: 1.45 }}>{c}</div>
            </div>
          </div>
        ))}
      </div>
      <div>
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "rgba(52,211,153,0.06)",
            border: "1px solid rgba(52,211,153,0.2)",
            marginBottom: 10,
          }}
        >
          <Row style={{ marginBottom: 8 }}>
            <SectionTitle>Receta electrónica</SectionTitle>
            <Tag color="#34d399">Firmada</Tag>
          </Row>
          <div style={{ fontSize: 11, color: "var(--fg)", marginBottom: 6 }}>
            💊 Paracetamol 500 mg
          </div>
          <div style={{ fontSize: 10, color: "var(--fg-muted)", marginBottom: 8 }}>
            1 tableta c/8 h VO · 3 días
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <div
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                background: "rgba(255,255,255,0.04)",
                fontSize: 9,
                fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
              }}
            >
              QR verificable
            </div>
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
          <SectionTitle>Signos vitales · últimos 6</SectionTitle>
          <svg viewBox="0 0 200 60" style={{ width: "100%", marginTop: 8 }}>
            <polyline
              points="0,30 40,32 80,28 120,35 160,30 200,28"
              stroke="#34d399"
              strokeWidth="1.5"
              fill="none"
            />
            <polyline
              points="0,40 40,42 80,38 120,44 160,40 200,38"
              stroke="#38bdf8"
              strokeWidth="1.5"
              fill="none"
              opacity="0.6"
            />
          </svg>
          <Row style={{ fontSize: 9, color: "var(--fg-muted)", marginTop: 6, gap: 10 }}>
            <Row>
              <Dot c="#34d399" />
              TA sist.
            </Row>
            <Row>
              <Dot c="#38bdf8" />
              TA diast.
            </Row>
          </Row>
        </div>
      </div>
    </div>
  </MockShell>
);

// ─── MEDICAL: Derma ──────────────────────────────────────────────────────────
export const DermaMock: React.FC = () => {
  const BodyMap = () => (
    <svg viewBox="0 0 100 180" style={{ width: 120, height: "auto" }}>
      <path
        d="M50 10 a10 10 0 0 1 0 20 a10 10 0 0 1 0 -20 M40 30 L60 30 L66 60 L70 100 L66 105 L60 95 L60 140 L54 170 L46 170 L40 140 L40 95 L34 105 L30 100 L34 60 Z"
        fill="rgba(52,211,153,0.08)"
        stroke="rgba(52,211,153,0.4)"
        strokeWidth="0.5"
      />
      <circle cx="44" cy="48" r="2" fill="#ef4444" />
      <circle cx="58" cy="65" r="2" fill="#fbbf24" />
      <circle cx="50" cy="90" r="2" fill="#34d399" />
    </svg>
  );
  return (
    <MockShell title="Dermatología · Galería" accent="#34d399">
      <div style={{ display: "grid", gridTemplateColumns: "0.7fr 1.6fr", gap: 12 }}>
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid var(--app-border)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <SectionTitle>Mapa corporal</SectionTitle>
          <div style={{ marginTop: 10 }}>
            <BodyMap />
          </div>
          <Row
            style={{
              fontSize: 9,
              color: "var(--fg-muted)",
              marginTop: 10,
              flexWrap: "wrap",
              gap: 6,
              justifyContent: "center",
            }}
          >
            <Row>
              <Dot c="#ef4444" />
              Nevos
            </Row>
            <Row>
              <Dot c="#fbbf24" />
              Lesiones
            </Row>
            <Row>
              <Dot c="#34d399" />
              Sanas
            </Row>
          </Row>
        </div>
        <div>
          <Row style={{ marginBottom: 8 }}>
            <SectionTitle>Tratamiento facial · 6 sesiones</SectionTitle>
            <Tag color="#34d399">Sesión 4/6</Tag>
          </Row>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {(
              [
                ["Inicio · 15 ENE", 0.8],
                ["Sesión actual · 22 ABR", 0.3],
              ] as const
            ).map(([l, intensity]) => (
              <div key={l}>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--fg-muted)",
                    marginBottom: 4,
                    fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
                  }}
                >
                  {l}
                </div>
                <div
                  style={{
                    aspectRatio: "1.1",
                    borderRadius: 8,
                    position: "relative",
                    overflow: "hidden",
                    background: `linear-gradient(135deg, hsl(20, ${30 * intensity}%, ${50 - intensity * 15}%), hsl(30, ${20 * intensity}%, ${55 - intensity * 10}%))`,
                    border: "1px solid var(--app-border)",
                  }}
                >
                  <svg viewBox="0 0 100 90" style={{ width: "100%", height: "100%" }}>
                    <ellipse
                      cx="50"
                      cy="45"
                      rx="28"
                      ry="36"
                      fill="rgba(255,255,255,0.1)"
                      stroke="rgba(255,255,255,0.2)"
                      strokeWidth="0.5"
                    />
                    {(
                      [
                        [40, 35, 2],
                        [58, 40, 1.8],
                        [44, 55, 1.5],
                        [55, 60, 2.2],
                      ] as const
                    ).map(([x, y, r], i) => (
                      <circle
                        key={i}
                        cx={x}
                        cy={y}
                        r={r * intensity}
                        fill="#c97559"
                        opacity={intensity}
                      />
                    ))}
                    <circle cx="42" cy="42" r="1" fill="rgba(255,255,255,0.5)" />
                    <circle cx="58" cy="42" r="1" fill="rgba(255,255,255,0.5)" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: 10,
              padding: 10,
              borderRadius: 8,
              background: "rgba(52,211,153,0.06)",
              border: "1px solid rgba(52,211,153,0.2)",
              fontSize: 11,
            }}
          >
            <Row>
              <Tag color="#34d399">Mejora 62%</Tag>
              <span style={{ marginLeft: "auto", color: "var(--fg-muted)", fontSize: 10 }}>
                Melasma grado II → I
              </span>
            </Row>
          </div>
          <Row style={{ marginTop: 8, gap: 6 }}>
            {["Peel 30%", "Vit. C tópica", "Fotoprotección SPF50+"].map((t) => (
              <Tag key={t} color="#34d399">
                {t}
              </Tag>
            ))}
          </Row>
        </div>
      </div>
    </MockShell>
  );
};

// ─── CARDIO ──────────────────────────────────────────────────────────────────
export const CardioMock: React.FC = () => (
  <MockShell title="EKG · Paciente J.P.M." accent="#34d399">
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid var(--app-border)",
        }}
      >
        <Row style={{ marginBottom: 10 }}>
          <SectionTitle>Derivación II · 12 derivaciones</SectionTitle>
          <Tag color="#34d399">Ritmo sinusal</Tag>
        </Row>
        <svg
          viewBox="0 0 300 80"
          style={{ width: "100%", background: "#0a0a12", borderRadius: 6 }}
        >
          <defs>
            <pattern id="ekggrid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path
                d="M 10 0 L 0 0 0 10"
                fill="none"
                stroke="rgba(239,68,68,0.15)"
                strokeWidth="0.3"
              />
            </pattern>
          </defs>
          <rect width="300" height="80" fill="url(#ekggrid)" />
          <polyline
            points="0,40 20,40 25,38 28,42 30,25 32,55 34,42 36,40 60,40 65,38 68,42 70,25 72,55 74,42 76,40 100,40 105,38 108,42 110,25 112,55 114,42 116,40 140,40 145,38 148,42 150,25 152,55 154,42 156,40 180,40 185,38 188,42 190,25 192,55 194,42 196,40 220,40 225,38 228,42 230,25 232,55 234,42 236,40 260,40 265,38 268,42 270,25 272,55 274,42 276,40 300,40"
            stroke="#34d399"
            strokeWidth="1.2"
            fill="none"
          />
        </svg>
      </div>
      <div>
        {(
          [
            ["Frecuencia", "72 lpm", "#34d399"],
            ["PR", "160 ms", "#34d399"],
            ["QRS", "88 ms", "#34d399"],
            ["QT", "380 ms", "#34d399"],
          ] as const
        ).map(([l, v, c]) => (
          <Row
            key={l}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid var(--app-border)",
              marginBottom: 6,
            }}
          >
            <span style={{ flex: 1, fontSize: 11, color: "var(--fg-muted)" }}>{l}</span>
            <span
              style={{
                fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
                color: c,
                fontSize: 12,
              }}
            >
              {v}
            </span>
          </Row>
        ))}
        <div
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 8,
            background: "rgba(52,211,153,0.06)",
            border: "1px solid rgba(52,211,153,0.2)",
          }}
        >
          <SectionTitle>CHA₂DS₂-VASc</SectionTitle>
          <div
            style={{
              fontFamily: "var(--font-sora, 'Sora', sans-serif)",
              fontWeight: 700,
              fontSize: 28,
              color: "#34d399",
              marginTop: 4,
            }}
          >
            2
          </div>
          <div style={{ fontSize: 10, color: "var(--fg-muted)" }}>Riesgo anual ACV: 2.2%</div>
        </div>
      </div>
    </div>
  </MockShell>
);

// ─── GINECO (Prenatal) ───────────────────────────────────────────────────────
export const GinecoMock: React.FC = () => (
  <MockShell title="Control prenatal · Semana 28" accent="#34d399">
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid var(--app-border)",
        }}
      >
        <Row style={{ marginBottom: 12 }}>
          <SectionTitle>Crecimiento fetal</SectionTitle>
          <Tag color="#34d399">Adecuado</Tag>
        </Row>
        <svg viewBox="0 0 200 120" style={{ width: "100%" }}>
          {[
            { y1: 95, y2: 30, c: "rgba(255,255,255,0.1)" },
            { y1: 80, y2: 45, c: "rgba(52,211,153,0.25)" },
            { y1: 70, y2: 55, c: "rgba(52,211,153,0.4)" },
          ].map((p, i) => (
            <path
              key={i}
              d={`M0 ${p.y1} Q100 ${(p.y1 + p.y2) / 2} 200 ${p.y2}`}
              fill="none"
              stroke={p.c}
              strokeWidth={i === 1 ? 1.5 : 1}
              strokeDasharray={i === 2 ? "2,2" : "none"}
            />
          ))}
          {(
            [
              [20, 82],
              [50, 74],
              [90, 65],
              [130, 58],
              [170, 52],
            ] as const
          ).map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="3" fill="#34d399" />
              <circle
                cx={x}
                cy={y}
                r="6"
                fill="none"
                stroke="#34d399"
                strokeOpacity="0.3"
                strokeWidth="1"
              />
            </g>
          ))}
          <text x="5" y="15" fill="rgba(255,255,255,0.4)" fontSize="7" fontFamily="monospace">
            P90
          </text>
          <text x="5" y="110" fill="rgba(255,255,255,0.4)" fontSize="7" fontFamily="monospace">
            P10
          </text>
        </svg>
        <Row style={{ fontSize: 10, color: "var(--fg-muted)", marginTop: 8 }}>
          Peso fetal estimado:{" "}
          <strong style={{ color: "#34d399", marginLeft: 4 }}>1,150 g · P50</strong>
        </Row>
      </div>

      <div>
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid var(--app-border)",
            marginBottom: 8,
          }}
        >
          <Row>
            <SectionTitle>USG · 28 sem</SectionTitle>
            <Tag color="#34d399">Nuevo</Tag>
          </Row>
          <div
            style={{
              marginTop: 8,
              aspectRatio: "1.4",
              borderRadius: 8,
              background: "radial-gradient(ellipse at center, #2a2a40, #0a0a12)",
              position: "relative",
              overflow: "hidden",
              border: "1px solid var(--app-border)",
            }}
          >
            <svg viewBox="0 0 100 70" style={{ width: "100%", height: "100%" }}>
              <path
                d="M20 20 Q50 10 80 20 L85 45 Q50 65 15 45 Z"
                fill="rgba(255,255,255,0.1)"
                stroke="rgba(255,255,255,0.3)"
                strokeWidth="0.5"
              />
              <ellipse cx="45" cy="38" rx="12" ry="10" fill="rgba(255,255,255,0.25)" />
              <circle cx="55" cy="30" r="7" fill="rgba(255,255,255,0.3)" />
              <path
                d="M48 30 Q52 28 56 30"
                stroke="rgba(255,255,255,0.1)"
                strokeWidth="0.3"
                fill="none"
              />
            </svg>
            <div
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                padding: "1px 6px",
                borderRadius: 3,
                background: "rgba(52,211,153,0.8)",
                color: "white",
                fontSize: 8,
                fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
              }}
            >
              28w 2d
            </div>
          </div>
        </div>
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "rgba(52,211,153,0.06)",
            border: "1px solid rgba(52,211,153,0.2)",
          }}
        >
          <SectionTitle>Próxima consulta</SectionTitle>
          <div style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 4 }}>
            2 mayo · USG anatómico · glucosa
          </div>
          <div
            style={{
              marginTop: 8,
              height: 4,
              borderRadius: 4,
              background: "rgba(255,255,255,0.06)",
            }}
          >
            <div
              style={{ width: "70%", height: "100%", background: "#34d399", borderRadius: 4 }}
            />
          </div>
          <div style={{ fontSize: 9, color: "var(--fg-muted)", marginTop: 4 }}>
            28/40 semanas
          </div>
        </div>
      </div>
    </div>
  </MockShell>
);

// ─── PEDS ────────────────────────────────────────────────────────────────────
export const PedsMock: React.FC = () => (
  <MockShell title="Curva crecimiento · Mateo · 3a 4m" accent="#34d399">
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid var(--app-border)",
        }}
      >
        <Row style={{ marginBottom: 10 }}>
          <SectionTitle>Peso para la edad · OMS</SectionTitle>
          <Tag color="#34d399">P50</Tag>
        </Row>
        <svg viewBox="0 0 240 130" style={{ width: "100%" }}>
          {[
            { y: 20, l: "P97" },
            { y: 40, l: "P75" },
            { y: 60, l: "P50" },
            { y: 80, l: "P25" },
            { y: 100, l: "P3" },
          ].map((p, i) => (
            <g key={p.l}>
              <path
                d={`M20 ${p.y - 5} Q130 ${p.y + 10} 240 ${p.y + 25}`}
                stroke={i === 2 ? "#34d399" : "rgba(255,255,255,0.12)"}
                strokeWidth={i === 2 ? 1.2 : 0.8}
                fill="none"
                strokeDasharray={i === 2 ? "none" : "2,2"}
              />
              <text
                x="5"
                y={p.y}
                fill="rgba(255,255,255,0.4)"
                fontSize="6"
                fontFamily="monospace"
              >
                {p.l}
              </text>
            </g>
          ))}
          {(
            [
              [25, 85],
              [55, 78],
              [95, 72],
              [135, 68],
              [180, 66],
              [220, 65],
            ] as const
          ).map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="2.5" fill="#34d399" />
            </g>
          ))}
          <text x="20" y="128" fill="rgba(255,255,255,0.4)" fontSize="6" fontFamily="monospace">
            0
          </text>
          <text x="230" y="128" fill="rgba(255,255,255,0.4)" fontSize="6" fontFamily="monospace">
            5a
          </text>
        </svg>
      </div>
      <div>
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "rgba(52,211,153,0.06)",
            border: "1px solid rgba(52,211,153,0.2)",
            marginBottom: 10,
          }}
        >
          <SectionTitle>Próximas vacunas</SectionTitle>
          {["Triple viral (1a refuerzo)", "Hepatitis A (2a)", "DPT (4a refuerzo)"].map((v) => (
            <Row
              key={v}
              style={{
                padding: "5px 0",
                fontSize: 11,
                borderBottom: "1px dashed var(--app-border)",
              }}
            >
              <Dot c="#34d399" />
              <span>{v}</span>
            </Row>
          ))}
        </div>
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid var(--app-border)",
          }}
        >
          <SectionTitle>Hitos del desarrollo</SectionTitle>
          {(
            [
              ["Frases de 3 palabras", "✓ 2a 6m"],
              ["Salta en un pie", "✓ 3a 1m"],
              ["Reconoce colores", "En evaluación"],
            ] as const
          ).map(([h, e]) => (
            <Row key={h} style={{ padding: "5px 0", fontSize: 11 }}>
              <span style={{ flex: 1 }}>{h}</span>
              <span
                style={{
                  color: e.startsWith("✓") ? "#34d399" : "var(--fg-muted)",
                  fontSize: 10,
                  fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
                }}
              >
                {e}
              </span>
            </Row>
          ))}
        </div>
      </div>
    </div>
  </MockShell>
);

// ─── OFTALMO ─────────────────────────────────────────────────────────────────
export const OftalmoMock: React.FC = () => (
  <MockShell title="Examen visual · Luis G." accent="#34d399">
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
          <SectionTitle>Agudeza visual · Snellen</SectionTitle>
        </Row>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {(
            [
              ["OD s/c", "20/60"],
              ["OI s/c", "20/80"],
              ["OD c/c", "20/20"],
              ["OI c/c", "20/25"],
            ] as const
          ).map(([l, v]) => (
            <div
              key={l}
              style={{
                padding: 10,
                borderRadius: 8,
                background: "rgba(52,211,153,0.06)",
                border: "1px solid rgba(52,211,153,0.2)",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: "var(--fg-muted)",
                  fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
                }}
              >
                {l}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                  fontWeight: 700,
                  fontSize: 22,
                  color: "#34d399",
                }}
              >
                {v}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 8,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid var(--app-border)",
          }}
        >
          <SectionTitle>PIO</SectionTitle>
          <Row style={{ marginTop: 6 }}>
            <div style={{ fontSize: 11, color: "var(--fg-muted)" }}>OD</div>
            <div
              style={{
                flex: 1,
                height: 6,
                borderRadius: 4,
                background: "rgba(255,255,255,0.04)",
              }}
            >
              <div
                style={{
                  width: "35%",
                  height: "100%",
                  background: "#34d399",
                  borderRadius: 4,
                }}
              />
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#34d399",
                fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
              }}
            >
              14 mmHg
            </div>
          </Row>
          <Row style={{ marginTop: 6 }}>
            <div style={{ fontSize: 11, color: "var(--fg-muted)" }}>OI</div>
            <div
              style={{
                flex: 1,
                height: 6,
                borderRadius: 4,
                background: "rgba(255,255,255,0.04)",
              }}
            >
              <div
                style={{
                  width: "40%",
                  height: "100%",
                  background: "#34d399",
                  borderRadius: 4,
                }}
              />
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#34d399",
                fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
              }}
            >
              16 mmHg
            </div>
          </Row>
        </div>
      </div>
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid var(--app-border)",
        }}
      >
        <SectionTitle>Receta óptica</SectionTitle>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "0.6fr 1fr 1fr 1fr 1fr",
            gap: 4,
            marginTop: 10,
            fontSize: 10,
            fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
          }}
        >
          <div style={{ color: "var(--fg-muted)" }}></div>
          <div style={{ color: "var(--fg-muted)" }}>ESF</div>
          <div style={{ color: "var(--fg-muted)" }}>CIL</div>
          <div style={{ color: "var(--fg-muted)" }}>EJE</div>
          <div style={{ color: "var(--fg-muted)" }}>ADD</div>
          {(
            [
              ["OD", "−2.25", "−0.50", "175", "+1.50"],
              ["OI", "−2.50", "−0.75", "5", "+1.50"],
            ] as const
          ).map((row) => (
            <React.Fragment key={row[0]}>
              <div style={{ color: "#34d399" }}>{row[0]}</div>
              {row.slice(1).map((c, i) => (
                <div
                  key={i}
                  style={{
                    padding: "4px 6px",
                    borderRadius: 4,
                    background: "rgba(52,211,153,0.08)",
                    color: "var(--fg)",
                  }}
                >
                  {c}
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 6,
            background: "rgba(52,211,153,0.06)",
            border: "1px solid rgba(52,211,153,0.2)",
            fontSize: 10.5,
          }}
        >
          Distancia interpupilar: <strong style={{ color: "#34d399" }}>62 mm</strong>
        </div>
        <Row style={{ marginTop: 10 }}>
          <Tag color="#34d399">PDF firmado</Tag>
          <Tag color="#25d366">WhatsApp</Tag>
        </Row>
      </div>
    </div>
  </MockShell>
);
