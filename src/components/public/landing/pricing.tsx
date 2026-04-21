import Link from "next/link";

interface Plan {
  id: string;
  name: string;
  price: number;
  tagline: string;
  description: string;
  popular?: boolean;
  features: string[];
  cta: string;
  ctaHref: string;
}

const PLANS: Plan[] = [
  {
    id: "basic",
    name: "BASIC",
    price: 49,
    tagline: "Para empezar",
    description: "Solo o arrancando tu práctica.",
    features: [
      "1 profesional · 1 sucursal",
      "Hasta 500 pacientes",
      "Agenda y recordatorios WhatsApp",
      "Expediente clínico digital",
      "CFDI (50 timbres/mes)",
      "Soporte por email",
    ],
    cta: "Empezar gratis",
    ctaHref: "/register?plan=basic",
  },
  {
    id: "pro",
    name: "PRO",
    price: 99,
    tagline: "Lo más elegido",
    description: "La elección de clínicas en crecimiento.",
    popular: true,
    features: [
      "Hasta 3 profesionales",
      "Pacientes ilimitados",
      "Todo lo de BASIC, más:",
      "IA para radiografías (50/mes)",
      "Teleconsulta integrada",
      "Portal del paciente",
      "CFDI ilimitado",
      "Soporte prioritario",
    ],
    cta: "Prueba 30 días gratis",
    ctaHref: "/register?plan=pro",
  },
  {
    id: "clinic",
    name: "CLINIC",
    price: 249,
    tagline: "Multi-sucursal",
    description: "Para grupos y multi-sede.",
    features: [
      "Profesionales ilimitados",
      "Hasta 5 sucursales",
      "Todo lo de PRO, más:",
      "IA radiografías ilimitada",
      "API + white-label",
      "Customer Success Manager",
      "Reportes consolidados",
      "Soporte 24/7",
    ],
    cta: "Hablar con ventas",
    ctaHref: "/contact?plan=clinic",
  },
];

export function Pricing() {
  return (
    <section
      id="pricing"
      style={{
        position: "relative",
        padding: "120px 48px",
        maxWidth: 1280,
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          textAlign: "center",
          maxWidth: 680,
          margin: "0 auto 56px",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
            fontSize: 11,
            color: "var(--ld-brand-light, var(--brand-light))",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          Precios
        </div>
        <h2
          style={{
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            fontWeight: 600,
            fontSize: "clamp(32px, 5vw, 48px)",
            letterSpacing: "-0.035em",
            lineHeight: 1.05,
            margin: 0,
            color: "var(--ld-fg, var(--fg))",
          }}
        >
          Simple. Predecible. Como debería ser.
        </h2>
        <p
          style={{
            fontSize: 17,
            color: "var(--ld-fg-muted, var(--fg-muted))",
            marginTop: 20,
            lineHeight: 1.55,
          }}
        >
          Sin sorpresas, sin costos por timbre CFDI en PRO y CLINIC. Cancela
          cuando quieras.
        </p>
      </div>

      {/* Plan cards grid */}
      <div className="ld-pricing-grid">
        {PLANS.map((p) => (
          <div
            key={p.id}
            className="ld-pricing-card"
            style={{
              padding: 28,
              borderRadius: 18,
              background: p.popular
                ? "linear-gradient(180deg, rgba(124,58,237,0.12), rgba(124,58,237,0.03))"
                : "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005))",
              border: `1px solid ${
                p.popular
                  ? "rgba(124,58,237,0.4)"
                  : "var(--ld-border, var(--border))"
              }`,
              boxShadow: p.popular
                ? "0 0 60px rgba(124,58,237,0.15), 0 20px 40px -20px rgba(124,58,237,0.3)"
                : "none",
              position: "relative",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {p.popular && (
              <div
                style={{
                  position: "absolute",
                  top: -12,
                  left: 28,
                  padding: "4px 12px",
                  borderRadius: 100,
                  background: "linear-gradient(90deg, #a78bfa, #7c3aed)",
                  color: "white",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontFamily:
                    "var(--font-jetbrains-mono, ui-monospace, monospace)",
                }}
              >
                Más popular
              </div>
            )}

            {/* Name + tagline */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                  fontWeight: 600,
                  fontSize: 18,
                  letterSpacing: "0.05em",
                  color: p.popular
                    ? "#a78bfa"
                    : "var(--ld-fg, var(--fg))",
                }}
              >
                {p.name}
              </div>
              {!p.popular && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ld-fg-muted, var(--fg-muted))",
                  }}
                >
                  {p.tagline}
                </div>
              )}
            </div>

            {/* Description */}
            <div
              style={{
                fontSize: 13,
                color: "var(--ld-fg-muted, var(--fg-muted))",
                marginBottom: 8,
                lineHeight: 1.4,
              }}
            >
              {p.description}
            </div>

            {/* Price */}
            <div
              style={{
                marginTop: 16,
                marginBottom: 24,
                display: "flex",
                alignItems: "baseline",
                gap: 6,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                  fontWeight: 700,
                  fontSize: 48,
                  letterSpacing: "-0.04em",
                  color: "var(--ld-fg, var(--fg))",
                }}
              >
                ${p.price}
              </span>
              <span
                style={{
                  fontSize: 14,
                  color: "var(--ld-fg-muted, var(--fg-muted))",
                }}
              >
                USD/mes
              </span>
            </div>

            {/* CTA button */}
            <Link
              href={p.ctaHref}
              style={{
                display: "block",
                padding: "12px 20px",
                borderRadius: 10,
                textAlign: "center",
                background: p.popular
                  ? "linear-gradient(180deg, #8b5cf6, #7c3aed)"
                  : "rgba(255,255,255,0.04)",
                border: p.popular
                  ? "none"
                  : "1px solid rgba(255,255,255,0.08)",
                color: p.popular ? "white" : "var(--ld-fg, var(--fg))",
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
                boxShadow: p.popular
                  ? "0 10px 30px -8px rgba(124,58,237,0.6), inset 0 1px 0 rgba(255,255,255,0.2)"
                  : "none",
                marginBottom: 24,
                transition: "all 0.2s",
              }}
            >
              {p.cta} →
            </Link>

            <div
              style={{
                height: 1,
                background: "var(--ld-border, var(--border))",
                marginBottom: 20,
              }}
            />

            {/* Features */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {p.features.map((f, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 10,
                    fontSize: 13,
                    color: "var(--ld-fg-muted, var(--fg-muted))",
                    lineHeight: 1.45,
                  }}
                >
                  <span
                    style={{
                      color: p.popular
                        ? "#a78bfa"
                        : "var(--ld-fg-muted, var(--fg-muted))",
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer note */}
      <div
        style={{
          textAlign: "center",
          marginTop: 48,
          fontSize: 13,
          color: "var(--ld-fg-muted, var(--fg-muted))",
          lineHeight: 1.6,
        }}
      >
        Todos los planes incluyen: Migración gratuita · Actualizaciones ·
        Soporte en español · Cumplimiento CFDI/NOM-024
      </div>

      <style>{`
        .ld-pricing-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          align-items: start;
        }
        @media (max-width: 768px) {
          .ld-pricing-grid {
            grid-template-columns: 1fr;
            gap: 20px;
          }
        }
      `}</style>
    </section>
  );
}
