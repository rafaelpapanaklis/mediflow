"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import toast from "react-hot-toast";
import { CreditCard, Loader2, Lock, Check } from "lucide-react";
import type { PlanId } from "@/lib/billing/plans";
import { FIRST_MONTH_PROMO_MXN, cfdiBullet } from "@/lib/plan-shared";
import { useT } from "@/i18n/i18n-provider";

export interface PlanCardData {
  id: PlanId;
  name: string;
  priceMxn: number;
  /** Total anual (35% de descuento) — viene de plan_configs vía getResolvedPlans. */
  priceMxnAnnual: number;
  features: string[];
  /** Facturas CFDI incluidas por mes (para el bullet de cupo). */
  cfdiMonthly: number;
  /** Precio del timbre CFDI excedente, en centavos MXN. */
  cfdiOverageCents: number;
}

type PayMethod = "card" | "spei" | "oxxo";
type Billing = "monthly" | "annual";

interface Props {
  plans: PlanCardData[];
  currentPlan?: PlanId | null;
  /** True si es la PRIMERA contratación de la clínica → promo 1er mes ($19/$29/$39, solo mensual con tarjeta). */
  firstMonthEligible?: boolean;
}

// Upsell: qué plan sugerir según el actual. CLINIC es el tope (sin sugerencia).
const NEXT_PLAN: Record<PlanId, PlanId | null> = {
  BASIC: "PRO",
  PRO: "CLINIC",
  CLINIC: null,
};

function fmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-MX");
}

export function SuspendedPlanCards({ plans, currentPlan = null, firstMonthEligible = false }: Props) {
  const t = useT();
  const [pendingPlan, setPendingPlan] = useState<PlanId | null>(null);
  const [method, setMethod] = useState<PayMethod>("card");
  const [billing, setBilling] = useState<Billing>("monthly");
  // Plan elegido por el usuario: las tarjetas son un radiogroup. Preselección =
  // su plan actual o, si no tiene, PRO (el popular). El pago se hace sobre este.
  const [selectedPlan, setSelectedPlan] = useState<PlanId>(currentPlan ?? "PRO");
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const methodRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Al ir a Stripe usamos window.location.href; si el usuario regresa con el
  // botón "atrás", el navegador restaura ESTA página desde el bfcache con
  // pendingPlan congelado → el CTA se quedaría en "Redirigiendo…" para siempre,
  // bloqueando reintentar o cambiar de método/plan. Reseteamos pendingPlan al
  // restaurar la página (pageshow desde bfcache) y al volver a primer plano.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setPendingPlan(null);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") setPendingPlan(null);
    };
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Plan recomendado (upsell). Sin plan actual válido, sugiere PRO (popular).
  const recommendedPlan: PlanId | null = currentPlan ? NEXT_PLAN[currentPlan] : "PRO";

  function priceOf(id: PlanId | null): number | null {
    if (!id) return null;
    const p = plans.find((x) => x.id === id);
    return p ? p.priceMxn : null;
  }

  // Precio/mes mostrado: anual = priceMxnAnnual/12 (35% de descuento, viene
  // de plan_configs — misma fuente que el checkout); mensual = priceMxn tal cual.
  function perMonth(plan: PlanCardData): number {
    return billing === "annual" ? Math.round(plan.priceMxnAnnual / 12) : plan.priceMxn;
  }
  function annualSavings(plan: PlanCardData): number {
    return Math.max(0, plan.priceMxn * 12 - plan.priceMxnAnnual);
  }

  const methods: Array<{ id: PayMethod; label: string }> = [
    { id: "card", label: t("pages.suspended.methodCard") },
    { id: "spei", label: t("pages.suspended.methodSpei") },
    { id: "oxxo", label: t("pages.suspended.methodOxxo") },
  ];
  const methodIndex: Record<PayMethod, number> = { card: 0, spei: 1, oxxo: 2 };
  const methodOrder: PayMethod[] = ["card", "spei", "oxxo"];

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
        body: JSON.stringify({ plan, method, billing }),
      });
      // Stripe no configurado → mensaje claro, sin dejar al usuario en limbo.
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

  // Navegación accesible del radiogroup de planes: flechas mueven selección y foco.
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

  // Mismo patrón de teclado en el selector de método (radiogroup).
  function selectMethodAt(index: number) {
    const m = methodOrder[(index + methodOrder.length) % methodOrder.length];
    setMethod(m);
    const el = methodRefs.current[methodOrder.indexOf(m)];
    if (el) el.focus();
  }
  function onMethodKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const k = e.key;
    if (k === "ArrowRight" || k === "ArrowDown") {
      e.preventDefault();
      selectMethodAt(index + 1);
    } else if (k === "ArrowLeft" || k === "ArrowUp") {
      e.preventDefault();
      selectMethodAt(index - 1);
    }
  }

  const selected = plans.find((p) => p.id === selectedPlan) ?? plans[0];
  const isRedirecting = pendingPlan !== null;
  const ctaPrice = selected ? perMonth(selected) : 0;
  // La promo de 1er mes SOLO aplica pagando con tarjeta en ciclo mensual
  // (misma regla que /api/billing/checkout) — el CTA la refleja tal cual.
  const ctaPromo = firstMonthEligible && billing === "monthly" && method === "card";

  return (
    <div>
      {/* === Toggle Mensual / Anual === */}
      <div className="mb-7 flex flex-wrap items-center justify-center gap-3">
        <div className="relative inline-flex rounded-full bg-[#ECEAF1] p-1.5 dark:bg-[#241F32]">
          <span
            aria-hidden
            className="absolute bottom-1.5 left-1.5 top-1.5 rounded-full bg-white shadow-sm transition-transform duration-300 dark:bg-[#3A3450]"
            style={{ width: "calc(50% - 6px)", transform: billing === "annual" ? "translateX(100%)" : "translateX(0)" }}
          />
          {(["monthly", "annual"] as Billing[]).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBilling(b)}
              aria-pressed={billing === b}
              className={`relative z-10 min-w-[112px] rounded-full px-4 py-2 text-[13.5px] font-bold transition-colors ${
                billing === b ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {b === "monthly" ? "Mensual" : "Anual"}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          {billing === "annual" || !firstMonthEligible ? "Anual: 35% de descuento" : "Tu primer mes desde $19"}
        </span>
      </div>

      {/* === Grid de planes (radiogroup) === */}
      <div
        role="radiogroup"
        aria-label={t("pages.suspended.choosePlanTitle")}
        className="mb-7 grid items-stretch gap-[18px] md:grid-cols-3"
      >
        {plans.map((plan, i) => {
          const isRecommended = plan.id === recommendedPlan;
          const isCurrent = plan.id === currentPlan;
          const isTop = plan.id === "CLINIC" && currentPlan === "CLINIC";
          const isSelected = plan.id === selectedPlan;

          const curPrice = priceOf(currentPlan);
          const showUpsellLine = isRecommended && curPrice != null;
          const upsellAmount = showUpsellLine ? plan.priceMxn - (curPrice as number) : 0;

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
              className={`relative flex cursor-pointer select-none flex-col rounded-[20px] border p-[22px] outline-none transition-[transform,box-shadow] duration-200 hover:-translate-y-[3px] focus-visible:ring-2 focus-visible:ring-violet-500/60 ${
                isRecommended
                  ? "border-violet-200 bg-violet-50/60 dark:border-violet-500/30 dark:bg-violet-500/[0.06]"
                  : "border-border bg-card"
              }`}
              style={
                isSelected
                  ? {
                      borderColor: "var(--brand)",
                      boxShadow:
                        "0 0 0 4px rgba(124,58,237,0.13), 0 20px 42px -22px rgba(124,58,237,0.5)",
                    }
                  : { boxShadow: "0 1px 2px rgba(16,24,40,0.04)" }
              }
            >
              <div className="flex flex-col gap-[13px]">
                {/* Badges + radio */}
                <div className="flex min-h-[24px] items-start justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {isRecommended && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-white"
                        style={{ background: "linear-gradient(135deg,#8B5CF6,#7C3AED)" }}
                      >
                        ★ {t("pages.suspended.recommendedBadge")}
                      </span>
                    )}
                    {isCurrent && (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                        {t("pages.suspended.currentPlanBadge")}
                      </span>
                    )}
                    {isTop && (
                      <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">
                        {t("pages.suspended.topPlanBadge")}
                      </span>
                    )}
                  </div>
                  <div
                    className={`relative h-[22px] w-[22px] flex-shrink-0 rounded-full border-2 ${
                      isSelected ? "border-violet-600 dark:border-violet-500" : "border-[#D6D3DE] dark:border-[#3A3450]"
                    }`}
                  >
                    {isSelected && (
                      <span className="absolute inset-[3px] rounded-full bg-violet-600 dark:bg-violet-500" />
                    )}
                  </div>
                </div>

                <div className="text-[17px] font-bold tracking-tight">{plan.name}</div>

                <div className="flex items-baseline gap-1">
                  <span className="text-[34px] font-extrabold leading-none tracking-tight text-violet-600 dark:text-violet-400">
                    {fmt(perMonth(plan))}
                  </span>
                  <span className="text-sm font-semibold text-muted-foreground">
                    {t("pages.suspended.perMonth")}
                  </span>
                </div>
                <div className="-mt-1 text-xs text-muted-foreground">
                  {billing === "annual"
                    ? `${fmt(plan.priceMxnAnnual)} al año · ahorras ${fmt(annualSavings(plan))} (35%)`
                    : firstMonthEligible
                      ? `Tu primer mes: solo ${fmt(FIRST_MONTH_PROMO_MXN[plan.id])} con tarjeta · luego ${fmt(plan.priceMxn)}/mes`
                      : "Facturación mensual · cancela cuando quieras"}
                </div>

                {showUpsellLine && (
                  <div className="rounded-[9px] bg-violet-500/10 px-2.5 py-2 text-xs font-semibold text-violet-700 dark:text-violet-300">
                    {t("pages.suspended.upsellLine", {
                      amount: upsellAmount.toLocaleString("es-MX"),
                      benefit: upsellBenefit(plan.id),
                    })}
                  </div>
                )}

                <div className="my-0.5 h-px bg-border" />

                <div className="flex flex-col gap-[9px]">
                  {(plan.features.length < 2 ? [...plan.features, cfdiBullet(plan)] : [...plan.features.slice(0, 2), cfdiBullet(plan), ...plan.features.slice(2)]).map((f) => (
                    <div key={f} className="flex items-center gap-2.5 text-[13.5px] text-muted-foreground">
                      <Check size={16} strokeWidth={2.4} className="flex-shrink-0 text-green-600 dark:text-emerald-400" aria-hidden />
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* === Barra de checkout: método + CTA + señales de confianza === */}
      <div
        className="mx-auto flex max-w-[560px] flex-col items-center gap-4 rounded-[18px] border border-border bg-card p-[22px]"
        style={{ boxShadow: "0 1px 2px rgba(16,24,40,0.04), 0 18px 40px -28px rgba(16,24,40,0.3)" }}
      >
        {/* Selector de método (pill deslizante) */}
        <div
          role="radiogroup"
          aria-label={t("pages.suspended.methodCard")}
          className="relative flex w-full rounded-[13px] bg-[#F1F0F4] p-1.5 dark:bg-[#241F32]"
        >
          <span
            aria-hidden
            className="absolute bottom-1.5 left-1.5 top-1.5 rounded-[9px] bg-white shadow-sm transition-transform duration-300 dark:bg-[#3A3450]"
            style={{ width: "calc((100% - 12px) / 3)", transform: `translateX(${methodIndex[method] * 100}%)` }}
          />
          {methods.map((m, i) => {
            const active = method === m.id;
            return (
              <button
                key={m.id}
                ref={(el) => {
                  methodRefs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setMethod(m.id)}
                onKeyDown={(e) => onMethodKeyDown(e, i)}
                className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-[9px] px-1 py-2.5 text-[13px] font-bold transition-colors ${
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m.id === "card" && <CreditCard size={16} aria-hidden />}
                {m.label}
              </button>
            );
          })}
        </div>

        {method !== "card" && (
          <p className="-mt-1 text-center text-xs" style={{ color: "rgb(180,83,9)" }}>
            {t("pages.suspended.asyncMethodNote")}
          </p>
        )}

        {/* CTA único: paga el plan seleccionado con el método y ciclo elegidos */}
        <button
          type="button"
          onClick={() => handleStripeCheckout(selectedPlan)}
          disabled={isRedirecting}
          className="flex w-full items-center justify-center gap-2.5 rounded-[13px] px-4 py-[15px] text-[15px] font-bold text-white transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-70"
          style={{
            background: "linear-gradient(135deg,#7C3AED,#6D28D9)",
            boxShadow: "0 14px 30px -10px rgba(124,58,237,0.6)",
          }}
        >
          {isRedirecting ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Lock size={17} aria-hidden />}
          {isRedirecting
            ? t("pages.suspended.redirecting")
            : selected
              ? ctaPromo
                ? `Pagar ${selected.name} — ${fmt(FIRST_MONTH_PROMO_MXN[selected.id])} el primer mes`
                : `Pagar ${selected.name} — ${fmt(ctaPrice)}/mes`
              : ""}
        </button>

        {/* Señales de confianza */}
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-semibold text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Lock size={13} aria-hidden /> Pago seguro vía Stripe
          </span>
          <span className="text-border">·</span>
          <span>Cancela cuando quieras</span>
          <span className="text-border">·</span>
          <span>Sin contratos</span>
        </div>
      </div>
    </div>
  );
}
