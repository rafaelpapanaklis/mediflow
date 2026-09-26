"use client";

import { useState, type CSSProperties } from "react";
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
 * Ajuste 4 (Rafael): rediseño con la MISMA paleta; el subtítulo depende del modo — la promo del primer mes NO aplica al
 * anual (lib/billing/first-month-promo.ts), así que en anual no se anuncia.
 * Los bloques que cambian entre modos (línea bajo el precio, subtexto del CTA)
 * tienen alto reservado para que el cambio no mueva la maquetación.
 *
 * Ajuste 8 (Rafael): misma estructura y textos, acabado más cuidado. El TSX solo
 * aporta ganchos: el deslizador del conmutador (`dcv4-price__thumb`), un `key`
 * por modo en la cifra y en la línea de abajo (la animación de entrada vive en
 * el CSS, `dcPriceIn`), la variable `--plan-accent` (color de la insignia, que
 * ya venía de plan-cards) y las capas decorativas del fondo. Todo lo visual
 * está en landing-v2.css bajo «Precios (ajuste 8)».
 *
 * Ajuste 9/10 (Rafael): las funciones se leen de un vistazo y se comparan.
 * Cada tarjeta abre con seis funciones base en ✓ (las mismas y en el mismo
 * orden), sigue con lo que cambia entre planes (✓/✗ calculado) y cierra con
 * lo exclusivo del plan como ✓ normales (10b: sin rótulo; plan-cards.ts →
 * splitFeatures). Las funciones base completas van UNA sola vez debajo de las
 * tarjetas, en «Incluido en todos los planes»
 * (`includedInAll`, derivado de los flags de módulo de plan_configs). Cada
 * tarjeta lleva un chip que salta a ese bloque. Cupos: se añade «Sedes»
 * (maxClinics); la quinta ficha ocupa el ancho completo.
 *
 * CTA → /signup?plan=basic|pro|clinic&billing=monthly|annual.
 */

const num = (n: number) => n.toLocaleString("es-MX");

/* Ajuste 9: rótulos del bloque común (sin cifras). */
const PRICING_ALL_TITLE = "Incluido en todos los planes";
const PRICING_ALL_SUB = "Las funciones base van en Básico, Profesional y Clínica. Las tarjetas muestran solo lo que cambia.";
const PRICING_ALL_CHIP = "Todo lo esencial incluido";
/** Ajuste 11: en Profesional y Clínica el chip nombra al plan anterior (label de plan_configs). */
const chipText = (previous: string | null) => (previous ? `Todo lo de ${previous} + lo esencial` : PRICING_ALL_CHIP);

function Check({ on }: { on: boolean }) {
  return on ? (
    <svg className="dcv4-price__chk dcv4-price__chk--on" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" /></svg>
  ) : (
    <svg className="dcv4-price__chk" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
  );
}

export function PricingSection({ cards, firstMonthFrom, yearlyDiscountPct }: { cards: PlanCard[]; firstMonthFrom: string; yearlyDiscountPct: number }) {
  // Ajuste 7 (Rafael): arranca en MENSUAL (antes, ajuste 4, arrancaba en anual).
  const [anual, setAnual] = useState(false);
  // La lista común es la misma en las tres tarjetas (plan-cards.ts la calcula una vez).
  const includedInAll = cards[0]?.includedInAll ?? [];
  // Ajuste 14 (Rafael, «que esté alineado»): en escritorio cada tarjeta es un
  // subgrid de filas del grid de tarjetas, así la misma función queda a la misma
  // altura en las tres y los botones en la misma línea. Pistas por tarjeta =
  // 8 bloques de cabecera (nombre, eslogan, precio, línea, sin permanencia,
  // cupos, chip, «Qué incluye») + tantas filas como la lista más larga +
  // espaciador + botón. El CSS coloca espaciador y botón en las dos últimas.
  const HEAD_TRACKS = 8;
  const rowTracks = HEAD_TRACKS + Math.max(0, ...cards.map((c) => c.features.length)) + 2;

  return (
    <section id="precios" className="dcv4-price" style={{ scrollMarginTop: 72 }}>
      {/* Fondo: rejilla de puntos + dos brillos suaves (puro CSS, sin imágenes). */}
      <div aria-hidden="true" className="dcv4-price__bg" />
      <div className="dcv4-price__wrap" style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(56px,7vw,92px) 20px" }}>
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

          <div role="group" aria-label="Periodo de facturación" className="dcv4-price__toggle" data-mode={anual ? "anual" : "mensual"}>
            {/* Deslizador que se mueve bajo la opción activa (ajuste 8). */}
            <span aria-hidden="true" className="dcv4-price__thumb" />
            {/* Mensual a la izquierda y Anual a la derecha (con su −%); MENSUAL seleccionado por defecto (ajuste 7). */}
            <button type="button" className={`dcv4-price__tbtn${!anual ? " is-on" : ""}`} onClick={() => setAnual(false)} aria-pressed={!anual}>
              {PRICING_COPY.toggleMonthly}
            </button>
            <button type="button" className={`dcv4-price__tbtn${anual ? " is-on" : ""}`} onClick={() => setAnual(true)} aria-pressed={anual}>
              {PRICING_COPY.toggleYearly}
              <span className="dcv4-price__tpill">−{yearlyDiscountPct}%</span>
            </button>
          </div>
        </div>

        <div className="dcv4-price__grid" style={{ "--rows": rowTracks } as CSSProperties}>
          {cards.map((p) => (
            <article
              key={p.id}
              data-reveal=""
              className={`dcv4-plan dcv4-price__card${p.recommended ? " dcv4-plan--featured is-featured" : ""}`}
              style={{ "--plan-accent": p.badgeColor } as CSSProperties}
            >
              <span className="dcv4-price__badge" style={{ background: p.badgeColor }}>{p.badge}</span>

              <h3 className="dcv4-price__name">{p.name}</h3>
              <p className="dcv4-price__tagline">{p.tagline}</p>

              {/* precio dinámico: plan_configs */}
              <p className="dcv4-price__amount">
                <span className="dcv4-price__cur">$</span>
                {/* `key` por modo: al conmutar, la cifra entra con un fundido corto (CSS). */}
                <span key={anual ? "a" : "m"} className="dcv4-price__num">{num(anual ? p.yearlyPerMonth : p.monthly)}</span>
                <span className="dcv4-price__per">
                  <span className="dcv4-price__mxn">MXN</span>
                  <span className="dcv4-price__mes">/ mes</span>
                  {/* Ajuste 8b (Rafael): «+ IVA» junto a cada precio, en ambos modos. */}
                  <span className="dcv4-price__iva">+ IVA</span>
                </span>
              </p>
              {/* Una sola ranura de DOS renglones para ambos modos: mismo alto, sin saltos al conmutar. */}
              <p key={anual ? "a" : "m"} className="dcv4-price__line">
                {/* Mensual (Rafael, ajuste 7): la píldora verde dice «Primer mes pagas» y en negro «solo $19 MXN» (importe del plan). */}
                <span className="dcv4-price__l1">
                  <span className="dcv4-price__save">{anual ? `−${p.yearlyDiscountPct}%` : "Primer mes pagas"}</span>
                  <span>{anual ? `${fmtMXN(p.yearly)} al año` : `solo ${fmtMXN(p.firstMonth)} MXN`}</span>
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

              {/* Ajuste 9: lo base está en los tres planes; el chip salta al bloque común de abajo. */}
              <a href="#precios-incluido" className="dcv4-price__all">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" /></svg>
                <span>{chipText(p.previousPlanLabel)}</span>
              </a>

              {p.addendum && <p className="dcv4-price__addendum">{p.addendum}</p>}

              {/* role="list": con `display: contents` (subgrid) algunos navegadores pierden la semántica de lista. */}
              <ul className="dcv4-price__feats" role="list">
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

        {/* Ajuste 9: funciones base, una sola vez para los tres planes (misma lista en cada tarjeta: plan-cards.ts). */}
        {includedInAll.length > 0 && (
          <div id="precios-incluido" data-reveal="" className="dcv4-price__common" style={{ scrollMarginTop: 88 }}>
            <div className="dcv4-price__commonhead">
              <h3 className="dcv4-price__commontitle">{PRICING_ALL_TITLE}</h3>
              <p className="dcv4-price__commonsub">{PRICING_ALL_SUB}</p>
            </div>
            <ul className="dcv4-price__commonlist">
              {includedInAll.map((f) => (
                <li key={f}>
                  <svg className="dcv4-price__chk dcv4-price__chk--on" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" /></svg>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

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
