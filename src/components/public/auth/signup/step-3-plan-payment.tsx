"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PlanCard, type Billing, type PlanId } from "./plan-card";
import { cfdiBullet } from "@/lib/plan-shared";
import { botonFantasma, botonPrimario } from "./estilos";

interface ApiPlan {
  id: PlanId;
  name: string;
  priceMxn: number;
  priceMxnAnnual: number;
  features: string[];
  cfdiMonthly: number;
  cfdiOverageCents: number;
}

// Compat: el wizard (signup-form) aún tipa `card`/`payMethod` en su estado. Se
// conservan los tipos aunque el paso 3 ya NO captura pago — el cobro se hace en
// el panel de activación (/dashboard/suspended) vía Stripe Checkout (hosted).
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

// Descripción corta por plan (display). Features y precios viven en plans.ts.
const PLAN_DESC: Record<PlanId, string> = {
  BASIC:  "Para empezar tu consultorio.",
  PRO:    "Para una práctica en crecimiento.",
  CLINIC: "Para clínicas con varios consultorios.",
};

export function Step3PlanPayment({ values, onChange, onBack, onSubmit, loading }: Step3Props) {
  const canSubmit = values.acceptedTerms && !loading;

  // Planes (precio/nombre/features) desde el endpoint público — sin hardcodear.
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/plans")
      .then((r) => r.json())
      .then((data: { plans: ApiPlan[] }) => { if (!cancelled) setPlans(data.plans); })
      .catch(() => { if (!cancelled) setPlans([]); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Selector de plan — los 3 planes, sin encimar: colapsan por ANCHO real
          (auto-fit) y nunca por viewport, así caben 1/2/3 columnas según haya. */}
      <div
        role="radiogroup"
        aria-label="Elige tu plan"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 14,
          alignItems: "stretch",
          paddingTop: 10,
        }}
      >
        {plans === null &&
          [0, 1, 2].map((i) => (
            <div
              key={i}
              aria-hidden="true"
              style={{ height: 300, borderRadius: 20, background: "#f1f5f9", border: "1px solid #e2e8f0" }}
            />
          ))}
        {(plans ?? []).map((p) => (
          <PlanCard
            key={p.id}
            plan={p.id}
            name={p.name}
            description={PLAN_DESC[p.id] ?? ""}
            priceMonthly={p.priceMxn}
            priceAnnual={p.priceMxnAnnual}
            billing="monthly"
            features={p.features.length < 2 ? [...p.features, cfdiBullet(p)] : [...p.features.slice(0, 2), cfdiBullet(p), ...p.features.slice(2)]}
            popular={p.id === "PRO"}
            mostComplete={p.id === "CLINIC"}
            selected={values.plan === p.id}
            onSelect={() => onChange({ plan: p.id })}
          />
        ))}
      </div>

      <p className="dca-note" style={{ margin: 0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="10.5" width="16" height="10.5" rx="2.5" />
          <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" />
        </svg>
        <span>
          Aquí no se cobra nada. El pago lo haces en el siguiente paso, dentro del panel, con tarjeta, SPEI u OXXO
          en la página segura de Stripe.
        </span>
      </p>

      {/* Términos */}
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={values.acceptedTerms}
          onChange={(e) => onChange({ acceptedTerms: e.target.checked })}
          style={{ marginTop: 1, flexShrink: 0 }}
        />
        <span style={{ fontSize: 13.5, color: "#334155", lineHeight: 1.5 }}>
          Acepto los{" "}
          <Link href="/legal/terminos" className="dca-link">
            términos
          </Link>{" "}
          y la{" "}
          <Link href="/legal/privacy" className="dca-link">
            política de privacidad
          </Link>
          .
        </span>
      </label>

      {/* Acciones */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button type="button" onClick={onBack} disabled={loading} className="dca-btn-ghost" style={botonFantasma(loading)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
          Atrás
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="dca-btn-primary"
          style={botonPrimario(!canSubmit, { flex: 1, fontSize: 15.5 })}
        >
          {loading && (
            <svg className="dca-spin" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-6.2-8.56" />
            </svg>
          )}
          {loading ? "Creando cuenta…" : "Crear cuenta"}
          {!loading && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
