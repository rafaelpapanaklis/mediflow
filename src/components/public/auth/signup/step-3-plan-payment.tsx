"use client";

import Link from "next/link";
import { getPlan } from "@/lib/billing/plans";
import type { Billing, PlanId } from "./plan-card";

// Compat: el wizard (signup-form) aún tipa `card` en su estado. Se conserva el
// tipo aunque ya NO capturamos tarjeta aquí — el pago se hace en Stripe Checkout
// (hosted), nunca en nuestra UI (evita riesgo PCI).
export interface CardDetails {
  number: string;
  expiry: string;
  cvc: string;
  name: string;
  zip: string;
}

export type PayMethod = "card" | "spei" | "oxxo";

export interface Step3Values {
  plan: PlanId;
  billing: Billing;
  payMethod: PayMethod;
  card: CardDetails;
  coupon: string;
  acceptedTerms: boolean;
  acceptedCharge: boolean;
}

interface Step3Props {
  values: Step3Values;
  onChange: (v: Partial<Step3Values>) => void;
  onBack: () => void;
  onSubmit: () => void;
  loading: boolean;
}

const METHODS: Array<{ id: PayMethod; label: string; desc: string; icon: string }> = [
  { id: "card", label: "Tarjeta", desc: "Se renueva automáticamente cada mes.", icon: "💳" },
  { id: "spei", label: "Transferencia SPEI", desc: "Recibes una CLABE y depositas. Cubre 1 mes.", icon: "🏦" },
  { id: "oxxo", label: "Efectivo en OXXO", desc: "Recibes un voucher y pagas en tienda. Cubre 1 mes.", icon: "🧾" },
];

function fmtMxn(n: number): string {
  return `$${n.toLocaleString("es-MX")}`;
}

export function Step3PlanPayment({ values, onChange, onBack, onSubmit, loading }: Step3Props) {
  const plan = getPlan(values.plan);
  const isAsync = values.payMethod === "spei" || values.payMethod === "oxxo";
  const canSubmit = values.acceptedTerms && !loading;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Resumen del plan (precio único desde plans.ts) */}
      <div
        style={{
          padding: 18,
          borderRadius: 14,
          border: "1px solid var(--ld-border)",
          background: "linear-gradient(180deg, rgba(124,58,237,0.10), rgba(124,58,237,0.02))",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ld-fg-muted)" }}>
              Plan elegido
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ld-fg)" }}>{plan.name}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--ld-fg)" }}>
              {fmtMxn(plan.priceMxn)}
            </span>
            <span style={{ fontSize: 13, color: "var(--ld-fg-muted)", marginLeft: 4 }}>MXN/mes</span>
          </div>
        </div>

        <div style={{ height: 1, background: "var(--ld-border)" }} />

        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {plan.features.map((f, i) => (
            <li key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, color: "var(--ld-fg-muted)" }}>
              <span aria-hidden="true" style={{ color: "#34d399" }}>✓</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <Link href="/#precios" style={{ fontSize: 12, color: "var(--ld-brand-light)", textDecoration: "none", alignSelf: "flex-start" }}>
          Cambiar plan
        </Link>
      </div>

      {/* Selector de método de pago */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ld-fg)" }}>Método de pago</div>
        {METHODS.map((m) => {
          const selected = values.payMethod === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange({ payMethod: m.id })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                textAlign: "left",
                padding: 14,
                borderRadius: 12,
                cursor: "pointer",
                fontFamily: "inherit",
                color: "var(--ld-fg)",
                border: `1px solid ${selected ? "rgba(124,58,237,0.6)" : "var(--ld-border)"}`,
                background: selected ? "rgba(124,58,237,0.10)" : "rgba(255,255,255,0.02)",
                boxShadow: selected ? "0 0 0 3px rgba(124,58,237,0.1)" : "none",
                transition: "all .15s",
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 22 }}>{m.icon}</span>
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{m.label}</span>
                <span style={{ display: "block", fontSize: 12, color: "var(--ld-fg-muted)", marginTop: 2 }}>{m.desc}</span>
              </span>
              <span
                aria-hidden="true"
                style={{
                  width: 18,
                  height: 18,
                  flexShrink: 0,
                  borderRadius: 18,
                  border: `2px solid ${selected ? "var(--ld-brand-light)" : "rgba(255,255,255,0.2)"}`,
                  background: selected ? "radial-gradient(circle, var(--ld-brand-light) 45%, transparent 50%)" : "transparent",
                }}
              />
            </button>
          );
        })}

        {isAsync && (
          <div
            style={{
              fontSize: 12,
              color: "#fbbf24",
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: 10,
              padding: "10px 12px",
              lineHeight: 1.5,
            }}
          >
            Pago único de 1 mes. Tu plan se activa cuando se confirme el depósito y
            <strong> no se renueva solo</strong>; al vencer pagas otro periodo.
          </div>
        )}
      </div>

      {/* Términos */}
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={values.acceptedTerms}
          onChange={(e) => onChange({ acceptedTerms: e.target.checked })}
          style={{ marginTop: 2, width: 16, height: 16, accentColor: "#7c3aed" }}
        />
        <span style={{ fontSize: 12, color: "var(--ld-fg-muted)", lineHeight: 1.5 }}>
          Acepto los{" "}
          <Link href="/legal/terminos" style={{ color: "var(--ld-brand-light)", textDecoration: "none" }}>
            términos
          </Link>{" "}
          y la{" "}
          <Link href="/legal/privacy" style={{ color: "var(--ld-brand-light)", textDecoration: "none" }}>
            política de privacidad
          </Link>
          .
        </span>
      </label>

      {/* Acciones */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          onClick={onBack}
          disabled={loading}
          style={{
            height: 46,
            padding: "0 18px",
            borderRadius: 12,
            border: "1px solid var(--ld-border)",
            background: "transparent",
            color: "var(--ld-fg-muted)",
            fontWeight: 500,
            cursor: loading ? "default" : "pointer",
            fontFamily: "inherit",
            fontSize: 14,
          }}
        >
          Atrás
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{
            flex: 1,
            height: 46,
            borderRadius: 12,
            border: "none",
            background: canSubmit ? "linear-gradient(90deg, #a78bfa, #7c3aed)" : "rgba(255,255,255,0.08)",
            color: canSubmit ? "#fff" : "var(--ld-fg-muted)",
            fontWeight: 700,
            fontSize: 15,
            cursor: canSubmit ? "pointer" : "not-allowed",
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {loading ? "Procesando…" : "Pagar y activar →"}
        </button>
      </div>
    </div>
  );
}
