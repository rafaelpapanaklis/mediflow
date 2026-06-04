import Link from "next/link";
import { Check } from "lucide-react";

interface Plan {
  name: string;
  desc: string;
  price: string;
  cta: { label: string; href: string };
  features: string[];
  popular: boolean;
}

const PLANS: Plan[] = [
  {
    name: "Basic",
    desc: "Para empezar tu práctica.",
    price: "49",
    cta: { label: "Empieza gratis", href: "/signup?plan=basic" },
    features: [
      "1 profesional · 1 sucursal",
      "Hasta 500 pacientes",
      "Agenda y recordatorios por WhatsApp",
      "Expediente clínico digital",
      "CFDI (50 timbres/mes)",
      "Soporte por email",
    ],
    popular: false,
  },
  {
    name: "Pro",
    desc: "La elección de clínicas en crecimiento.",
    price: "99",
    cta: { label: "Empieza gratis", href: "/signup?plan=pro" },
    features: [
      "Hasta 3 profesionales",
      "Pacientes ilimitados",
      "Todo lo de BASIC, y además:",
      "IA para radiografías (50/mes)",
      "Portal del paciente",
      "CFDI ilimitado",
      "Soporte prioritario",
    ],
    popular: true,
  },
  {
    name: "Clinic",
    desc: "Para grupos y multi-sede.",
    price: "249",
    cta: { label: "Empieza gratis", href: "/signup?plan=clinic" },
    features: [
      "Profesionales ilimitados",
      "Hasta 5 sucursales",
      "Todo lo de PRO, y además:",
      "IA de radiografías ilimitada",
      "Reportes consolidados",
      "Customer Success Manager",
      "Soporte 24/7",
    ],
    popular: false,
  },
];

export function Pricing() {
  return (
    <section className="lp-section lp-section--tint" id="pricing" aria-labelledby="price-h">
      <div className="lp-container">
        <div className="lp-section-head">
          <p className="lp-eyebrow">Precios</p>
          <h2 id="price-h" className="lp-h2">Tres planes. Sin sorpresas.</h2>
          <p className="lp-lead">14 días gratis · sin tarjeta · migración, soporte y CFDI incluidos.</p>
        </div>

        <div className="lp-grid lp-grid-3" style={{ alignItems: "start" }}>
          {PLANS.map((plan) => (
            <article
              key={plan.name}
              className={`lp-card lp-price-card${plan.popular ? " lp-price-popular" : ""}`}
            >
              {plan.popular && (
                <span className="lp-mono lp-price-badge" aria-hidden="true">
                  El más elegido
                </span>
              )}

              <p className="lp-mono lp-price-name">{plan.name}</p>
              <p className="lp-price-desc">{plan.desc}</p>

              <p className="lp-price-amount">
                <span className="lp-price-currency">$</span>
                <span className="lp-price-value">{plan.price}</span>
                <span className="lp-price-period">USD/mes</span>
              </p>

              <Link
                href={plan.cta.href}
                className={`lp-btn lp-btn--block ${plan.popular ? "lp-btn--primary" : "lp-btn--secondary"}`}
              >
                {plan.cta.label}
              </Link>

              <hr className="lp-divider lp-price-divider" />

              <ul className="lp-price-features">
                {plan.features.map((feature) => (
                  <li key={feature} className="lp-price-feature">
                    <Check size={16} strokeWidth={1.75} className="lp-price-check" aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <p className="lp-price-foot">
          Todos los planes incluyen migración gratuita, soporte en español y cumplimiento CFDI 4.0 / NOM-024.
        </p>
      </div>

      <style>{`
        .lp-price-card {
          position: relative;
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        .lp-price-popular {
          border-color: var(--ld-brand-weak-border);
          box-shadow: var(--ld-shadow-lg);
        }
        .lp-price-badge {
          position: absolute;
          top: -12px;
          left: 50%;
          transform: translateX(-50%);
          padding: 5px 14px;
          border-radius: 999px;
          background: var(--ld-grad-brand);
          color: #fff;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          white-space: nowrap;
          box-shadow: var(--ld-shadow-sm);
        }
        .lp-price-name {
          margin: 0;
          font-size: 13px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--ld-brand-strong);
        }
        .lp-price-desc {
          margin: 8px 0 0;
          font-size: 14px;
          line-height: 1.5;
          color: var(--ld-fg-subtle);
        }
        .lp-price-amount {
          display: flex;
          align-items: baseline;
          gap: 4px;
          margin: 22px 0 0;
          flex-wrap: wrap;
        }
        .lp-price-currency {
          font-size: 24px;
          font-weight: 700;
          color: var(--ld-fg);
          line-height: 1;
        }
        .lp-price-value {
          font-size: 46px;
          font-weight: 700;
          color: var(--ld-fg);
          line-height: 1;
          letter-spacing: -0.02em;
        }
        .lp-price-period {
          font-size: 14px;
          color: var(--ld-fg-muted);
        }
        .lp-price-card .lp-btn--block {
          margin-top: 24px;
        }
        .lp-price-divider {
          margin: 24px 0;
        }
        .lp-price-features {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 13px;
        }
        .lp-price-feature {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          font-size: 14px;
          line-height: 1.45;
          color: var(--ld-fg-muted);
        }
        .lp-price-check {
          flex-shrink: 0;
          margin-top: 2px;
          color: var(--ld-brand-strong);
        }
        .lp-price-foot {
          margin: 36px auto 0;
          max-width: 620px;
          text-align: center;
          font-size: 13px;
          line-height: 1.5;
          color: var(--ld-fg-subtle);
        }
      `}</style>
    </section>
  );
}
