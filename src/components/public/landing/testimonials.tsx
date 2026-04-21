const MONO = "var(--font-jetbrains-mono, ui-monospace, monospace)";
const DISPLAY = "var(--font-sora, 'Sora', sans-serif)";

interface Quote {
  q:      string;
  name:   string;
  role:   string;
  city:   string;
  metric: string;
}

const QUOTES: Quote[] = [
  {
    q: "Dejamos Excel y WhatsApp manual. En 3 meses bajamos las faltas a citas de 22% a 6%. El recordatorio automático por WhatsApp se paga solo.",
    name: "Dra. Mariana Ochoa",
    role: "Directora · Clínica Dental Polanco",
    city: "CDMX",
    metric: "-73% faltas",
  },
  {
    q: "Lo que me convenció fue el CFDI nativo. Antes usábamos un sistema europeo que no timbraba; teníamos que facturar aparte. Ahora todo en un click.",
    name: "Dr. Ernesto Villalobos",
    role: "Médico general · Consultorio Villalobos",
    city: "Monterrey",
    metric: "4h/semana ahorradas",
  },
  {
    q: "La IA para radiografías es impresionante. No reemplaza mi ojo clínico, pero es una segunda opinión instantánea que mis pacientes valoran mucho.",
    name: "Dr. Alejandro Kuri",
    role: "Endodoncista · Smile Studio",
    city: "Guadalajara",
    metric: "+28% conversión",
  },
];

function initials(name: string): string {
  return name
    .split(" ")
    .slice(-2)
    .map((n) => n[0] ?? "")
    .join("");
}

export function Testimonials() {
  return (
    <section
      id="testimonials"
      style={{
        position: "relative",
        padding: "120px 48px",
        maxWidth: 1280,
        margin: "0 auto",
      }}
    >
      {/* Section header */}
      <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 56px" }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 11,
            color: "var(--ld-brand-light, var(--brand-light))",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          Clientes
        </div>
        <h2
          style={{
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: 48,
            letterSpacing: "-0.035em",
            lineHeight: 1.05,
            margin: 0,
            color: "var(--ld-fg, var(--fg))",
          }}
        >
          Clínicas que crecen con MediFlow.
        </h2>
      </div>

      {/* Cards grid */}
      <div
        className="testimonial-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 20,
        }}
      >
        {QUOTES.map((q, i) => {
          const isFeatured = i === 1;
          return (
            <div
              key={q.name}
              style={{
                padding: 28,
                borderRadius: 16,
                background: isFeatured
                  ? "linear-gradient(180deg, rgba(124,58,237,0.1), rgba(124,58,237,0.02))"
                  : "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005))",
                border: `1px solid ${
                  isFeatured
                    ? "rgba(124,58,237,0.25)"
                    : "var(--ld-border, var(--border))"
                }`,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {/* Metric pill */}
              <div
                style={{
                  display: "inline-flex",
                  alignSelf: "flex-start",
                  padding: "5px 10px",
                  borderRadius: 100,
                  background: "rgba(52,211,153,0.12)",
                  border: "1px solid rgba(52,211,153,0.25)",
                  fontSize: 11,
                  color: "#34d399",
                  fontFamily: MONO,
                  marginBottom: 20,
                }}
              >
                {q.metric}
              </div>

              {/* Quote */}
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 16,
                  color: "var(--ld-fg, var(--fg))",
                  lineHeight: 1.55,
                  marginBottom: 24,
                  fontWeight: 400,
                }}
              >
                &ldquo;{q.q}&rdquo;
              </div>

              {/* Author */}
              <div
                style={{
                  marginTop: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  paddingTop: 20,
                  borderTop: "1px solid var(--ld-border, var(--border))",
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 38,
                    background: `linear-gradient(135deg, hsl(${
                      260 + i * 30
                    }, 70%, 60%), hsl(${280 + i * 30}, 60%, 45%))`,
                    display: "grid",
                    placeItems: "center",
                    color: "white",
                    fontFamily: DISPLAY,
                    fontWeight: 600,
                    fontSize: 13,
                    flexShrink: 0,
                  }}
                >
                  {initials(q.name)}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--ld-fg, var(--fg))",
                      fontWeight: 500,
                    }}
                  >
                    {q.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--ld-fg-muted, var(--fg-muted))",
                    }}
                  >
                    {q.role} · {q.city}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @media (max-width: 768px) {
          #testimonials .testimonial-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
