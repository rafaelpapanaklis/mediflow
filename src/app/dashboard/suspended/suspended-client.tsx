"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { CreditCard, Loader2 } from "lucide-react";
import type { PlanId } from "@/lib/billing/plans";
import { useT } from "@/i18n/i18n-provider";

export interface PlanCardData {
  id: PlanId;
  name: string;
  priceMxn: number;
  features: string[];
  paypalUrl: string | null;
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

  const payLabel =
    method === "spei" ? t("pages.suspended.payWithSpei") :
    method === "oxxo" ? t("pages.suspended.payWithOxxo") :
    t("pages.suspended.payWithCard");

  function payAria(name: string): string {
    if (method === "spei") return t("pages.suspended.payWithSpeiAria", { name });
    if (method === "oxxo") return t("pages.suspended.payWithOxxoAria", { name });
    return t("pages.suspended.payWithCardAria", { name });
  }

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

  function handlePaypal(plan: PlanCardData) {
    if (!plan.paypalUrl) return;
    window.open(plan.paypalUrl, "_blank", "noopener,noreferrer");
  }

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

      <div className="grid gap-4 sm:grid-cols-3">
        {plans.map((plan) => {
          const isRecommended = plan.id === recommendedPlan;
          const isCurrent = plan.id === currentPlan;
          const isTop = plan.id === "CLINIC" && currentPlan === "CLINIC";
          const isPending = pendingPlan === plan.id;

          const curPrice = priceOf(currentPlan);
          const showUpsellLine = isRecommended && curPrice != null;
          const upsellAmount = showUpsellLine ? plan.priceMxn - (curPrice as number) : 0;

          // Borde/fondo: recomendado = brand; actual = emerald; resto = default.
          const cardClass = isRecommended
            ? "border-2 shadow-md"
            : isCurrent
              ? "border-2"
              : "border-border bg-card";
          const cardStyle = isRecommended
            ? { borderColor: "var(--brand)", background: "var(--brand-softer, hsl(var(--card)))" }
            : isCurrent
              ? { borderColor: "rgba(16,185,129,0.6)" }
              : undefined;

          return (
            <div key={plan.id} className={`flex flex-col rounded-2xl border p-5 ${cardClass}`} style={cardStyle}>
              {/* Badges: recomendado / tu plan actual / tope */}
              {(isRecommended || isCurrent || isTop) && (
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
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

              <ul className={`${showUpsellLine ? "" : "mt-4"} mb-5 space-y-1.5`}>
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="text-emerald-500">✓</span>
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-auto flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => handleStripeCheckout(plan.id)}
                  disabled={pendingPlan !== null}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-white shadow transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ background: "var(--brand)" }}
                  aria-label={payAria(plan.name)}
                >
                  {isPending ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    <CreditCard size={14} aria-hidden />
                  )}
                  {isPending ? t("pages.suspended.redirecting") : payLabel}
                </button>
                <button
                  type="button"
                  onClick={() => handlePaypal(plan)}
                  disabled={!plan.paypalUrl || pendingPlan !== null}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold shadow transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    background: plan.paypalUrl ? "#FFC439" : "hsl(var(--muted))",
                    color: plan.paypalUrl ? "#003087" : "hsl(var(--muted-foreground))",
                  }}
                  aria-label={
                    plan.paypalUrl
                      ? t("pages.suspended.payWithPaypalAria", { name: plan.name })
                      : t("pages.suspended.paypalComingSoonAria", { name: plan.name })
                  }
                  title={plan.paypalUrl ? undefined : t("pages.suspended.paypalComingSoon")}
                >
                  {plan.paypalUrl ? t("pages.suspended.payWithPaypal") : t("pages.suspended.paypalComingSoon")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
