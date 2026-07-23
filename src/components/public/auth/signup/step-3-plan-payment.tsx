"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PlanCard, type Billing, type PlanId } from "./plan-card";
import { cfdiBullet } from "@/lib/plan-shared";

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
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 12,
          alignItems: "stretch",
        }}
      >
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

      <p style={{ fontSize: 12, color: "var(--ld-fg-muted)", margin: 0, lineHeight: 1.5 }}>
        El pago lo haces dentro del panel: al activar tu plan podrás elegir tarjeta, SPEI u OXXO.
      </p>

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
            background: canSubmit ? "linear-gradient(180deg, #8b5cf6, #7c3aed)" : "#eef1f6",
            color: canSubmit ? "#fff" : "#94a3b8",
            boxShadow: canSubmit
              ? "0 8px 20px -6px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)"
              : "none",
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
          {loading ? "Creando cuenta…" : "Crear cuenta →"}
        </button>
      </div>
    </div>
  );
}
