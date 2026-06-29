"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ShieldCheck } from "lucide-react";

/**
 * Precios en MXN. Mensual confirmado.
 * Promos vigentes:
 *  - Anual: 30% de descuento → redondear(mensual × 12 × 0.70).
 *  - Instalación ($500 pago único) incluida sin costo en todos los planes.
 * EDITABLE — ajusta montos y features aquí.
 */
const PRICING = {
  basic: {
    name: "Basic", desc: "Para ordenar tu clínica desde el día uno", popular: false,
    monthly: 499, annual: 4192, plan: "basic",
    feats: [
      "Agenda con recordatorios por WhatsApp",
      "Expediente clínico + odontograma",
      "Facturación CFDI 4.0",
      "Portal del paciente",
      "1 consultorio · hasta 2 usuarios",
    ],
  },
  pro: {
    name: "Pro", desc: "La favorita de las clínicas dentales", popular: true,
    monthly: 999, annual: 8392, plan: "pro",
    feats: [
      "Todo lo de Basic, y además:",
      "Radiografías con análisis por IA",
      "Proveedores y laboratorios dentales",
      "Analytics, reportes y Mi Clínica Visual",
      "Hasta 3 consultorios · 6 usuarios",
    ],
  },
  clinic: {
    name: "Clinic", desc: "Para clínicas con varios consultorios", popular: false,
    monthly: 1999, annual: 16792, plan: "clinic",
    feats: [
      "Todo lo de Pro, y además:",
      "Consultorios y usuarios ilimitados",
      "Multi-sucursal y roles avanzados",
      "Soporte prioritario",
      "Migración y onboarding dedicado",
    ],
  },
} as const;

const ORDER = ["basic", "pro", "clinic"] as const;
const fmt = (n: number) => n.toLocaleString("es-MX");

export function Pricing() {
  const [annual, setAnnual] = useState(false);

  return (
    <section className="mfh-section mfh-band--violet" id="precios">
      <div className="mfh-container">
        <div className="mfh-head mfh-center mfh-reveal">
          <span className="mfh-kicker">Planes</span>
          <h2 className="mfh-h2 mfh-balance">Un precio claro, en pesos</h2>
          <p className="mfh-lede">Sin permanencia, cancela cuando quieras. Todos los planes incluyen migración, soporte en español y CFDI 4.0 / NOM-024.</p>

          <div className="mfh-toggle" role="group" aria-label="Periodo de facturación">
            <button type="button" className="mfh-toggle__btn" data-active={!annual} onClick={() => setAnnual(false)} aria-pressed={!annual}>
              Mensual
            </button>
            <button type="button" className="mfh-toggle__btn" data-active={annual} onClick={() => setAnnual(true)} aria-pressed={annual}>
              Anual <span className="mfh-toggle__save">Promoción 30% de descuento</span>
            </button>
          </div>

          {/* Aviso de promoción (solo aplica al plan anual). */}
          {annual && (
            <p className="mfh-price-notice" role="status" aria-live="polite">
              ⏳ Promoción válida por las próximas 72 horas
            </p>
          )}
        </div>

        <div className="mfh-plans">
          {ORDER.map((key) => {
            const p = PRICING[key];
            const amount = annual ? p.annual : p.monthly;
            return (
              <div key={key} className={`mfh-plan${p.popular ? " mfh-plan--pop" : ""} mfh-reveal`}>
                {p.popular && <span className="mfh-plan__pop">Recomendado</span>}
                <div>
                  <div className="mfh-plan__name">{p.name}</div>
                </div>
                <p className="mfh-plan__desc">{p.desc}</p>

                <div>
                  <div className="mfh-plan__price">
                    <span className="mfh-plan__amt">${fmt(amount)}</span>
                    <span className="mfh-plan__cur">MXN</span>
                    <span className="mfh-plan__per">{annual ? "/año" : "/mes"}</span>
                  </div>
                  <div className="mfh-plan__note" style={{ textAlign: "left", marginTop: 6 }}>
                    {annual ? "Facturado al año · 30% de descuento" : "Sin permanencia · cancela cuando quieras"}
                  </div>

                  {/* Instalación: $500 pago único tachado, incluido sin costo. */}
                  <p className="mfh-plan__install">
                    Costo de instalación:{" "}
                    <span className="mfh-plan__install-old">$500 pago único</span>{" "}
                    <span className="mfh-plan__install-free">✓ Incluido sin costo</span>
                  </p>
                </div>

                <div className="mfh-plan__feats">
                  {p.feats.map((f, i) => (
                    <div key={f} className="mfh-plan__feat" style={i === 0 && f.endsWith(":") ? { fontWeight: 700, color: "#0f172a" } : undefined}>
                      <Check /> <span>{f}</span>
                    </div>
                  ))}
                </div>

                <div className="mfh-plan__cta">
                  <Link
                    href={`/signup?plan=${p.plan}`}
                    className={`mfh-btn mfh-btn--block ${p.popular ? "mfh-btn--primary" : "mfh-btn--ghost"}`}
                  >
                    Elegir {p.name}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mfh-center" style={{ marginTop: 28, fontSize: 13.5, color: "#64748b", display: "inline-flex", gap: 8, alignItems: "center", width: "100%", justifyContent: "center" }}>
          <ShieldCheck size={16} style={{ color: "#7c3aed" }} />
          Incluye migración de tus datos, soporte en español y cumplimiento CFDI 4.0 / NOM-024.
        </p>
      </div>
    </section>
  );
}
