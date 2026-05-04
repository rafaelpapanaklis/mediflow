"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { CreditCard, Loader2 } from "lucide-react";
import type { PlanId } from "@/lib/billing/plans";

export interface PlanCardData {
  id: PlanId;
  name: string;
  priceMxn: number;
  features: string[];
  paypalUrl: string | null;
}

interface Props {
  plans: PlanCardData[];
}

const POPULAR_PLAN_ID: PlanId = "PRO";

export function SuspendedPlanCards({ plans }: Props) {
  const [pendingPlan, setPendingPlan] = useState<PlanId | null>(null);

  async function handleStripeCheckout(plan: PlanId) {
    if (pendingPlan) return;
    setPendingPlan(plan);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "No se pudo iniciar el checkout");
      }
      window.location.href = data.url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo iniciar el checkout");
      setPendingPlan(null);
    }
  }

  function handlePaypal(plan: PlanCardData) {
    if (!plan.paypalUrl) return;
    window.open(plan.paypalUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="mb-8 grid gap-4 sm:grid-cols-3">
      {plans.map((plan) => {
        const isPopular = plan.id === POPULAR_PLAN_ID;
        const isPending = pendingPlan === plan.id;
        return (
          <div
            key={plan.id}
            className={`flex flex-col rounded-2xl border p-5 ${
              isPopular ? "border-2 shadow-md" : "border-border bg-card"
            }`}
            style={
              isPopular
                ? {
                    borderColor: "var(--brand)",
                    background: "var(--brand-softer, hsl(var(--card)))",
                  }
                : undefined
            }
          >
            {isPopular && (
              <div
                className="mb-2 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: "var(--brand)" }}
              >
                ★ Más popular
              </div>
            )}
            <div className="mb-1 text-base font-bold">{plan.name}</div>
            <div
              className="mb-4 text-2xl font-extrabold"
              style={{ color: "var(--brand)" }}
            >
              ${plan.priceMxn}/mes
            </div>
            <ul className="mb-5 space-y-1.5">
              {plan.features.map((f) => (
                <li
                  key={f}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
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
                aria-label={`Pagar ${plan.name} con tarjeta`}
              >
                {isPending ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                ) : (
                  <CreditCard size={14} aria-hidden />
                )}
                {isPending ? "Redirigiendo…" : "Pagar con tarjeta"}
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
                    ? `Pagar ${plan.name} con PayPal`
                    : `PayPal próximamente para ${plan.name}`
                }
                title={plan.paypalUrl ? undefined : "PayPal — próximamente"}
              >
                {plan.paypalUrl ? "Pagar con PayPal" : "PayPal — próximamente"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
