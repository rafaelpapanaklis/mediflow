"use client";

import { useState } from "react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { PRICING_COPY, fmtMXN } from "./landing-data";
import type { PlanCard } from "./plan-cards";

/**
 * Sección de precios. NINGUNA cifra se escribe aquí: `cards` llega desde
 * `plan_configs` (page.tsx → getResolvedPlans → buildPlanCards). Importe
 * mensual, equivalente del anual, ahorro, % de descuento, promo del primer mes
 * y cupos salen todos de la base de datos.
 *
 * CTA → /signup?plan=basic|pro|clinic&billing=monthly|annual (el signup valida
 * ?plan= contra PlanId — ver signup-form.tsx).
 */

const BADGE_SHADOW: Record<string, string> = {
  "#047857": "rgba(4,120,87,.35)",
  "#2563eb": "rgba(37,99,235,.35)",
  "#1e3a8a": "rgba(30,58,138,.35)",
};

const srOnly: CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

const capRow: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 };
const featRow: CSSProperties = { display: "flex", gap: 9, fontSize: 13.5, lineHeight: 1.45 };

export function PricingSection({ cards, firstMonthFrom, yearlyDiscountPct }: { cards: PlanCard[]; firstMonthFrom: string; yearlyDiscountPct: number }) {
  const [anual, setAnual] = useState(false);

  const toggle = (active: boolean): CSSProperties => ({
    border: 0,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 700,
    borderRadius: 999,
    padding: "9px 20px",
    background: active ? "#2563eb" : "transparent",
    color: active ? "#ffffff" : "#475569",
  });

  return (
    <section id="precios" style={{ scrollMarginTop: 72, background: "radial-gradient(900px 480px at 50% 0%,#eff6ff,rgba(239,246,255,0) 70%),#f8fafc" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(56px,7vw,92px) 20px" }}>
        <div data-reveal="" style={{ textAlign: "center", maxWidth: 680, margin: "0 auto" }}>
          <span style={{ display: "inline-block", background: "#eff6ff", border: "1px solid #dbeafe", color: "#1d4ed8", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.1em", borderRadius: 999, padding: "7px 15px", textTransform: "uppercase" }}>
            {PRICING_COPY.eyebrow}
          </span>
          <h2 className="dcv4-balance" style={{ marginTop: 18, fontSize: "clamp(27px,3.4vw,42px)", lineHeight: 1.08, letterSpacing: "-0.035em", fontWeight: 800 }}>
            {PRICING_COPY.title}
          </h2>
          {/* precio dinámico: plan_configs */}
          <p style={{ marginTop: 14, fontSize: "clamp(15.5px,1.45vw,18px)", color: "#475569" }}>
            Regístrate hoy: tu primer mes cuesta desde <strong style={{ color: "#1d4ed8", fontWeight: 800 }}>{firstMonthFrom}</strong> y no hay permanencia.
          </p>
          <div role="group" aria-label="Periodo de facturación" style={{ marginTop: 22, display: "inline-flex", alignItems: "center", gap: 6, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 999, padding: 5, boxShadow: "0 8px 22px -14px rgba(15,23,42,0.3)" }}>
            <button type="button" className="dcv2-toggle-btn" onClick={() => setAnual(false)} aria-pressed={!anual} style={toggle(!anual)}>
              {PRICING_COPY.toggleMonthly}
            </button>
            <button type="button" className="dcv2-toggle-btn" onClick={() => setAnual(true)} aria-pressed={anual} style={toggle(anual)}>
              {PRICING_COPY.toggleYearly}
            </button>
            {/* el % sale del precio anual real de plan_configs */}
            <span style={{ fontSize: 12, fontWeight: 700, color: "#15803d", background: "#dcfce7", borderRadius: 999, padding: "5px 11px", marginRight: 4, whiteSpace: "nowrap" }}>
              {yearlyDiscountPct}% de descuento
            </span>
          </div>
        </div>

        <div style={{ marginTop: "clamp(34px,4.2vw,52px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(292px,1fr))", gap: "clamp(16px,2vw,24px)", alignItems: "stretch" }}>
          {cards.map((p) => (
            <article
              key={p.id}
              data-reveal=""
              className={p.recommended ? "dcv4-plan dcv4-plan--featured" : "dcv4-plan"}
              style={{
                position: "relative",
                background: "#ffffff",
                border: p.recommended ? "2px solid #2563eb" : "1px solid #e2e8f0",
                borderRadius: 18,
                padding: "26px 24px",
                display: "flex",
                flexDirection: "column",
                boxShadow: p.recommended ? "0 34px 64px -36px rgba(37,99,235,0.6)" : "0 24px 48px -36px rgba(15,23,42,0.45)",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: -13,
                  ...(p.recommended ? { left: "50%", transform: "translateX(-50%)" } : { left: 24 }),
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#ffffff",
                  background: p.badgeColor,
                  borderRadius: 999,
                  padding: "5px 13px",
                  whiteSpace: "nowrap",
                  boxShadow: `0 6px 16px ${BADGE_SHADOW[p.badgeColor] ?? "rgba(15,23,42,.25)"}`,
                }}
              >
                {p.badge}
              </span>

              <h3 style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.08em", color: "#1d4ed8", textTransform: "uppercase" }}>{p.name}</h3>
              <p style={{ marginTop: 6, fontSize: 14, color: "#475569" }}>{p.tagline}</p>

              {/* precio dinámico: plan_configs */}
              <p style={{ marginTop: 16 }}>
                <span style={{ fontSize: 42, fontWeight: 800, letterSpacing: "-0.03em", color: "#0f172a" }}>{fmtMXN(anual ? p.yearlyPerMonth : p.monthly)}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#64748b" }}> MXN /mes</span>
              </p>
              {anual && (
                <p style={{ marginTop: 4, fontSize: 12.5, fontWeight: 700, color: "#15803d" }}>
                  −{p.yearlyDiscountPct}% al pagar anual · {fmtMXN(p.yearly)} al año ({fmtMXN(p.yearlySavings)} de ahorro)
                </p>
              )}
              <p style={{ marginTop: 6, fontSize: 12.5, color: "#64748b" }}>{PRICING_COPY.noContract}</p>

              {/* Promo del primer mes: SOLO en mensual. La regla de negocio
                  (lib/billing/first-month-promo.ts) excluye el plan anual, así
                  que anunciarla ahí sería falso. */}
              {!anual && (
                <p style={{ marginTop: 12, fontSize: 13, color: "#334155", background: "#f0fdf4", border: "1px solid #dcfce7", borderRadius: 10, padding: "10px 12px" }}>
                  Tu primer mes: <strong style={{ color: "#15803d", fontWeight: 800 }}>solo {fmtMXN(p.firstMonth)}</strong> · ahorras {fmtMXN(p.monthly - p.firstMonth)}
                </p>
              )}

              {/* Cupos: pacientes/usuarios/almacenamiento/tokens de plan_configs */}
              <ul style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 9, borderBottom: "1px solid #f1f5f9", paddingBottom: 16 }}>
                {p.capacity.map((c) => (
                  <li key={c.text} style={{ ...capRow, color: c.included ? "#334155" : "#64748b" }}>
                    <span>
                      <span aria-hidden="true">{c.included ? "✓" : "✗"}</span>
                      <span style={srOnly}>{c.included ? "Incluido:" : "No incluido:"}</span> {c.text}
                    </span>
                    <span style={{ fontWeight: 700, color: c.included ? "#1d4ed8" : "#475569", background: c.included ? "#eff6ff" : "#f1f5f9", borderRadius: 999, padding: "2px 10px", fontSize: 12.5, whiteSpace: "nowrap" }}>
                      {c.value}
                    </span>
                  </li>
                ))}
              </ul>

              {p.addendum && <p style={{ marginTop: 16, fontSize: 13.5, fontWeight: 800, color: "#0f172a" }}>{p.addendum}</p>}

              <ul style={{ marginTop: p.addendum ? 10 : 16, display: "flex", flexDirection: "column", gap: 9 }}>
                {/* Los bullets NO incluidos van en slate-500, no slate-400:
                    sobre blanco el #94a3b8 se queda en 2.8:1 y no pasa AA. */}
                {p.features.map((f) => (
                  <li key={f.text} style={{ ...featRow, color: f.included ? "#334155" : "#64748b" }}>
                    <span aria-hidden="true" style={{ color: f.included ? "#15803d" : undefined, fontWeight: 800, flex: "0 0 auto" }}>{f.included ? "✓" : "✗"}</span>
                    <span style={srOnly}>{f.included ? "Incluido:" : "No incluido:"}</span>
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>

              <span aria-hidden="true" style={{ display: "block", minHeight: 22, flex: "1 1 auto" }} />

              {/* precio dinámico: plan_configs */}
              <Link
                href={`/signup?plan=${p.signupParam}&billing=${anual ? "annual" : "monthly"}`}
                className="dcv2-btn-plan"
                style={{ marginTop: "auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, minHeight: 56, background: "#2563eb", color: "#ffffff", borderRadius: 12, fontWeight: 700, fontSize: 15.5 }}
              >
                {PRICING_COPY.cta}
                {!anual && (
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "#dbeafe" }}>Empieza hoy por solo {fmtMXN(p.firstMonth)} MXN</span>
                )}
              </Link>
            </article>
          ))}
        </div>

        <ul data-reveal="" style={{ marginTop: "clamp(28px,3.6vw,44px)", display: "flex", flexWrap: "wrap", gap: 9, justifyContent: "center" }}>
          {PRICING_COPY.trustChips.map((chip) => (
            <li key={chip} style={{ fontSize: 13, fontWeight: 600, color: "#334155", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 999, padding: "8px 15px" }}>
              ✓ {chip}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
