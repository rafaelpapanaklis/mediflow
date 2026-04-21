import Link from "next/link";
import type { Specialty } from "@/lib/specialty-data";

interface Plan {
  name:    string;
  price:   number;
  tag:     string;
  cta:     string;
  items:   string[];
  href:    string;
  popular?: boolean;
}

export function SpecPricing({ spec }: { spec: Specialty }) {
  const accent = spec.accent;
  const aiDesc =
    spec.category === "Dental"
      ? "IA radiografías 50/mes"
      : "IA análisis 50/mes";

  const plans: Plan[] = [
    {
      name:  "BASIC",
      price: 49,
      tag:   "Para empezar",
      cta:   "Empezar gratis",
      href:  "/signup?plan=basic",
      items: [
        "1 profesional · 1 sucursal",
        "Agenda + WhatsApp",
        "Expediente digital",
        "Hasta 500 pacientes",
        "CFDI (50 timbres/mes)",
      ],
    },
    {
      name:    "PRO",
      price:   99,
      tag:     "Lo más elegido",
      popular: true,
      cta:     "Prueba 14 días gratis",
      href:    "/signup?plan=pro",
      items: [
        "Hasta 3 profesionales",
        "Pacientes ilimitados",
        "CFDI ilimitado",
        aiDesc,
        "Portal del paciente",
        "Landing pública",
      ],
    },
    {
      name:  "CLINIC",
      price: 249,
      tag:   "Multi-sucursal",
      cta:   "Hablar con ventas",
      href:  "/contact?plan=clinic",
      items: [
        "Profesionales ilimitados",
        "Hasta 5 sucursales",
        "IA ilimitada",
        "Reportes consolidados",
        "API + integraciones",
        "Onboarding dedicado",
      ],
    },
  ];

  return (
    <section
      style={{ padding: "100px 48px", maxWidth: 1280, margin: "0 auto" }}
    >
      <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 48px" }}>
        <div
          style={{
            fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
            fontSize: 11,
            color: accent,
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
            fontSize: 44,
            letterSpacing: "-0.035em",
            lineHeight: 1.05,
            margin: 0,
            color: "var(--ld-fg, var(--fg))",
          }}
        >
          Empieza con lo que necesitas.
        </h2>
        <p
          style={{
            fontSize: 16,
            color: "var(--ld-fg-muted, var(--fg-muted))",
            marginTop: 18,
          }}
        >
          Todos los planes incluyen soporte en español, servidores en México y
          sin permanencia.
        </p>
      </div>
      <div
        className="spec-pricing-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
        }}
      >
        {plans.map((p) => (
          <div
            key={p.name}
            style={{
              padding: 26,
              borderRadius: 18,
              background: p.popular
                ? "linear-gradient(180deg, rgba(124,58,237,0.12), rgba(124,58,237,0.03))"
                : "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005))",
              border: `1px solid ${
                p.popular ? "rgba(124,58,237,0.4)" : "var(--ld-border, var(--border))"
              }`,
              boxShadow: p.popular ? "0 0 60px rgba(124,58,237,0.15)" : "none",
              position: "relative",
            }}
          >
            {p.popular && (
              <div
                style={{
                  position: "absolute",
                  top: -12,
                  left: 26,
                  padding: "4px 12px",
                  borderRadius: 100,
                  background: "linear-gradient(90deg, #a78bfa, #7c3aed)",
                  color: "white",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                {p.tag}
              </div>
            )}
            <div
              style={{
                fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                fontWeight: 600,
                fontSize: 16,
                letterSpacing: "0.05em",
                color: p.popular ? "#a78bfa" : "var(--ld-fg, var(--fg))",
              }}
            >
              {p.name}
            </div>
            {!p.popular && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ld-fg-muted, var(--fg-muted))",
                  marginTop: 2,
                }}
              >
                {p.tag}
              </div>
            )}
            <div
              style={{
                marginTop: 16,
                marginBottom: 20,
                display: "flex",
                alignItems: "baseline",
                gap: 6,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                  fontWeight: 700,
                  fontSize: 44,
                  letterSpacing: "-0.04em",
                  color: "var(--ld-fg, var(--fg))",
                }}
              >
                ${p.price}
              </span>
              <span
                style={{
                  fontSize: 13,
                  color: "var(--ld-fg-muted, var(--fg-muted))",
                }}
              >
                USD/mes
              </span>
            </div>
            <Link
              href={p.href}
              style={{
                display: "block",
                padding: "12px 20px",
                borderRadius: 10,
                textAlign: "center",
                background: p.popular
                  ? "linear-gradient(180deg, #8b5cf6, #7c3aed)"
                  : "rgba(255,255,255,0.04)",
                border: p.popular ? "none" : "1px solid rgba(255,255,255,0.08)",
                color: p.popular ? "white" : "var(--ld-fg, var(--fg))",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                boxShadow: p.popular
                  ? "0 10px 30px -8px rgba(124,58,237,0.6)"
                  : "none",
                marginBottom: 20,
                textDecoration: "none",
              }}
            >
              {p.cta} →
            </Link>
            <div
              style={{
                height: 1,
                background: "var(--ld-border, var(--border))",
                marginBottom: 16,
              }}
            />
            {p.items.map((f, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 10,
                  fontSize: 12.5,
                  color: "var(--ld-fg-muted, var(--fg-muted))",
                  padding: "5px 0",
                }}
              >
                <span
                  style={{
                    color: p.popular ? "#a78bfa" : accent,
                    flexShrink: 0,
                  }}
                >
                  ✓
                </span>
                <span>{f}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div
        style={{
          textAlign: "center",
          marginTop: 32,
          fontSize: 13,
          color: "var(--ld-fg-muted, var(--fg-muted))",
        }}
      >
        ¿Necesitas ver el comparativo completo?{" "}
        <Link
          href="/#pricing"
          style={{
            color: accent,
            textDecoration: "none",
            borderBottom: `1px dashed ${accent}`,
          }}
        >
          Ver tabla detallada
        </Link>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .spec-pricing-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
