"use client";

import { useState } from "react";
import Link from "next/link";
import { PRICING_COPY, fmtMXN } from "./landing-data";
import type { PlanCard } from "./plan-cards";

/**
 * Sección de precios. NINGUNA cifra se escribe aquí: `cards` llega desde
 * `plan_configs` (page.tsx → getResolvedPlans → buildPlanCards). Importe
 * mensual, equivalente del anual, ahorro, % de descuento, promo del primer mes
 * y cupos salen todos de la base de datos; `firstMonthFrom` es
 * cheapestFirstMonthLabel(cards) y `yearlyDiscountPct` headlineYearlyDiscount(cards).
 *
 * Ajuste 4 (Rafael): rediseño con la MISMA paleta; el conmutador arranca en
 * ANUAL y el subtítulo depende del modo — la promo del primer mes NO aplica al
 * anual (lib/billing/first-month-promo.ts), así que en anual no se anuncia.
 * Los bloques que cambian entre modos (línea bajo el precio, subtexto del CTA)
 * tienen alto reservado para que el cambio no mueva la maquetación.
 *
 * CTA → /signup?plan=basic|pro|clinic&billing=monthly|annual.
 */

const num = (n: number) => n.toLocaleString("es-MX");

function Check({ on }: { on: boolean }) {
  return on ? (
    <svg className="dcv4-price__chk dcv4-price__chk--on" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" /></svg>
  ) : (
    <svg className="dcv4-price__chk" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
  );
}

export function PricingSection({ cards, firstMonthFrom, yearlyDiscountPct }: { cards: PlanCard[]; firstMonthFrom: string; yearlyDiscountPct: number }) {
  const [anual, setAnual] = useState(true);

  return (
    <section id="precios" className="dcv4-price" style={{ scrollMarginTop: 72 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(56px,7vw,92px) 20px" }}>
        <div data-reveal="" className="dcv4-price__head">
          <span className="dcv4-eyebrow">{PRICING_COPY.eyebrow}</span>
          <h2 className="dcv4-balance dcv4-h2">{PRICING_COPY.title}</h2>

          {/* Subtítulo según el modo. Los importes vienen de plan_configs. */}
          <p className="dcv4-pretty dcv4-price__sub" aria-live="polite">
            {anual ? (
              <>
                Pagando el año completo ahorras un <strong>{yearlyDiscountPct}%</strong> frente al mes a mes. Sin permanencia.
              </>
            ) : (
              <>
                Regístrate hoy: tu primer mes cuesta desde <strong>{firstMonthFrom}</strong> y no hay permanencia.
              </>
            )}
          </p>

          <div role="group" aria-label="Periodo de facturación" className="dcv4-price__toggle">
            {/* Mensual a la izquierda y Anual a la derecha (con su −%), como estaba; ANUAL sigue seleccionado por defecto. */}
            <button type="button" className={`dcv4-price__tbtn${!anual ? " is-on" : ""}`} onClick={() => setAnual(false)} aria-pressed={!anual}>
              {PRICING_COPY.toggleMonthly}
            </button>
            <button type="button" className={`dcv4-price__tbtn${anual ? " is-on" : ""}`} onClick={() => setAnual(true)} aria-pressed={anual}>
              {PRICING_COPY.toggleYearly}
              <span className="dcv4-price__tpill">−{yearlyDiscountPct}%</span>
            </button>
          </div>
        </div>

        <div className="dcv4-price__grid">
          {cards.map((p) => (
            <article key={p.id} data-reveal="" className={`dcv4-plan dcv4-price__card${p.recommended ? " dcv4-plan--featured is-featured" : ""}`}>
              <span className="dcv4-price__badge" style={{ background: p.badgeColor }}>{p.badge}</span>

              <h3 className="dcv4-price__name">{p.name}</h3>
              <p className="dcv4-price__tagline">{p.tagline}</p>

              {/* precio dinámico: plan_configs */}
              <p className="dcv4-price__amount">
                <span className="dcv4-price__cur">$</span>
                <span className="dcv4-price__num">{num(anual ? p.yearlyPerMonth : p.monthly)}</span>
                <span className="dcv4-price__per">
                  <span>MXN</span>
                  <span>/ mes</span>
                </span>
              </p>
              {/* Una sola ranura de DOS renglones para ambos modos: mismo alto, sin saltos al conmutar. */}
              <p className="dcv4-price__line">
                <span className="dcv4-price__l1">
                  <span className="dcv4-price__save">{anual ? `−${p.yearlyDiscountPct}%` : "1.er mes"}</span>
                  {anual ? `${fmtMXN(p.yearly)} al año` : `solo ${fmtMXN(p.firstMonth)}`}
                </span>
                <span className="dcv4-price__l2">{anual ? `Ahorras ${fmtMXN(p.yearlySavings)} frente al mes a mes` : `Ahorras ${fmtMXN(p.monthly - p.firstMonth)} el primer mes`}</span>
              </p>
              <p className="dcv4-price__nocontract">{PRICING_COPY.noContract}</p>

              {/* Cupos: pacientes/usuarios/almacenamiento/tokens de plan_configs */}
              <ul className="dcv4-price__caps">
                {p.capacity.map((c) => (
                  <li key={c.text} className={`dcv4-price__cap${c.included ? "" : " is-off"}`}>
                    <span className="dcv4-price__caplabel">{c.text}</span>
                    <span className="dcv4-price__capvalue">{c.value}</span>
                    <span className="dcv4-sr">{c.included ? "Incluido" : "No incluido"}</span>
                  </li>
                ))}
              </ul>

              {p.addendum && <p className="dcv4-price__addendum">{p.addendum}</p>}

              <ul className="dcv4-price__feats">
                {p.features.map((f) => (
                  <li key={f.text} className={`dcv4-price__feat${f.included ? "" : " is-off"}`}>
                    <Check on={f.included} />
                    <span className="dcv4-sr">{f.included ? "Incluido:" : "No incluido:"}</span>
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>

              <span aria-hidden="true" className="dcv4-price__spacer" />

              {/* precio dinámico: plan_configs */}
              <Link href={`/signup?plan=${p.signupParam}&billing=${anual ? "annual" : "monthly"}`} className="dcv2-btn-plan dcv4-price__cta">
                <span>{PRICING_COPY.cta}</span>
                <span className="dcv4-price__ctasub">{anual ? `Un cobro al año: ${fmtMXN(p.yearly)} MXN` : `Empieza hoy por solo ${fmtMXN(p.firstMonth)} MXN`}</span>
              </Link>
            </article>
          ))}
        </div>

        <ul data-reveal="" className="dcv4-price__chips">
          {PRICING_COPY.trustChips.map((chip) => (
            <li key={chip}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" /></svg>
              {chip}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
