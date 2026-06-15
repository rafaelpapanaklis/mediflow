"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import toast from "react-hot-toast";
import { CreditCard, Loader2 } from "lucide-react";
import type { PlanId } from "@/lib/billing/plans";
import { useT } from "@/i18n/i18n-provider";

export interface PlanCardData {
  id: PlanId;
  name: string;
  priceMxn: number;
  features: string[];
}

type PayMethod = "card" | "spei" | "oxxo";

interface Props {
  plans: PlanCardData[];
  currentPlan?: PlanId | null;
}

// Upsell: qué plan sugerir según el actual. CLINIC es el tope (sin sugerencia).
const NEXT_PLAN: Record<PlanId, PlanId | null> = {
  BASIC: "PRO",
  PRO: "CLINIC",
  CLINIC: null,
};

export function SuspendedPlanCards({ plans, currentPlan = null }: Props) {
  const t = useT();
  const [pendingPlan, setPendingPlan] = useState<PlanId | null>(null);
  const [method, setMethod] = useState<PayMethod>("card");
  // Plan elegido por el usuario: las tarjetas son un radiogroup. Preselección =
  // su plan actual o, si no tiene, PRO (el popular). El pago se hace sobre este.
  const [selectedPlan, setSelectedPlan] = useState<PlanId>(currentPlan ?? "PRO");
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);

  // Plan recomendado (upsell). Sin plan actual válido, sugiere PRO (popular).
  const recommendedPlan: PlanId | null = currentPlan ? NEXT_PLAN[currentPlan] : "PRO";

  function priceOf(id: PlanId | null): number | null {
    if (!id) return null;
    const p = plans.find((x) => x.id === id);
    return p ? p.priceMxn : null;
  }

  const methods: Array<{ id: PayMethod; label: string }> = [
    { id: "card", label: t("pages.suspended.methodCard") },
    { id: "spei", label: t("pages.suspended.methodSpei") },
    { id: "oxxo", label: t("pages.suspended.methodOxxo") },
  ];

  // Conector del método para el CTA único ("con tarjeta" / "con SPEI" / "con OXXO").
  const methodConnector =
    method === "spei" ? t("pages.suspended.payConnectorSpei") :
    method === "oxxo" ? t("pages.suspended.payConnectorOxxo") :
    t("pages.suspended.payConnectorCard");

  function upsellBenefit(planId: PlanId): string {
    if (planId === "CLINIC") return t("pages.suspended.upsellBenefitClinic");
    return t("pages.suspended.upsellBenefitPro");
  }

  async function handleStripeCheckout(plan: PlanId) {
    if (pendingPlan) return;
    setPendingPlan(plan);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, method }),
      });
      // Stripe no configurado → mensaje claro y apuntar al SPEI manual de abajo,
      // sin dejar al usuario en limbo.
      if (res.status === 503) {
        toast.error(t("pages.suspended.paymentsUnavailable"));
        setPendingPlan(null);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? t("pages.suspended.checkoutError"));
      }
      window.location.href = data.url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("pages.suspended.checkoutError"));
      setPendingPlan(null);
    }
  }

  // Navegación accesible del radiogroup: las flechas mueven selección y foco.
  function selectAt(index: number) {
    const p = plans[index];
    if (!p) return;
    setSelectedPlan(p.id);
    const el = cardRefs.current[index];
    if (el) el.focus();
  }

  function onCardKeyDown(e: KeyboardEvent<HTMLDivElement>, index: number) {
    const k = e.key;
    if (k === "Enter" || k === " " || k === "Spacebar") {
      e.preventDefault();
      const p = plans[index];
      if (p) setSelectedPlan(p.id);
    } else if (k === "ArrowRight" || k === "ArrowDown") {
      e.preventDefault();
      selectAt((index + 1) % plans.length);
    } else if (k === "ArrowLeft" || k === "ArrowUp") {
      e.preventDefault();
      selectAt((index - 1 + plans.length) % plans.length);
    }
  }

  const selected = plans.find((p) => p.id === selectedPlan) ?? plans[0];
  const isRedirecting = pendingPlan !== null;
  const ctaLabel = selected
    ? t("pages.suspended.payPlanCta", {
        plan: selected.name,
        connector: methodConnector,
        price: String(selected.priceMxn),
      })
    : "";

  return (
    <div className="mb-8">
      {/* Selector de método de pago (compartido por las 3 tarjetas) */}
      <div className="mb-3 flex justify-center">
        <div className="inline-flex flex-wrap justify-center rounded-xl border border-border bg-card p-1">
          {methods.map((m) => {
            const active = method === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMethod(m.id)}
                aria-pressed={active}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  active ? "text-white" : "text-muted-foreground hover:text-foreground"
                }`}
                style={active ? { background: "var(--brand)" } : undefined}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>
      {method !== "card" && (
        <p className="mb-5 text-center text-xs" style={{ color: "rgb(180,83,9)" }}>
          {t("pages.suspended.asyncMethodNote")}
        </p>
      )}

      <div
        className="grid gap-4 sm:grid-cols-3"
        role="radiogroup"
        aria-label={t("pages.suspended.choosePlanTitle")}
      >
        {plans.map((plan, i) => {
          const isRecommended = plan.id === recommendedPlan;
          const isCurrent = plan.id === currentPlan;
          const isTop = plan.id === "CLINIC" && currentPlan === "CLINIC";
          const isSelected = plan.id === selectedPlan;

          const curPrice = priceOf(currentPlan);
          const showUpsellLine = isRecommended && curPrice != null;
          const upsellAmount = showUpsellLine ? plan.priceMxn - (curPrice as number) : 0;

          // Base: recomendado = brand; actual = emerald; resto = default.
          const baseClass = isRecommended
            ? "border-2 shadow-md"
            : isCurrent
              ? "border-2"
              : "border-border bg-card";
          const baseStyle = isRecommended
            ? { borderColor: "var(--brand)", background: "var(--brand-softer, hsl(var(--card)))" }
            : isCurrent
              ? { borderColor: "rgba(16,185,129,0.6)" }
              : {};
          // La SELECCIÓN manda encima: borde brand marcado + anillo, claramente
          // distinto de los badges (★ recomendado / tu plan actual / tope).
          const selectedStyle = isSelected
            ? {
                borderColor: "var(--brand)",
                boxShadow:
                  "0 0 0 3px var(--brand-soft, rgba(124,58,237,0.35)), 0 10px 24px -12px rgba(0,0,0,0.25)",
              }
            : {};
          const cardStyle = { ...baseStyle, ...selectedStyle };

          return (
            <div
              key={plan.id}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setSelectedPlan(plan.id)}
              onKeyDown={(e) => onCardKeyDown(e, i)}
              className={`relative flex cursor-pointer select-none flex-col rounded-2xl border p-5 transition ${
                isSelected ? "border-2" : ""
              } ${baseClass}`}
              style={cardStyle}
            >
              {/* Check de selección (esquina), sin tapar los badges de la izquierda */}
              {isSelected && (
                <span
                  aria-hidden
                  className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: "var(--brand)" }}
                >
                  ✓
                </span>
              )}

              {/* Badges: recomendado / tu plan actual / tope */}
              {(isRecommended || isCurrent || isTop) && (
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 pr-7">
                  {isRecommended && (
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--brand)" }}>
                      ★ {t("pages.suspended.recommendedBadge")}
                    </span>
                  )}
                  {isCurrent && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">
                      {t("pages.suspended.currentPlanBadge")}
                    </span>
                  )}
                  {isTop && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {t("pages.suspended.topPlanBadge")}
                    </span>
                  )}
                </div>
              )}

              <div className="mb-1 text-base font-bold">{plan.name}</div>
              <div className="text-2xl font-extrabold" style={{ color: "var(--brand)" }}>
                ${plan.priceMxn}{t("pages.suspended.perMonth")}
              </div>

              {showUpsellLine && (
                <div className="mb-3 mt-1 text-xs font-semibold" style={{ color: "var(--brand)" }}>
                  {t("pages.suspended.upsellLine", {
                    amount: upsellAmount.toLocaleString("es-MX"),
                    benefit: upsellBenefit(plan.id),
                  })}
                </div>
              )}

              <ul className={`${showUpsellLine ? "" : "mt-4"} space-y-1.5`}>
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="text-emerald-500">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* CTA único: paga el plan seleccionado con el método elegido */}
      <div className="mt-6 flex justify-center">
        <button
          type="button"
          onClick={() => handleStripeCheckout(selectedPlan)}
          disabled={isRedirecting}
          className="inline-flex w-full max-w-md items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-base font-bold text-white shadow-lg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            background: "var(--brand)",
            boxShadow: "0 10px 30px -8px var(--brand-soft, rgba(124,58,237,0.4))",
          }}
        >
          {isRedirecting ? (
            <Loader2 size={16} className="animate-spin" aria-hidden />
          ) : (
            <CreditCard size={16} aria-hidden />
          )}
          {isRedirecting ? t("pages.suspended.redirecting") : ctaLabel}
        </button>
      </div>
    </div>
  );
}
