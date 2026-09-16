"use client";

import type { KeyboardEvent, MutableRefObject } from "react";
import { Check, CreditCard, Loader2, Lock } from "lucide-react";
import type { PlanId } from "@/lib/billing/plans";
import { FIRST_MONTH_PROMO_MXN, cfdiBullet } from "@/lib/plan-shared";
import type { PlanCardData } from "@/app/dashboard/suspended/suspended-client";
import s from "./cuenta.module.css";

type PayMethod = "card" | "spei" | "oxxo";
type Billing = "monthly" | "annual";

/**
 * Todo lo que `SuspendedPlanCards` (suspended-client.tsx) ya calcula y decide:
 * estado, teclado del radiogroup, checkout. Esta vista NO tiene lógica propia:
 * recibe la de siempre y solo la pinta con el lenguaje del menú. Así el pago
 * sigue pasando por el mismo código con la bandera encendida o apagada.
 */
export interface VistaPlanes {
  t: (key: string, vars?: Record<string, string | number>) => string;
  fmt: (n: number) => string;
  plans: PlanCardData[];
  currentPlan: PlanId | null;
  firstMonthEligible: boolean;
  recommendedPlan: PlanId | null;
  selectedPlan: PlanId;
  selected: PlanCardData | undefined;
  billing: Billing;
  method: PayMethod;
  methods: Array<{ id: PayMethod; label: string }>;
  methodIndex: Record<PayMethod, number>;
  isRedirecting: boolean;
  ctaPrice: number;
  ctaPromo: boolean;
  cardRefs: MutableRefObject<Array<HTMLDivElement | null>>;
  methodRefs: MutableRefObject<Array<HTMLButtonElement | null>>;
  priceOf: (id: PlanId | null) => number | null;
  perMonth: (plan: PlanCardData) => number;
  annualSavings: (plan: PlanCardData) => number;
  upsellBenefit: (planId: PlanId) => string;
  setSelectedPlan: (id: PlanId) => void;
  setBilling: (b: Billing) => void;
  setMethod: (m: PayMethod) => void;
  onCardKeyDown: (e: KeyboardEvent<HTMLDivElement>, index: number) => void;
  onMethodKeyDown: (e: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  handleStripeCheckout: (plan: PlanId) => void;
}

// El mismo orden de viñetas que la tarjeta de siempre: el cupo de CFDI va en
// tercer lugar (o al final si el plan tiene menos de dos viñetas).
function vinetas(plan: PlanCardData): string[] {
  return plan.features.length < 2
    ? [...plan.features, cfdiBullet(plan)]
    : [...plan.features.slice(0, 2), cfdiBullet(plan), ...plan.features.slice(2)];
}

export function PlanesSuspendida({ v }: { v: VistaPlanes }) {
  const { t, fmt } = v;

  return (
    <div>
      {/* === Ciclo: mensual / anual === */}
      <div className={s.cicloFila}>
        <div className={s.conmutador}>
          <span
            aria-hidden
            className={s.conmutadorDeslizante}
            style={{ transform: v.billing === "annual" ? "translateX(100%)" : "translateX(0)" }}
          />
          {(["monthly", "annual"] as Billing[]).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => v.setBilling(b)}
              aria-pressed={v.billing === b}
              className={`${s.conmutadorOpcion} ${v.billing === b ? s.conmutadorOpcionActiva : ""}`}
            >
              {b === "monthly" ? "Mensual" : "Anual"}
            </button>
          ))}
        </div>
        <span className={`${s.etiqueta} ${s.etiquetaExito}`}>
          {v.billing === "annual" || !v.firstMonthEligible ? "Anual: 35% de descuento" : "Tu primer mes desde $19"}
        </span>
      </div>

      {/* === Las tres tarjetas de plan (radiogroup) === */}
      <div role="radiogroup" aria-label={t("pages.suspended.choosePlanTitle")} className={s.planes}>
        {v.plans.map((plan, i) => {
          const isRecommended = plan.id === v.recommendedPlan;
          const isCurrent = plan.id === v.currentPlan;
          const isTop = plan.id === "CLINIC" && v.currentPlan === "CLINIC";
          const isSelected = plan.id === v.selectedPlan;

          const curPrice = v.priceOf(v.currentPlan);
          const showUpsellLine = isRecommended && curPrice != null;
          const upsellAmount = showUpsellLine ? plan.priceMxn - (curPrice as number) : 0;

          return (
            <div
              key={plan.id}
              ref={(el) => {
                v.cardRefs.current[i] = el;
              }}
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => v.setSelectedPlan(plan.id)}
              onKeyDown={(e) => v.onCardKeyDown(e, i)}
              className={[
                s.plan,
                isRecommended ? s.planRecomendado : "",
                isSelected ? s.planSeleccionado : "",
              ].filter(Boolean).join(" ")}
            >
              <div className={s.planCabeza}>
                <div className={s.planEtiquetas}>
                  {isRecommended && (
                    <span className={`${s.etiqueta} ${s.etiquetaActivo}`}>
                      ★ {t("pages.suspended.recommendedBadge")}
                    </span>
                  )}
                  {isCurrent && (
                    <span className={`${s.etiqueta} ${s.etiquetaExito}`}>
                      {t("pages.suspended.currentPlanBadge")}
                    </span>
                  )}
                  {isTop && (
                    <span className={`${s.etiqueta} ${s.etiquetaNeutra}`}>
                      {t("pages.suspended.topPlanBadge")}
                    </span>
                  )}
                </div>
                <span className={`${s.radio} ${isSelected ? s.radioActivo : ""}`} aria-hidden>
                  {isSelected && <span className={s.radioPunto} />}
                </span>
              </div>

              <div className={s.planNombre}>{plan.name}</div>

              <div className={s.precio}>
                <span className={s.precioCifra}>{fmt(v.perMonth(plan))}</span>
                <span className={s.precioUnidad}>{t("pages.suspended.perMonth")}</span>
              </div>
              <div className={s.precioNota}>
                {v.billing === "annual"
                  ? `${fmt(plan.priceMxnAnnual)} al año · ahorras ${fmt(v.annualSavings(plan))} (35%)`
                  : v.firstMonthEligible
                    ? `Tu primer mes: solo ${fmt(FIRST_MONTH_PROMO_MXN[plan.id])} con tarjeta · luego ${fmt(plan.priceMxn)}/mes`
                    : "Facturación mensual · cancela cuando quieras"}
              </div>

              {showUpsellLine && (
                <div className={s.mejora}>
                  {t("pages.suspended.upsellLine", {
                    amount: upsellAmount.toLocaleString("es-MX"),
                    benefit: v.upsellBenefit(plan.id),
                  })}
                </div>
              )}

              <div className={s.separador} />

              <div className={s.beneficios}>
                {vinetas(plan).map((f) => (
                  <div key={f} className={s.beneficio}>
                    <Check size={15} strokeWidth={2.4} className={s.beneficioIcono} aria-hidden />
                    {f}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* === Pago: método + CTA + señales de confianza === */}
      <div className={s.pago}>
        <div role="radiogroup" aria-label={t("pages.suspended.methodCard")} className={s.metodos}>
          <span
            aria-hidden
            className={s.metodosDeslizante}
            style={{ transform: `translateX(${v.methodIndex[v.method] * 100}%)` }}
          />
          {v.methods.map((m, i) => {
            const active = v.method === m.id;
            return (
              <button
                key={m.id}
                ref={(el) => {
                  v.methodRefs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => v.setMethod(m.id)}
                onKeyDown={(e) => v.onMethodKeyDown(e, i)}
                className={`${s.metodo} ${active ? s.metodoActivo : ""}`}
              >
                {m.id === "card" && <CreditCard size={15} aria-hidden />}
                {m.label}
              </button>
            );
          })}
        </div>

        {v.method !== "card" && <p className={s.notaMetodo}>{t("pages.suspended.asyncMethodNote")}</p>}

        <button
          type="button"
          onClick={() => v.handleStripeCheckout(v.selectedPlan)}
          disabled={v.isRedirecting}
          className={s.cta}
        >
          {v.isRedirecting ? <Loader2 size={17} className={s.girando} aria-hidden /> : <Lock size={16} aria-hidden />}
          {v.isRedirecting
            ? t("pages.suspended.redirecting")
            : v.selected
              ? v.ctaPromo
                ? `Pagar ${v.selected.name} — ${fmt(FIRST_MONTH_PROMO_MXN[v.selected.id])} el primer mes`
                : `Pagar ${v.selected.name} — ${fmt(v.ctaPrice)}/mes`
              : ""}
        </button>

        <div className={s.confianza}>
          <span className={s.confianzaItem}>
            <Lock size={12} aria-hidden /> Pago seguro vía Stripe
          </span>
          <span className={s.confianzaPunto}>·</span>
          <span>Cancela cuando quieras</span>
          <span className={s.confianzaPunto}>·</span>
          <span>Sin contratos</span>
        </div>
      </div>
    </div>
  );
}
