import React from "react";
import { MockShell, SectionTitle, Tag, Row, Dot } from "./mock-shell";

// ─── NUTRITION ───────────────────────────────────────────────────────────────
export const NutriMock: React.FC = () => (
  <MockShell title="Plan alimenticio · Ana R." accent="#fbbf24">
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
          <SectionTitle>Plan semanal</SectionTitle>
          <Tag color="#fbbf24">1,800 kcal</Tag>
        </Row>
        {(
          [
            ["Desayuno", "Avena con frutos rojos · yogurt griego", "420 kcal"],
            ["Colación 1", "1 manzana · 10 almendras", "180 kcal"],
            ["Comida", "Filete de res · arroz integral · ensalada", "580 kcal"],
            ["Colación 2", "Hummus con zanahoria", "160 kcal"],
            ["Cena", "Tortilla de huevo · espinacas salteadas", "460 kcal"],
          ] as const
        ).map(([m, d, k]) => (
          <Row
            key={m}
            style={{
              padding: "8px 0",
              borderBottom: "1px dashed var(--app-border)",
              fontSize: 11,
            }}
          >
            <div
              style={{
                width: 70,
                color: "#fbbf24",
                fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
                fontSize: 10,
              }}
            >
              {m}
            </div>
            <div style={{ flex: 1, color: "var(--fg)" }}>{d}</div>
            <div style={{ color: "var(--fg-muted)", fontSize: 10 }}>{k}</div>
          </Row>
        ))}
        <Row style={{ marginTop: 12, gap: 8 }}>
          <Tag color="#fbbf24">🍎 Lista súper</Tag>
          <Tag color="#fbbf24">📖 Recetario</Tag>
          <Tag color="#25d366">WhatsApp</Tag>
        </Row>
      </div>

      <div>
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid var(--app-border)",
            marginBottom: 10,
          }}
        >
          <SectionTitle>Evolución · 12 semanas</SectionTitle>
          <svg viewBox="0 0 200 80" style={{ width: "100%", marginTop: 8 }}>
            <defs>
              <linearGradient id="nutri-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polyline
              points="0,20 20,22 40,28 60,32 80,38 100,42 120,48 140,52 160,56 180,58 200,60"
              stroke="#fbbf24"
              strokeWidth="2"
              fill="none"
            />
            <polygon
              points="0,20 20,22 40,28 60,32 80,38 100,42 120,48 140,52 160,56 180,58 200,60 200,80 0,80"
              fill="url(#nutri-grad)"
            />
          </svg>
          <Row
            style={{
              fontSize: 10,
              color: "var(--fg-muted)",
              justifyContent: "space-between",
              marginTop: 4,
            }}
          >
            <span>Inicio: 84 kg</span>
            <span style={{ color: "#34d399" }}>Actual: 76 kg · −8 kg</span>
          </Row>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          {(
            [
              ["Proteína", "120 g", "#fbbf24"],
              ["Carbs", "180 g", "#38bdf8"],
              ["Grasa", "60 g", "#a78bfa"],
            ] as const
          ).map(([l, v, c]) => (
            <div
              key={l}
              style={{
                padding: 8,
                borderRadius: 6,
                background: c + "18",
                border: `1px solid ${c}33`,
              }}
            >
              <div style={{ fontSize: 9, color: "var(--fg-muted)" }}>{l}</div>
              <div
                style={{
                  fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                  fontWeight: 600,
                  fontSize: 14,
                  color: c,
                }}
              >
                {v}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 8,
            background: "rgba(251,191,36,0.06)",
            border: "1px solid rgba(251,191,36,0.2)",
          }}
        >
          <Row style={{ fontSize: 11, marginBottom: 4 }}>
            <SectionTitle>Hoy</SectionTitle>
            <Tag color="#34d399">84%</Tag>
          </Row>
          <div style={{ fontSize: 10, color: "var(--fg-muted)" }}>
            4 comidas registradas · 1 pendiente
          </div>
        </div>
      </div>
    </div>
  </MockShell>
);

// ─── FISIO ───────────────────────────────────────────────────────────────────
export const FisioMock: React.FC = () => (
  <MockShell title="Evaluación postural · Miguel A." accent="#fbbf24">
    <div style={{ display: "grid", gridTemplateColumns: "0.7fr 1.3fr", gap: 12 }}>
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid var(--app-border)",
        }}
      >
        <SectionTitle>Postura lateral</SectionTitle>
        <svg viewBox="0 0 100 160" style={{ width: "100%", marginTop: 8 }}>
          <line
            x1="50"
            y1="10"
            x2="50"
            y2="150"
            stroke="#fbbf24"
            strokeWidth="0.5"
            strokeDasharray="2,2"
            opacity="0.6"
          />
          <circle
            cx="52"
            cy="20"
            r="8"
            fill="rgba(251,191,36,0.12)"
            stroke="rgba(251,191,36,0.5)"
            strokeWidth="0.8"
          />
          <path
            d="M54 28 L55 50 L58 75 L58 100 L56 125 L55 150 L60 150 L62 125 L62 100 L62 75 L62 55 L55 28 Z"
            fill="rgba(251,191,36,0.1)"
            stroke="rgba(251,191,36,0.4)"
            strokeWidth="0.8"
          />
          <circle cx="52" cy="20" r="2" fill="#ef4444" />
          <circle cx="58" cy="50" r="2" fill="#fbbf24" />
          <circle cx="60" cy="75" r="2" fill="#fbbf24" />
          <circle cx="62" cy="125" r="2" fill="#34d399" />
        </svg>
      </div>
      <div>
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid var(--app-border)",
            marginBottom: 10,
          }}
        >
          <SectionTitle>Desviaciones</SectionTitle>
          {(
            [
              ["Cabeza adelantada", "4.8 cm", "#ef4444"],
              ["Hombros protruidos", "2.1 cm", "#fbbf24"],
              ["Hiperlordosis", "+6°", "#fbbf24"],
            ] as const
          ).map(([l, v, c]) => (
            <Row
              key={l}
              style={{
                padding: "5px 0",
                fontSize: 11,
                borderBottom: "1px dashed var(--app-border)",
              }}
            >
              <Dot c={c} />
              <span style={{ flex: 1 }}>{l}</span>
              <span
                style={{
                  color: c,
                  fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
                  fontSize: 10,
                }}
              >
                {v}
              </span>
            </Row>
          ))}
        </div>
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "rgba(251,191,36,0.06)",
            border: "1px solid rgba(251,191,36,0.2)",
          }}
        >
          <Row style={{ marginBottom: 6 }}>
            <SectionTitle>Plan · 250 ejercicios</SectionTitle>
            <Tag color="#fbbf24">3x/sem</Tag>
          </Row>
          {[
            "Estiramiento cervical · 2 min",
            "Fortalecimiento core · 10 reps",
            "Bird dog · 3×10",
          ].map((e) => (
            <Row key={e} style={{ padding: "4px 0", fontSize: 10.5 }}>
              <span style={{ fontSize: 14 }}>▶</span>
              <span style={{ color: "var(--fg-muted)" }}>{e}</span>
            </Row>
          ))}
        </div>
      </div>
    </div>
  </MockShell>
);

// ─── ESTÉTICA ────────────────────────────────────────────────────────────────
export const EsteticaMock: React.FC = () => (
  <MockShell title="Mapa de inyecciones · Toxina" accent="#fbbf24">
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid var(--app-border)",
        }}
      >
        <Row style={{ marginBottom: 8 }}>
          <SectionTitle>Rostro · OnabotulinumtoxinA</SectionTitle>
          <Tag color="#fbbf24">22 U</Tag>
        </Row>
        <svg viewBox="0 0 100 120" style={{ width: "100%" }}>
          <ellipse
            cx="50"
            cy="60"
            rx="32"
            ry="42"
            fill="rgba(251,191,36,0.08)"
            stroke="rgba(251,191,36,0.35)"
            strokeWidth="0.6"
          />
          {(
            [
              [42, 32, "2U"],
              [50, 30, "4U"],
              [58, 32, "2U"],
              [38, 40, "2U"],
              [62, 40, "2U"],
              [35, 50, "2U"],
              [65, 50, "2U"],
              [45, 52, "2U"],
              [55, 52, "2U"],
              [30, 62, "1U"],
              [70, 62, "1U"],
            ] as const
          ).map(([x, y, u], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="2.5" fill="#fbbf24" opacity="0.8" />
              <circle cx={x} cy={y} r="4" fill="none" stroke="#fbbf24" opacity="0.3" />
              <text x={x + 5} y={y + 1.5} fontSize="4" fill="#fbbf24" fontFamily="monospace">
                {u}
              </text>
            </g>
          ))}
        </svg>
        <Row style={{ fontSize: 9, color: "var(--fg-muted)", marginTop: 4 }}>
          11 puntos · 22 U totales · Próxima aplicación sugerida: agosto 2026
        </Row>
      </div>
      <div>
        <Row style={{ marginBottom: 8 }}>
          <SectionTitle>Antes / Después</SectionTitle>
          <Tag color="#fbbf24">Sesión 2/3</Tag>
        </Row>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {[
            { l: "Pre-tx", int: 0.7 },
            { l: "Día 14", int: 0.2 },
          ].map((p) => (
            <div key={p.l}>
              <div
                style={{
                  fontSize: 9,
                  color: "var(--fg-muted)",
                  marginBottom: 3,
                  fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
                }}
              >
                {p.l}
              </div>
              <div
                style={{
                  aspectRatio: "1",
                  borderRadius: 8,
                  background: "linear-gradient(135deg, #2a2230, #1a1420)",
                  position: "relative",
                  overflow: "hidden",
                  border: "1px solid var(--app-border)",
                }}
              >
                <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%" }}>
                  <ellipse cx="50" cy="52" rx="28" ry="36" fill="rgba(230,180,150,0.6)" />
                  {(
                    [
                      [35, 35],
                      [45, 32],
                      [55, 32],
                      [65, 35],
                    ] as const
                  ).map(([x, y], i) => (
                    <path
                      key={i}
                      d={`M ${x} ${y} Q ${x + 2} ${y + 2} ${x + 4} ${y}`}
                      stroke="rgba(80,50,40,0.7)"
                      strokeWidth={0.6 * p.int}
                      fill="none"
                    />
                  ))}
                  <circle cx="42" cy="48" r="1.5" fill="rgba(50,30,20,0.6)" />
                  <circle cx="58" cy="48" r="1.5" fill="rgba(50,30,20,0.6)" />
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
            background: "rgba(251,191,36,0.06)",
            border: "1px solid rgba(251,191,36,0.2)",
            fontSize: 10.5,
          }}
        >
          <Row>
            <Tag color="#fbbf24">Lote A2947-B</Tag>
            <span style={{ marginLeft: "auto", color: "var(--fg-muted)" }}>cad. 06/2027</span>
          </Row>
        </div>
      </div>
    </div>
  </MockShell>
);

// ─── ACUPUNTURA ──────────────────────────────────────────────────────────────
export const AcupunturaMock: React.FC = () => (
  <MockShell title="Mapa meridianos · Sesión 8" accent="#fbbf24">
    <div style={{ display: "grid", gridTemplateColumns: "0.8fr 1.2fr", gap: 12 }}>
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid var(--app-border)",
        }}
      >
        <SectionTitle>Puntos usados · Hoy</SectionTitle>
        <svg viewBox="0 0 80 160" style={{ width: "100%", marginTop: 8 }}>
          <path
            d="M40 10 a8 8 0 0 1 0 16 a8 8 0 0 1 0 -16 M30 26 L50 26 L56 60 L60 110 L56 115 L50 100 L50 150 L46 150 L42 110 L38 110 L34 150 L30 150 L30 100 L24 115 L20 110 L24 60 Z"
            fill="rgba(251,191,36,0.08)"
            stroke="rgba(251,191,36,0.4)"
            strokeWidth="0.5"
          />
          <path d="M40 20 L40 140" stroke="rgba(251,191,36,0.3)" strokeWidth="0.3" />
          <path d="M32 30 L38 140" stroke="rgba(251,191,36,0.3)" strokeWidth="0.3" />
          <path d="M48 30 L42 140" stroke="rgba(251,191,36,0.3)" strokeWidth="0.3" />
          {(
            [
              [40, 26, "GV20"],
              [32, 50, "LI4"],
              [48, 50, "LI11"],
              [36, 75, "ST36"],
              [44, 75, "SP6"],
              [40, 115, "BL40"],
              [32, 140, "LV3"],
            ] as const
          ).map(([x, y, l], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="2" fill="#fbbf24" />
              <circle cx={x} cy={y} r="4" fill="none" stroke="#fbbf24" opacity="0.4" />
              <text x={x + 5} y={y + 1} fontSize="4" fill="#fbbf24" fontFamily="monospace">
                {l}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div>
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid var(--app-border)",
            marginBottom: 10,
          }}
        >
          <SectionTitle>Síntomas · Evolución</SectionTitle>
          <svg viewBox="0 0 200 60" style={{ width: "100%", marginTop: 6 }}>
            <polyline
              points="0,10 25,12 50,18 75,24 100,30 125,36 150,42 175,48 200,50"
              stroke="#fbbf24"
              strokeWidth="1.5"
              fill="none"
            />
          </svg>
          <Row
            style={{
              fontSize: 10,
              color: "var(--fg-muted)",
              justifyContent: "space-between",
            }}
          >
            <span>Inicio: 8/10</span>
            <span style={{ color: "#34d399" }}>Hoy: 2/10</span>
          </Row>
        </div>
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "rgba(251,191,36,0.06)",
            border: "1px solid rgba(251,191,36,0.2)",
          }}
        >
          <SectionTitle>Diagnóstico MTC</SectionTitle>
          <div
            style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 6, lineHeight: 1.5 }}
          >
            Estancamiento Qi del Hígado con estasis de sangre. Protocolo: 12 sesiones.
          </div>
        </div>
      </div>
    </div>
  </MockShell>
);

// ─── HOMEOPATÍA ──────────────────────────────────────────────────────────────
export const HomeopatiaMock: React.FC = () => (
  <MockShell title="Repertorización · Ana R." accent="#fbbf24">
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
          <SectionTitle>Síntomas rúbricos</SectionTitle>
          <Tag color="#fbbf24">7 rubros</Tag>
        </Row>
        {[
          "Mente · Ansiedad anticipatoria",
          "Sueño · Despertar 3 AM",
          "Digestivo · Gastritis",
          "Cabeza · Migraña lado der.",
          "Piel · Urticaria emocional",
        ].map((s) => (
          <Row
            key={s}
            style={{
              padding: "5px 0",
              fontSize: 10.5,
              borderBottom: "1px dashed var(--app-border)",
            }}
          >
            <Dot c="#fbbf24" />
            <span style={{ color: "var(--fg)" }}>{s}</span>
          </Row>
        ))}
      </div>
      <div>
        <Row style={{ marginBottom: 8 }}>
          <SectionTitle>Remedios sugeridos</SectionTitle>
          <Tag color="#fbbf24">IA asistida</Tag>
        </Row>
        {(
          [
            ["Lycopodium clavatum", 96, "30 CH"],
            ["Nux vomica", 82, "200 CH"],
            ["Arsenicum album", 74, "30 CH"],
            ["Natrum muriaticum", 61, "200 CH"],
          ] as const
        ).map(([r, score, pot], i) => (
          <div
            key={r}
            style={{
              padding: 10,
              borderRadius: 8,
              background: i === 0 ? "rgba(251,191,36,0.08)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${i === 0 ? "rgba(251,191,36,0.3)" : "var(--app-border)"}`,
              marginBottom: 6,
            }}
          >
            <Row>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                    fontWeight: 500,
                    fontSize: 12,
                    color: "var(--fg)",
                    fontStyle: "italic",
                  }}
                >
                  {r}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--fg-muted)",
                    fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
                  }}
                >
                  Potencia sugerida: {pot}
                </div>
              </div>
              <div
                style={{
                  fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                  fontWeight: 600,
                  fontSize: 16,
                  color: "#fbbf24",
                }}
              >
                {score}
              </div>
            </Row>
          </div>
        ))}
      </div>
    </div>
  </MockShell>
);
