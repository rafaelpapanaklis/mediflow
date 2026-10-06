"use client";

import { useEffect, useState } from "react";
import { cuentasDelEnlace, lineasDelEnlace } from "@/lib/billing/contratar";
import Link from "next/link";
import { PlanCard, type Billing, type PlanId } from "./plan-card";
import { FIRST_MONTH_PROMO_MXN, cfdiBullet } from "@/lib/plan-shared";
import { lineaPrimerMesConTarjeta } from "@/lib/billing/aviso-promo-tarjeta";
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
  /**
   * El plan ya venía elegido en la portada (?plan=). Entonces el paso arranca
   * con un RESUMEN del plan (nombre, precio + IVA, mensual/anual) y un
   * «Cambiar plan» que despliega las tres tarjetas. Sin él, se elige como
   * siempre. Solo cambia qué se enseña: el plan y el periodo que se mandan
   * siguen siendo `values.plan` / `values.billing`.
   */
  planFijo?: boolean;
  /**
   * Enlace de contratación (/contratar/<plan>): SOLO ese plan, con tarjeta, anual (de entrada) o
   * mensual, a precio completo + IVA. Sin «Cambiar plan» ni otras tarjetas; el servidor lo vuelve
   * a imponer al cobrar.
   */
  soloEstePlan?: boolean;
}

// Descripción corta por plan (display). Features y precios viven en plans.ts.
const PLAN_DESC: Record<PlanId, string> = {
  BASIC:  "Para empezar tu consultorio.",
  PRO:    "Para una práctica en crecimiento.",
  CLINIC: "Para clínicas con varios consultorios.",
};

// Misma forma que `fmt` de suspended-client: separador de miles de es-MX.
const fmt = (n: number) => Math.round(n).toLocaleString("es-MX");

// Viñetas en el mismo orden que siempre (el cupo CFDI en tercer lugar), y
// solo las tres primeras: el paso tiene que caber en una pantalla.
function vinetas(p: ApiPlan): string[] {
  const todas = p.features.length < 2 ? [...p.features, cfdiBullet(p)] : [...p.features.slice(0, 2), cfdiBullet(p), ...p.features.slice(2)];
  return todas.slice(0, 3);
}

export function Step3PlanPayment({ values, onChange, onBack, onSubmit, loading, planFijo = false, soloEstePlan = false }: Step3Props) {
  const canSubmit = values.acceptedTerms && !loading;
  const [mostrarPlanes, setMostrarPlanes] = useState(!planFijo && !soloEstePlan);

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

  const elegido = plans?.find((p) => p.id === values.plan) ?? null;
  const anual = values.billing === "annual";
  // Enlace: las cuentas del periodo elegido (precios de plan_configs vía /api/plans) y el % del anual.
  const cuentas = soloEstePlan && elegido ? cuentasDelEnlace(elegido, anual ? "annual" : "monthly") : null;
  const lineas = cuentas && elegido ? lineasDelEnlace(cuentas, elegido) : null;
  const pctAnual = soloEstePlan && elegido ? cuentasDelEnlace(elegido, "annual").pctAhorro : null;

  // Promo del primer mes (solo tarjeta): el alta es siempre una primera contratación, salvo el enlace /contratar.
  const lineaPromo = (p: ApiPlan) =>
    soloEstePlan ? null : lineaPrimerMesConTarjeta({ promoMxn: FIRST_MONTH_PROMO_MXN[p.id], precioMensualMxn: p.priceMxn });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {!mostrarPlanes ? (
        /* Resumen del plan elegido en la portada. Precio: el mensual tal cual
           (priceMxn) o el total anual (priceMxnAnnual), los dos + IVA como en
           Precios. */
        elegido ? (
          <div className="dca-resumen" role="status">
            <span className="dca-resumen__ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <span className="dca-resumen__body">
              <span className="dca-resumen__k">Tu plan elegido</span>
              <span className="dca-resumen__name">{elegido.name}</span>
              <span className="dca-resumen__price">
                <strong>${fmt(anual ? elegido.priceMxnAnnual : elegido.priceMxn)}</strong>
                <span>MXN {anual ? "al año" : "al mes"} · + IVA</span>
                <span className="dca-resumen__pill">{anual ? "Pago anual" : "Pago mensual"}</span>
              </span>
              {!anual && !soloEstePlan && (
                <span className="dca-resumen__promo" data-promo-primer-mes>
                  {lineaPromo(elegido)}
                </span>
              )}
            </span>
            {!soloEstePlan && (
              <button type="button" className="dca-resumen__cambiar" onClick={() => setMostrarPlanes(true)}>
                Cambiar plan
              </button>
            )}
          </div>
        ) : (
          <div aria-hidden="true" style={{ height: 88, borderRadius: 16, background: "#f1f5f9", border: "1px solid #e2e8f0" }} />
        )
      ) : (
        /* Selector de plan — los 3 planes, sin encimar: colapsan por ANCHO real
           (auto-fit) y nunca por viewport, así caben 1/2/3 columnas según haya. */
        <div
          role="radiogroup"
          aria-label="Elige tu plan"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            alignItems: "stretch",
            paddingTop: 10,
          }}
        >
          {plans === null &&
            [0, 1, 2].map((i) => (
              <div
                key={i}
                aria-hidden="true"
                style={{ height: 220, borderRadius: 18, background: "#f1f5f9", border: "1px solid #e2e8f0" }}
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
              features={vinetas(p)}
              popular={p.id === "PRO"}
              mostComplete={p.id === "CLINIC"}
              promoLinea={lineaPromo(p)}
              selected={values.plan === p.id}
              onSelect={() => onChange({ plan: p.id })}
            />
          ))}
        </div>
      )}

      {/* Enlace de contratación: anual (de entrada) o mensual, y lo que se paga con el IVA aparte. */}
      {soloEstePlan && elegido && (
        <>
          <div className="dca-periodo" role="radiogroup" aria-label="Periodo de pago">
            {(["annual", "monthly"] as const).map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={values.billing === b}
                className={`dca-periodo__op${values.billing === b ? " dca-periodo__op--on" : ""}`}
                onClick={() => onChange({ billing: b })}
              >
                {b === "annual" ? (
                  <>
                    Anual <span className="dca-periodo__ahorro">ahorra {pctAnual}%</span>
                  </>
                ) : (
                  "Mensual"
                )}
              </button>
            ))}
          </div>
          {lineas && (
            <div className="dca-desglose" role="status" data-desglose-enlace>
              <strong>{lineas.titulo}</strong>
              {lineas.detalle.map((l) => (
                <span key={l}>{l}</span>
              ))}
            </div>
          )}
        </>
      )}

      <p className="dca-note" style={{ margin: 0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="10.5" width="16" height="10.5" rx="2.5" />
          <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" />
        </svg>
        <span>
          {soloEstePlan
            ? "Aquí no se cobra nada. En el siguiente paso, dentro del panel, pagas con tarjeta el periodo que elijas, a precio completo + IVA (sin promociones)."
            : "Aquí no se cobra nada. El pago lo haces en el siguiente paso, dentro del panel: tarjeta u OXXO con Stripe, o transferencia SPEI directa."}
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
            Términos
          </Link>{" "}
          y el{" "}
          <Link href="/legal/privacy" className="dca-link">
            Aviso de privacidad
          </Link>
          , y declaro ser mayor de edad y tener capacidad legal para contratar a nombre de la clínica.
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
