"use client";

import { useState } from "react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { PLANS, PRICING_COPY, fmtMXN, type Plan } from "./landing-data";

/**
 * Sección de precios: toggle Mensual/Anual + 3 tarjetas.
 * CTA → /signup?plan=basic|pro|clinic&billing=monthly|annual — el signup
 * valida ?plan= contra PlanId (BASIC|PRO|CLINIC), ver signup-form.tsx.
 */
const PLAN_TO_SIGNUP: Record<Plan["key"], "basic" | "pro" | "clinic"> = {
  basico: "basic",
  profesional: "pro",
  clinica: "clinic",
};

const srOnly: CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

function CrossIcon({ size = 19, width = 2.2 }: { size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 7l10 10M17 7L7 17" stroke="#cbd5e1" strokeWidth={width} strokeLinecap="round" />
    </svg>
  );
}

export function PricingSection() {
  const [period, setPeriod] = useState<"mensual" | "anual">("mensual");
  const anual = period === "anual";

  const toggleActive: CSSProperties = { background: "#2563eb", color: "#fff", boxShadow: "0 2px 8px rgba(37,99,235,.32)" };
  const toggleIdle: CSSProperties = { background: "transparent", color: "#475569" };

  return (
    <section id="precios" style={{ scrollMarginTop: 80, background: "radial-gradient(1000px 480px at 50% -60px,#dbeafe 0%,#fff 60%)", padding: "80px 20px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ textAlign: "center", maxWidth: 660, margin: "0 auto 28px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#2563eb", marginBottom: 12 }}>{PRICING_COPY.eyebrow}</div>
          <h2 style={{ fontSize: "clamp(28px,3.4vw,40px)", lineHeight: 1.15, fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 12px" }}>{PRICING_COPY.title}</h2>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: "#475569", margin: 0 }}>{PRICING_COPY.subtitle}</p>
        </div>

        {/* Toggle Mensual / Anual */}
        <div role="group" aria-label="Periodo de facturación" style={{ display: "flex", justifyContent: "center", marginBottom: 36 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#fff", border: "1px solid #dbe4f3", borderRadius: 999, padding: 5, boxShadow: "0 2px 14px rgba(30,64,175,.07)" }}>
            <button
              type="button"
              className="dcv2-toggle-btn"
              onClick={() => setPeriod("mensual")}
              aria-pressed={!anual}
              style={{ padding: "11px 26px", border: "none", borderRadius: 999, fontFamily: "inherit", fontWeight: 600, fontSize: 15, cursor: "pointer", ...(anual ? toggleIdle : toggleActive) }}
            >
              {PRICING_COPY.toggleMonthly}
            </button>
            <button
              type="button"
              className="dcv2-toggle-btn"
              onClick={() => setPeriod("anual")}
              aria-pressed={anual}
              style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "11px 22px", border: "none", borderRadius: 999, fontFamily: "inherit", fontWeight: 600, fontSize: 15, cursor: "pointer", ...(anual ? toggleActive : toggleIdle) }}
            >
              {PRICING_COPY.toggleYearly}
              <span style={{ fontSize: 12, fontWeight: 700, color: "#15803d", background: "#dcfce7", padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap" }}>{PRICING_COPY.yearlyBadge}</span>
            </button>
          </div>
        </div>

        {/* Tarjetas */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))", gap: 22, alignItems: "start" }}>
          {PLANS.map((p) => {
            const big = anual ? p.yearlyPerMonth : p.monthly;
            const billing = anual ? "annual" : "monthly";
            const cardStyle: CSSProperties = p.recommended
              ? { position: "relative", background: "#fff", border: "2px solid #2563eb", borderRadius: 22, padding: "34px 26px 28px", display: "flex", flexDirection: "column", boxShadow: "0 18px 44px rgba(37,99,235,.18)" }
              : { position: "relative", background: "#fff", border: "1px solid #e8edf5", borderRadius: 22, padding: "30px 26px 28px", display: "flex", flexDirection: "column", boxShadow: "0 4px 22px rgba(30,64,175,.05)" };
            return (
              <article key={p.key} style={cardStyle}>
                {p.recommended && (
                  <div style={{ position: "absolute", top: -14, left: "50%", transform: "translateX(-50%)", background: "#2563eb", color: "#fff", fontSize: 12.5, fontWeight: 700, letterSpacing: ".03em", padding: "7px 18px", borderRadius: 999, boxShadow: "0 6px 16px rgba(37,99,235,.35)", whiteSpace: "nowrap" }}>
                    {PRICING_COPY.popularBadge}
                  </div>
                )}
                <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#1d4ed8" }}>{p.name}</div>
                <p style={{ fontSize: 15, color: "#475569", margin: "8px 0 0", lineHeight: 1.45, minHeight: 42 }}>{p.tagline}</p>
                <div style={{ marginTop: 18, display: "flex", alignItems: "flex-end", gap: 8 }}>
                  <span style={{ fontSize: 46, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>{fmtMXN(big)}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#64748b", paddingBottom: 8 }}>MXN<br />/mes</span>
                </div>
                <div style={{ marginTop: 6, fontSize: 13, color: "#94a3b8" }}>{PRICING_COPY.noContract}</div>
                {anual && (
                  <div style={{ marginTop: 8, fontSize: 13.5, color: "#334155" }}>
                    {PRICING_COPY.billedYearly(fmtMXN(p.yearly))} · <span style={{ color: "#15803d", fontWeight: 600 }}>{PRICING_COPY.savings(fmtMXN(p.yearlySavings))}</span>
                  </div>
                )}
                <div style={{ height: 1, background: "#e8edf5", margin: "20px 0 14px" }} />

                {/* Capacidades con pill */}
                <ul style={{ listStyle: "none", margin: "0 0 14px", padding: "0 0 14px", borderBottom: "1px solid #e8edf5", display: "flex", flexDirection: "column", gap: 1 }}>
                  {p.capacity.map((c) => (
                    <li key={c.text} style={{ display: "flex", gap: 11, alignItems: "center", padding: "6px 0" }}>
                      <span style={{ flex: "0 0 auto", display: "flex" }}>
                        {c.included
                          ? <span style={{ color: "#2563eb", fontWeight: 800, fontSize: 14 }} aria-hidden="true">✓</span>
                          : <CrossIcon size={16} width={2.4} />}
                      </span>
                      <span style={srOnly}>{c.included ? "Incluido:" : "No incluido:"}</span>
                      <span style={{ flex: 1, color: c.included ? "#334155" : "#64748b", fontSize: 14.5 }}>{c.text}</span>
                      <span style={{ flex: "0 0 auto", fontSize: 13, fontWeight: 700, color: c.included ? "#1e40af" : "#64748b", background: c.included ? "#eff6ff" : "#f1f5f9", padding: "3px 11px", borderRadius: 999 }}>{c.value}</span>
                    </li>
                  ))}
                </ul>

                {p.addendum && (
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>{p.addendum}</div>
                )}

                {/* Features ✓/✗ */}
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                  {p.features.map((f) => (
                    <li key={f.text} style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "7px 0" }}>
                      <span style={{ flex: "0 0 auto", marginTop: 1 }}>
                        {f.included ? (
                          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ color: "#2563eb" }}>
                            <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : (
                          <CrossIcon />
                        )}
                      </span>
                      <span style={srOnly}>{f.included ? "Incluido:" : "No incluido:"}</span>
                      <span style={{ color: f.included ? "#334155" : "#64748b", fontSize: 14.5, lineHeight: 1.5 }}>{f.text}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={`/signup?plan=${PLAN_TO_SIGNUP[p.key]}&billing=${billing}`}
                  className={p.recommended ? "dcv2-btn-primary" : "dcv2-btn-plan-sec"}
                  style={
                    p.recommended
                      ? { marginTop: 22, display: "block", textAlign: "center", width: "100%", padding: 14, borderRadius: 13, border: "none", background: "#2563eb", fontSize: 15.5, fontWeight: 700, color: "#fff", boxShadow: "0 8px 20px rgba(37,99,235,.30)" }
                      : { marginTop: 22, display: "block", textAlign: "center", width: "100%", padding: 14, borderRadius: 13, border: "1.5px solid #dbe4f3", background: "#fff", fontSize: 15.5, fontWeight: 700, color: "#1d4ed8" }
                  }
                >
                  {PRICING_COPY.cta}
                </Link>
              </article>
            );
          })}
        </div>

        {/* Chips de confianza */}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12, marginTop: 34 }}>
          {PRICING_COPY.trustChips.map((chip) => (
            <div key={chip} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #e8edf5", borderRadius: 999, padding: "10px 18px", fontSize: 14, fontWeight: 600, color: "#334155" }}>
              <span style={{ color: "#2563eb", fontWeight: 800 }}>✓</span> {chip}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
