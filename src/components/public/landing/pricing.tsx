"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

type Billing = "mensual" | "anual";

interface Plan {
  name: string;
  desc: string;
  /** Precios en MXN, ya formateados (es-MX) para render determinista. */
  monthly: string;
  /** Anual con promo: redondear(mensual × 12 × 0.70), formateado es-MX. // promo 30% */
  annual: string;
  /** Mensual primeros 3 meses: redondear(mensual × 0.85), formateado es-MX. // -15% x3 meses */
  promo3m: string;
  planParam: string;
  features: string[];
  popular: boolean;
}

const PLANS: Plan[] = [
  {
    name: "Basic",
    desc: "Para empezar tu práctica.",
    monthly: "499",
    annual: "4,192", // promo 30% (499 × 12 × 0.70)
    promo3m: "424", // -15% primeros 3 meses (499 × 0.85)
    planParam: "basic",
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
    monthly: "999",
    annual: "8,392", // promo 30% (999 × 12 × 0.70)
    promo3m: "849", // -15% primeros 3 meses (999 × 0.85)
    planParam: "pro",
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
    monthly: "1,999",
    annual: "16,792", // promo 30% (1,999 × 12 × 0.70)
    promo3m: "1,699", // -15% primeros 3 meses (1,999 × 0.85)
    planParam: "clinic",
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
  const [billing, setBilling] = useState<Billing>("mensual");
  const isAnnual = billing === "anual";

  return (
    <section className="lp-section lp-section--tint-grad" id="pricing" aria-labelledby="price-h">
      <div className="lp-container">
        <div className="lp-section-head">
          <p className="lp-eyebrow">Precios</p>
          <h2 id="price-h" className="lp-h2">Tres planes. Sin sorpresas.</h2>
          <p className="lp-lead">
            Precios en pesos mexicanos. Sin costos por timbre CFDI en PRO y CLINIC.
            Cancela cuando quieras.
          </p>
        </div>

        {/* Toggle Mensual / Anual */}
        <div className="lp-bill-toggle" role="group" aria-label="Periodo de facturación">
          <button
            type="button"
            className={!isAnnual ? "lp-bill-opt lp-bill-opt--active" : "lp-bill-opt"}
            aria-pressed={!isAnnual}
            onClick={() => setBilling("mensual")}
          >
            Mensual
          </button>
          <button
            type="button"
            className={isAnnual ? "lp-bill-opt lp-bill-opt--active" : "lp-bill-opt"}
            aria-pressed={isAnnual}
            onClick={() => setBilling("anual")}
          >
            Anual
            <span className="lp-bill-save">Promoción 30% de descuento</span>
          </button>
        </div>

        {/* Aviso de promoción según el periodo elegido (se anuncia al togglear) */}
        <p className="lp-price-notice" role="status" aria-live="polite">
          {isAnnual
            ? "⏳ Promoción válida por las próximas 72 horas"
            : "−15% en tus primeros 3 meses · luego precio normal"}
        </p>

        <div className="lp-grid lp-grid-3" style={{ alignItems: "start" }}>
          {PLANS.map((plan) => (
            <article
              key={plan.name}
              className={`lp-card lp-price-card${plan.popular ? " lp-price-popular" : ""}`}
            >
              {plan.popular && (
                <span className="lp-mono lp-price-badge" aria-hidden="true">
                  Recomendado
                </span>
              )}

              <p className="lp-mono lp-price-name">{plan.name}</p>
              <p className="lp-price-desc">{plan.desc}</p>

              <p className="lp-price-amount">
                <span className="lp-price-currency">$</span>
                <span className="lp-price-value">{isAnnual ? plan.annual : plan.monthly}</span>
                <span className="lp-price-period">MXN{isAnnual ? "/año" : "/mes"}</span>
              </p>
              <p className="lp-price-subnote">
                {isAnnual ? "Facturado una vez al año" : "Por mes, sin permanencia"}
              </p>

              {/* Promo mensual: −15% los primeros 3 meses, luego precio normal */}
              {!isAnnual && (
                <p className="lp-price-promo">
                  <span className="lp-price-promo__badge">−15% primeros 3 meses</span>
                  <span className="lp-price-promo__val">${plan.promo3m}/mes</span>
                  <span className="lp-price-promo__ref">luego ${plan.monthly}/mes (precio normal al 4.º mes)</span>
                </p>
              )}

              {/* Costo de instalación: tachado e incluido gratis */}
              <p className="lp-price-install">
                Costo de instalación:{" "}
                <span className="lp-price-install__old">$500 pago único</span>{" "}
                <span className="lp-price-install__free">✓ Incluido GRATIS</span>
              </p>

              <Link
                href={`/signup?plan=${plan.planParam}`}
                className={`lp-btn lp-btn--block ${plan.popular ? "lp-btn--primary" : "lp-btn--secondary"}`}
              >
                Elegir plan
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
          Todos los planes incluyen migración, soporte en español y cumplimiento CFDI 4.0 / NOM-024.
        </p>
      </div>

      <style jsx>{`
        .lp-bill-toggle {
          display: inline-flex;
          gap: 4px;
          padding: 5px;
          margin: 0 auto clamp(20px, 3vw, 28px);
          border-radius: 999px;
          background: var(--ld-surface);
          border: 1px solid var(--ld-border);
          box-shadow: var(--ld-shadow-sm);
        }
        .lp-bill-toggle { display: flex; width: fit-content; }
        .lp-bill-opt {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: none;
          background: transparent;
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: 14px;
          font-weight: 500;
          color: var(--ld-fg-muted);
          padding: 9px 18px;
          border-radius: 999px;
          cursor: pointer;
          transition: background 0.18s, color 0.18s, box-shadow 0.18s;
        }
        .lp-bill-opt--active {
          background: var(--ld-grad-brand);
          color: #fff;
          box-shadow: 0 6px 16px -8px rgba(124,58,237,0.6);
        }
        .lp-bill-save {
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 0.02em;
          padding: 2px 8px;
          border-radius: 999px;
          background: #fff;
          color: var(--ld-brand-strong);
          white-space: nowrap;
        }

        /* Aviso de promoción (cambia al togglear, aria-live) */
        .lp-price-notice {
          margin: 0 auto clamp(22px, 3.5vw, 32px);
          max-width: 540px;
          text-align: center;
          font-size: 13.5px;
          font-weight: 600;
          color: var(--ld-brand-strong);
          background: var(--ld-brand-weak);
          border: 1px solid var(--ld-brand-weak-border);
          border-radius: 12px;
          padding: 9px 16px;
        }

        .lp-price-card {
          position: relative;
          display: flex;
          flex-direction: column;
          height: 100%;
          transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        }
        /* Hover premium: anillo morado + sombra suave + leve elevación */
        .lp-price-card:hover {
          transform: translateY(-4px);
          border-color: var(--ld-brand-light);
          box-shadow: 0 0 0 2px var(--ld-brand-light), 0 22px 44px -16px rgba(124,58,237,0.35);
        }
        .lp-price-popular { border-color: var(--ld-brand-weak-border); box-shadow: var(--ld-shadow-lg); }
        .lp-price-popular:hover {
          box-shadow: 0 0 0 2px var(--ld-brand), 0 26px 50px -16px rgba(124,58,237,0.45);
        }
        @media (prefers-reduced-motion: reduce) {
          .lp-price-card { transition: box-shadow 0.2s ease, border-color 0.2s ease; }
          .lp-price-card:hover { transform: none; }
        }

        .lp-price-badge {
          position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
          padding: 5px 14px; border-radius: 999px; background: var(--ld-grad-brand); color: #fff;
          font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em;
          white-space: nowrap; box-shadow: var(--ld-shadow-sm);
        }
        .lp-price-name { margin: 0; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ld-brand-strong); }
        .lp-price-desc { margin: 8px 0 0; font-size: 14px; line-height: 1.5; color: var(--ld-fg-subtle); }
        .lp-price-amount { display: flex; align-items: baseline; gap: 4px; margin: 22px 0 0; flex-wrap: wrap; }
        .lp-price-currency { font-size: 24px; font-weight: 700; color: var(--ld-fg); line-height: 1; }
        .lp-price-value { font-size: 46px; font-weight: 700; color: var(--ld-fg); line-height: 1; letter-spacing: -0.02em; }
        .lp-price-period { font-size: 14px; color: var(--ld-fg-muted); }
        .lp-price-subnote { margin: 6px 0 0; font-size: 12px; color: var(--ld-fg-subtle); }

        /* Promo mensual de primeros 3 meses */
        .lp-price-promo {
          margin: 12px 0 0;
          display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 8px;
          font-size: 12.5px;
        }
        .lp-price-promo__badge {
          font-weight: 700; color: #fff; background: var(--ld-grad-brand);
          border-radius: 999px; padding: 2px 9px; font-size: 11px; white-space: nowrap;
        }
        .lp-price-promo__val { font-weight: 700; font-size: 15px; color: var(--ld-brand-strong); }
        .lp-price-promo__ref { color: var(--ld-fg-subtle); }

        /* Costo de instalación incluido gratis */
        .lp-price-install {
          margin: 12px 0 0;
          display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px;
          font-size: 12.5px; color: var(--ld-fg-subtle);
        }
        .lp-price-install__old { text-decoration: line-through; color: var(--ld-fg-subtle); opacity: 0.85; }
        .lp-price-install__free {
          font-weight: 700; color: #047857; background: #d1fae5;
          border-radius: 999px; padding: 2px 9px; font-size: 11.5px; white-space: nowrap;
        }

        .lp-price-card :global(.lp-btn--block) { margin-top: 22px; }
        .lp-price-divider { margin: 22px 0; }
        .lp-price-features { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 13px; }
        .lp-price-feature { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; line-height: 1.45; color: var(--ld-fg-muted); }
        .lp-price-feature :global(.lp-price-check) { flex-shrink: 0; margin-top: 2px; color: var(--ld-brand-strong); }
        .lp-price-foot { margin: 36px auto 0; max-width: 640px; text-align: center; font-size: 13px; line-height: 1.5; color: var(--ld-fg-subtle); }
      `}</style>
    </section>
  );
}
