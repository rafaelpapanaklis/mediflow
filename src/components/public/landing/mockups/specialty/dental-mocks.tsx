import React from "react";
import { MockShell, SectionTitle, Tag, Row, Dot } from "./mock-shell";

// ─── DENTAL: Odontogram ──────────────────────────────────────────────────────
export const OdontogramMock: React.FC = () => {
  const upper = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
  const lower = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
  const status: Record<number, "caries" | "restored" | "missing"> = {
    16: "caries",
    26: "restored",
    36: "caries",
    46: "restored",
    18: "missing",
    28: "missing",
  };
  const colorMap: Record<string, string> = {
    caries: "#ef4444",
    restored: "#38bdf8",
    missing: "rgba(255,255,255,0.1)",
  };
  const Tooth: React.FC<{ n: number }> = ({ n }) => {
    const s = status[n];
    return (
      <div
        style={{
          flex: 1,
          aspectRatio: "0.7",
          borderRadius: 4,
          border: `1px solid ${s ? colorMap[s] : "rgba(255,255,255,0.15)"}`,
          background:
            s === "caries"
              ? "rgba(239,68,68,0.15)"
              : s === "restored"
              ? "rgba(56,189,248,0.15)"
              : s === "missing"
              ? "rgba(255,255,255,0.04)"
              : "rgba(255,255,255,0.02)",
          display: "grid",
          placeItems: "center",
          fontSize: 9,
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          color: s ? colorMap[s] : "var(--fg-muted)",
          position: "relative",
          opacity: s === "missing" ? 0.3 : 1,
        }}
      >
        {s === "missing" ? "—" : n}
        {s === "caries" && (
          <div
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              width: 4,
              height: 4,
              borderRadius: 4,
              background: "#ef4444",
            }}
          />
        )}
      </div>
    );
  };

  return (
    <MockShell title="Odontograma · #CE-2041" accent="#a78bfa">
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div>
          <div
            style={{
              padding: 16,
              borderRadius: 10,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid var(--app-border)",
            }}
          >
            <div style={{ display: "flex", gap: 3, marginBottom: 6 }}>
              {upper.map((n) => (
                <Tooth key={n} n={n} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 3 }}>
              {lower.map((n) => (
                <Tooth key={n} n={n} />
              ))}
            </div>
            <div
              style={{
                marginTop: 14,
                display: "flex",
                gap: 12,
                fontSize: 10,
                color: "var(--fg-muted)",
              }}
            >
              <Row>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: "#ef444433",
                    border: "1px solid #ef4444",
                  }}
                />
                Caries
              </Row>
              <Row>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: "#38bdf833",
                    border: "1px solid #38bdf8",
                  }}
                />
                Restauración
              </Row>
              <Row>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.15)",
                  }}
                />
                Ausente
              </Row>
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              padding: 14,
              borderRadius: 10,
              background: "rgba(167,139,250,0.06)",
              border: "1px solid rgba(167,139,250,0.2)",
            }}
          >
            <Row style={{ marginBottom: 8 }}>
              <SectionTitle>Plan de tratamiento</SectionTitle>
              <Tag color="#a78bfa">4 piezas</Tag>
            </Row>
            {(
              [
                ["16", "Resina clase II", "$850"],
                ["36", "Resina clase II", "$850"],
                ["26", "Control", "$0"],
                ["46", "Control", "$0"],
              ] as const
            ).map(([t, p, pr]) => (
              <Row
                key={t}
                style={{
                  padding: "6px 0",
                  fontSize: 11,
                  borderBottom: "1px dashed var(--app-border)",
                }}
              >
                <div
                  style={{
                    width: 28,
                    fontFamily: "var(--font-mono, ui-monospace, monospace)",
                    color: "#a78bfa",
                  }}
                >
                  #{t}
                </div>
                <div style={{ flex: 1 }}>{p}</div>
                <div style={{ color: "var(--fg-muted)" }}>{pr}</div>
              </Row>
            ))}
            <Row
              style={{
                marginTop: 10,
                justifyContent: "flex-end",
                fontFamily: "var(--font-sans, system-ui, sans-serif)",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Total: $1,700 <Tag color="#34d399">WhatsApp</Tag>
            </Row>
          </div>
        </div>

        <div>
          <div
            style={{
              padding: 14,
              borderRadius: 10,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid var(--app-border)",
            }}
          >
            <SectionTitle>Radiografía periapical · #16</SectionTitle>
            <div
              style={{
                marginTop: 10,
                aspectRatio: "1",
                borderRadius: 8,
                background: "linear-gradient(135deg, #1a1a2a, #0f0f18)",
                position: "relative",
                overflow: "hidden",
                border: "1px solid var(--app-border)",
              }}
            >
              <svg
                viewBox="0 0 100 100"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
              >
                <defs>
                  <radialGradient id="toothg" cx="50%" cy="40%">
                    <stop offset="0%" stopColor="#d4d4e8" stopOpacity="0.9" />
                    <stop offset="60%" stopColor="#5a5a6f" stopOpacity="0.6" />
                    <stop offset="100%" stopColor="#1a1a2a" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <path
                  d="M30 30 Q32 20 42 20 L58 20 Q68 20 70 30 L68 50 Q65 58 60 65 L58 85 L52 88 L48 88 L42 85 L40 65 Q35 58 32 50 Z"
                  fill="url(#toothg)"
                />
                <path d="M48 20 L48 85" stroke="#8a8aa0" strokeWidth="0.3" opacity="0.4" />
                <path d="M52 20 L52 85" stroke="#8a8aa0" strokeWidth="0.3" opacity="0.4" />
                <circle cx="50" cy="42" r="5" fill="#1a1a2a" opacity="0.9" />
                <rect x="20" y="85" width="60" height="15" fill="#d4d4e8" opacity="0.3" />
              </svg>
              <div
                style={{
                  position: "absolute",
                  top: "38%",
                  left: "45%",
                  width: 24,
                  height: 24,
                  borderRadius: 24,
                  border: "1.5px solid #ef4444",
                  boxShadow: "0 0 12px rgba(239,68,68,0.6)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: -18,
                    left: -6,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "#ef4444",
                    color: "white",
                    fontSize: 8,
                    fontFamily: "var(--font-mono, ui-monospace, monospace)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Caries 94%
                </div>
              </div>
            </div>
            <Row style={{ marginTop: 10, fontSize: 10, color: "var(--fg-muted)" }}>
              <Dot c="#a78bfa" /> IA · 2 hallazgos sugeridos
            </Row>
            <div
              style={{
                marginTop: 8,
                padding: 8,
                borderRadius: 6,
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.2)",
                fontSize: 10.5,
              }}
            >
              <Row>
                <Tag color="#ef4444">Caries oclusal</Tag>
                <span
                  style={{
                    marginLeft: "auto",
                    fontFamily: "var(--font-mono, ui-monospace, monospace)",
                    color: "var(--fg-muted)",
                  }}
                >
                  94%
                </span>
              </Row>
            </div>
          </div>
        </div>
      </div>
    </MockShell>
  );
};

// ─── DENTAL: Ortho · caso, control y mensualidades ───────────────────────────
// Maqueta ilustrativa (datos de ejemplo), pero cada pieza corresponde a algo
// que el módulo real SÍ tiene: el caso con su mes y fase, el arco actual, la
// hoja de control ligada a la cita, el estado de cuenta de mensualidades, los
// juegos de fotos (iniciales / de avance / finales), los registros guardados
// (el PDF de la cefalometría del centro radiológico y la radiografía lateral)
// y lo que el paciente registra en su portal. Nada de timeline automático, de
// cefalometría hecha dentro del panel ni de cobro automático: no existen.
export const OrthoMock: React.FC = () => {
  const mesActual = 5;
  const mesesTotales = 18;
  const datosCaso: Array<[string, string, string]> = [
    ["Fase", "Alineación", "Brackets metálicos"],
    ["Arco actual", "NiTi .016\"", "Último control firmado"],
    ["Próximo control", "28 abr · 11:00", "Control de ortodoncia"],
    ["Elásticos", "86%", "Uso · últimos 14 días"],
  ];
  const hoja: Array<[string, string]> = [
    ["Arco", "NiTi .016\" sup. e inf."],
    ["Elásticos", "Clase II · 3/16\""],
    ["Próximo control", "En 4 semanas"],
  ];
  const registros: Array<[string, string, string]> = [
    ["PDF", "Cefalometría", "Centro radiológico · 12 feb"],
    ["JPG", "Radiografía lateral de cráneo", "12 feb"],
  ];
  const juegos: Array<[string, boolean]> = [
    ["Iniciales", true],
    ["De avance", true],
    ["Finales", false],
  ];
  const tarjeta: React.CSSProperties = {
    padding: 12,
    borderRadius: 10,
    background: "rgba(255,255,255,0.02)",
    border: "1px solid var(--app-border)",
  };
  const fila: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11,
    marginBottom: 5,
  };
  return (
    <MockShell title="Caso de ortodoncia" accent="#a78bfa">
      <div style={{ ...tarjeta, padding: 14, marginBottom: 12 }}>
        <Row style={{ marginBottom: 12, justifyContent: "space-between" }}>
          <Row>
            <SectionTitle>Tratamiento activo</SectionTitle>
            <Tag color="#a78bfa">
              Mes {mesActual} de {mesesTotales}
            </Tag>
          </Row>
          <Tag color="#34d399">Al corriente</Tag>
        </Row>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${mesesTotales}, 1fr)`,
            gap: 3,
            marginBottom: 14,
          }}
        >
          {Array.from({ length: mesesTotales }, (_, i) => (
            <div
              key={i}
              style={{
                height: 6,
                borderRadius: 6,
                background:
                  i < mesActual
                    ? "linear-gradient(90deg, #a78bfa, #7c3aed)"
                    : "rgba(255,255,255,0.06)",
              }}
            />
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {datosCaso.map(([etiqueta, valor, nota]) => (
            <div key={etiqueta}>
              <div
                style={{
                  fontSize: 9,
                  color: "var(--fg-muted)",
                  fontFamily: "var(--font-mono, ui-monospace, monospace)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                {etiqueta}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>{valor}</div>
              <div style={{ fontSize: 10, color: "var(--fg-muted)", marginTop: 2 }}>{nota}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr", gap: 10 }}>
        <div style={tarjeta}>
          <Row style={{ marginBottom: 10, justifyContent: "space-between" }}>
            <SectionTitle>Hoja de control</SectionTitle>
            <Tag color="#34d399">Firmada</Tag>
          </Row>
          {hoja.map(([k, v]) => (
            <div key={k} style={fila}>
              <span style={{ color: "var(--fg-muted)" }}>{k}</span>
              <span>{v}</span>
            </div>
          ))}
          <div style={{ fontSize: 10, color: "var(--fg-muted)", marginTop: 8 }}>
            Control del 31 mar · ligada a la cita
          </div>
        </div>

        <div
          style={{
            ...tarjeta,
            background: "rgba(167,139,250,0.08)",
            border: "1px solid rgba(167,139,250,0.25)",
          }}
        >
          <Row style={{ marginBottom: 10 }}>
            <SectionTitle>Mensualidades</SectionTitle>
          </Row>
          <div style={fila}>
            <span>Total</span>
            <span>$42,000</span>
          </div>
          <div style={fila}>
            <span>Pagado</span>
            <span style={{ color: "#34d399" }}>$14,000</span>
          </div>
          <div
            style={{
              height: 4,
              borderRadius: 4,
              background: "rgba(255,255,255,0.06)",
              overflow: "hidden",
              margin: "8px 0",
            }}
          >
            <div
              style={{
                width: "33%",
                height: "100%",
                background: "linear-gradient(90deg, #a78bfa, #7c3aed)",
              }}
            />
          </div>
          <div style={{ fontSize: 10, color: "var(--fg-muted)" }}>
            Próxima: 5 may · $1,750
          </div>
        </div>

        <div style={tarjeta}>
          <Row style={{ marginBottom: 10 }}>
            <SectionTitle>Fotos del caso</SectionTitle>
          </Row>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {juegos.map(([nombre, tomado]) => (
              <div key={nombre}>
                <div
                  style={{
                    aspectRatio: "1",
                    borderRadius: 6,
                    background: tomado
                      ? "linear-gradient(180deg, rgba(167,139,250,0.18), rgba(167,139,250,0.04))"
                      : "rgba(255,255,255,0.02)",
                    border: tomado
                      ? "1px solid rgba(167,139,250,0.25)"
                      : "1px dashed rgba(255,255,255,0.12)",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {tomado && (
                    <svg viewBox="0 0 40 40" style={{ width: "80%" }}>
                      <path
                        d="M17 6 Q23 8 23 15 Q27 19 23 22 Q25 25 23 27 Q24 32 18 34"
                        stroke="rgba(255,255,255,0.45)"
                        strokeWidth="1"
                        fill="none"
                      />
                      <line x1="29" y1="17" x2="25" y2="33" stroke="#a78bfa" strokeWidth="0.9" />
                    </svg>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 9.5,
                    color: "var(--fg-muted)",
                    marginTop: 4,
                    textAlign: "center",
                  }}
                >
                  {nombre}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.6fr 1fr",
          gap: 10,
          marginTop: 10,
        }}
      >
        <div style={tarjeta}>
          <Row style={{ marginBottom: 10, justifyContent: "space-between" }}>
            <SectionTitle>Registros del caso</SectionTitle>
            <Tag color="#a78bfa">2 archivos</Tag>
          </Row>
          <div style={{ display: "grid", gap: 6 }}>
            {registros.map(([tipo, nombre, detalle]) => (
              <div
                key={nombre}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 8px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid var(--app-border)",
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    color: "#a78bfa",
                    fontFamily: "var(--font-mono, ui-monospace, monospace)",
                    letterSpacing: "0.06em",
                  }}
                >
                  {tipo}
                </span>
                <span style={{ fontSize: 11, fontWeight: 500, flex: 1, minWidth: 0 }}>{nombre}</span>
                <span style={{ fontSize: 10, color: "var(--fg-muted)" }}>{detalle}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={tarjeta}>
          <Row style={{ marginBottom: 10 }}>
            <SectionTitle>Desde el portal</SectionTitle>
          </Row>
          <Row style={{ fontSize: 11, marginBottom: 6 }}>
            <Dot c="#34d399" /> Elásticos de hoy registrados
          </Row>
          <Row style={{ fontSize: 11 }}>
            <Dot c="#a78bfa" /> Foto de monitoreo por revisar
          </Row>
        </div>
      </div>
    </MockShell>
  );
};

// ─── DENTAL: Endo ────────────────────────────────────────────────────────────
export const EndoMock: React.FC = () => {
  const Radio: React.FC<{
    label: string;
    withAI: boolean;
    findings?: { top: string; left: string; color: string; label: string }[];
  }> = ({ label, withAI, findings = [] }) => (
    <div style={{ flex: 1 }}>
      <div
        style={{
          fontSize: 10,
          color: "var(--fg-muted)",
          marginBottom: 6,
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          aspectRatio: "1",
          borderRadius: 8,
          background: "linear-gradient(135deg, #1a1a2a, #0a0a12)",
          position: "relative",
          overflow: "hidden",
          border: "1px solid var(--app-border)",
        }}
      >
        <svg
          viewBox="0 0 100 100"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        >
          <defs>
            <radialGradient id={`toothX${label}`} cx="50%" cy="35%">
              <stop offset="0%" stopColor="#e4e4f0" stopOpacity="0.95" />
              <stop offset="70%" stopColor="#5a5a6f" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#0a0a12" stopOpacity="0" />
            </radialGradient>
          </defs>
          <path
            d="M28 15 Q32 8 44 8 L56 8 Q68 8 72 15 L68 45 Q60 55 55 65 L55 80 L45 80 L45 65 Q40 55 32 45 Z"
            fill={`url(#toothX${label})`}
          />
          <path d="M46 40 L46 78" stroke="#1a1a2a" strokeWidth="1" opacity="0.9" />
          <path d="M54 40 L54 78" stroke="#1a1a2a" strokeWidth="1" opacity="0.9" />
          <circle cx="50" cy="82" r="3" fill="#2a2a3a" opacity="0.8" />
        </svg>
        {findings.map((f, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              top: f.top,
              left: f.left,
              width: 22,
              height: 22,
              borderRadius: 22,
              border: `1.5px solid ${f.color}`,
              boxShadow: `0 0 10px ${f.color}80`,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: -16,
                left: -4,
                padding: "2px 5px",
                borderRadius: 3,
                background: f.color,
                color: "white",
                fontSize: 8,
                fontFamily: "var(--font-mono, ui-monospace, monospace)",
                whiteSpace: "nowrap",
              }}
            >
              {f.label}
            </div>
          </div>
        ))}
        {withAI && (
          <div
            style={{
              position: "absolute",
              bottom: 6,
              right: 6,
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(167,139,250,0.9)",
              color: "white",
              fontSize: 9,
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
            }}
          >
            IA ✓
          </div>
        )}
      </div>
    </div>
  );
  return (
    <MockShell title="Análisis periapical · #22" accent="#a78bfa">
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid var(--app-border)",
        }}
      >
        <Row style={{ marginBottom: 10 }}>
          <SectionTitle>Comparativa · 3 meses post-endodoncia</SectionTitle>
        </Row>
        <div style={{ display: "flex", gap: 10 }}>
          <Radio
            label="15 ENE · Inicial"
            withAI={true}
            findings={[{ top: "62%", left: "48%", color: "#ef4444", label: "Lesión 87%" }]}
          />
          <Radio label="22 ENE · Post-tx" withAI={true} findings={[]} />
          <Radio
            label="15 ABR · Control"
            withAI={true}
            findings={[{ top: "68%", left: "48%", color: "#34d399", label: "Cicatrización" }]}
          />
        </div>
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 8,
            background: "rgba(167,139,250,0.06)",
            border: "1px solid rgba(167,139,250,0.2)",
            fontSize: 11,
          }}
        >
          <Row style={{ marginBottom: 4 }}>
            <Tag color="#a78bfa">Reporte IA</Tag>
            <span style={{ marginLeft: "auto", color: "var(--fg-muted)", fontSize: 10 }}>
              Analizado en 9 s
            </span>
          </Row>
          <div style={{ color: "var(--fg-muted)", lineHeight: 1.4 }}>
            Reducción de lesión periapical 76%. Recomendación: control a 6 meses.
          </div>
        </div>
      </div>
    </MockShell>
  );
};

// ─── DENTAL: Perio ───────────────────────────────────────────────────────────
export const PerioMock: React.FC = () => {
  const teeth = [16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26];
  const depths = [3, 3, 4, 6, 5, 4, 3, 2, 3, 5, 6, 4];
  const bleeding = [0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0];
  return (
    <MockShell title="Periodontograma · Visita 3" accent="#a78bfa">
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid var(--app-border)",
          marginBottom: 10,
        }}
      >
        <Row style={{ marginBottom: 10 }}>
          <SectionTitle>Maxilar superior · Profundidad al sondeo</SectionTitle>
          <Tag color="#a78bfa">Mejora 35%</Tag>
        </Row>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 3 }}>
          {teeth.map((t, i) => {
            const d = depths[i];
            const bl = bleeding[i];
            const color = d <= 3 ? "#34d399" : d <= 5 ? "#fbbf24" : "#ef4444";
            return (
              <div key={t} style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontSize: 9,
                    fontFamily: "var(--font-mono, ui-monospace, monospace)",
                    color: "var(--fg-muted)",
                    marginBottom: 2,
                  }}
                >
                  {t}
                </div>
                <div
                  style={{
                    height: d * 6 + 20,
                    borderRadius: 4,
                    background: `linear-gradient(180deg, ${color}, ${color}99)`,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 10,
                    fontFamily: "var(--font-mono, ui-monospace, monospace)",
                    color: "white",
                    fontWeight: 600,
                    position: "relative",
                  }}
                >
                  {d}mm
                  {bl ? (
                    <div
                      style={{
                        position: "absolute",
                        top: -3,
                        right: -3,
                        width: 7,
                        height: 7,
                        borderRadius: 7,
                        background: "#ef4444",
                        border: "1px solid var(--app-bg)",
                      }}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <Row style={{ marginTop: 12, fontSize: 10, color: "var(--fg-muted)", gap: 14 }}>
          <Row>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: "#34d399" }} />
            Sano ≤ 3 mm
          </Row>
          <Row>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: "#fbbf24" }} />
            4-5 mm
          </Row>
          <Row>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: "#ef4444" }} />
            ≥ 6 mm
          </Row>
          <Row>
            <div style={{ width: 7, height: 7, borderRadius: 7, background: "#ef4444" }} />
            Sangrado
          </Row>
        </Row>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {(
          [
            ["Índice de placa", "18%", "-22%", "#34d399"],
            ["Sangrado al sondeo", "14%", "-31%", "#34d399"],
            ["Piezas con bolsa ≥5mm", "3/28", "-5", "#a78bfa"],
          ] as const
        ).map(([l, v, d, c]) => (
          <div
            key={l}
            style={{
              padding: 12,
              borderRadius: 8,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid var(--app-border)",
            }}
          >
            <div style={{ fontSize: 10, color: "var(--fg-muted)" }}>{l}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
              <div
                style={{
                  fontFamily: "var(--font-sans, system-ui, sans-serif)",
                  fontWeight: 600,
                  fontSize: 18,
                  color: "var(--fg)",
                }}
              >
                {v}
              </div>
              <div style={{ fontSize: 10, color: c, fontWeight: 500 }}>{d}</div>
            </div>
          </div>
        ))}
      </div>
    </MockShell>
  );
};
