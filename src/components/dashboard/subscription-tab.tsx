"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Check, CreditCard, Download, ExternalLink, Loader2, Receipt, Sparkles } from "lucide-react";
import { type PlanId, isPlanId } from "@/lib/billing/plans";
import { cfdiBullet } from "@/lib/plan-shared";
import { PaymentMethodModal } from "./payment-method-modal";
import { CfdiUsageCard } from "./cfdi-usage-card";
import { useT } from "@/i18n/i18n-provider";

interface ClinicData {
  id: string;
  plan: string;
  trialEndsAt?: string | Date | null;
  subscriptionStatus?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  paymentMethodCollected?: boolean;
  paymentMethodType?: string | null;
  paymentMethodLast4?: string | null;
  cancelRequested?: boolean;
  cancelRequestedAt?: string | Date | null;
}

interface Props {
  clinic: ClinicData;
}

interface BillingInvoiceRow {
  id: string;
  date: string;
  amount: number;
  currency: string;
  status: "paid" | "pending" | "overdue" | "failed" | "void";
  description: string;
  source: "stripe" | "local";
  downloadUrl: string | null;
  paymentUrl: string | null;
}

interface InvoicesResponse {
  invoices: BillingInvoiceRow[];
  stripeUnavailable: boolean;
}

interface ApiPlan {
  id: PlanId;
  name: string;
  priceMxn: number;
  priceMxnAnnual: number;
  features: string[];
  cfdiMonthly: number;
  cfdiOverageCents: number;
}

const TRIAL_DAYS_TOTAL = 14;

function formatFecha(d: Date) {
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(amount);
  } catch {
    return `$${amount.toFixed(2)} ${currency}`;
  }
}

function paypalLinkFor(plan: PlanId): string | null {
  const map: Record<PlanId, string | undefined> = {
    BASIC: process.env.NEXT_PUBLIC_PAYPAL_LINK_BASIC,
    PRO: process.env.NEXT_PUBLIC_PAYPAL_LINK_PRO,
    CLINIC: process.env.NEXT_PUBLIC_PAYPAL_LINK_CLINIC,
  };
  const url = map[plan];
  return url && url.length > 0 ? url : null;
}

export function SubscriptionTab({ clinic }: Props) {
  const t = useT();
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [localCancelRequested, setLocalCancelRequested] = useState(!!clinic.cancelRequested);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [changingPlan, setChangingPlan] = useState<PlanId | null>(null);
  const [confirmPlan, setConfirmPlan] = useState<PlanId | null>(null);
  const [invoices, setInvoices] = useState<BillingInvoiceRow[] | null>(null);
  const [stripeUnavailable, setStripeUnavailable] = useState(false);
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);

  const trialEndsAt = clinic.trialEndsAt ? new Date(clinic.trialEndsAt) : null;
  const now = new Date();

  const subscriptionActive =
    clinic.subscriptionStatus === "active" ||
    clinic.subscriptionStatus === "paid" ||
    clinic.subscriptionStatus === "trialing";
  const isInTrial = !!trialEndsAt && trialEndsAt > now && !subscriptionActive;
  const trialExpired = !!trialEndsAt && trialEndsAt < now && !subscriptionActive;

  const currentPlanId: PlanId = isPlanId(clinic.plan) ? clinic.plan : "PRO";
  const currentPlan = plans?.find((p) => p.id === currentPlanId) ?? null;

  const { daysLeft, pct } = useMemo(() => {
    if (!trialEndsAt) return { daysLeft: 0, pct: 0 };
    const msLeft = trialEndsAt.getTime() - now.getTime();
    const left = Math.max(0, Math.ceil(msLeft / 86_400_000));
    const used = Math.min(TRIAL_DAYS_TOTAL, TRIAL_DAYS_TOTAL - left);
    return { daysLeft: left, pct: Math.min(100, Math.round((used / TRIAL_DAYS_TOTAL) * 100)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trialEndsAt?.getTime()]);

  // Cargar facturas al montar.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/billing/invoices")
      .then((r) => r.json())
      .then((data: InvoicesResponse) => {
        if (cancelled) return;
        setInvoices(data.invoices);
        setStripeUnavailable(data.stripeUnavailable);
      })
      .catch(() => {
        if (cancelled) return;
        setInvoices([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Planes resueltos (precio/nombre/features) desde el endpoint público — sin
  // precios hardcodeados en el cliente.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/plans")
      .then((r) => r.json())
      .then((data: { plans: ApiPlan[] }) => {
        if (!cancelled) setPlans(data.plans);
      })
      .catch(() => {
        if (!cancelled) setPlans([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRequestCancel() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/clinic/subscription/cancel-request`, { method: "POST" });
      if (!res.ok) throw new Error();
      setLocalCancelRequested(true);
      setCancelOpen(false);
      toast.success(t("shell.subscriptionTab.cancelRequestedToast"));
    } catch {
      toast.error(t("shell.subscriptionTab.cancelRequestError"));
    } finally {
      setCancelling(false);
    }
  }

  async function applyPlanChange(targetPlan: PlanId) {
    if (changingPlan) return;
    setChangingPlan(targetPlan);
    setConfirmPlan(null);
    try {
      const res = await fetch("/api/billing/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: targetPlan }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        mode?: "in-place";
        plan?: PlanId;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? t("shell.subscriptionTab.errChangePlan"));
      }
      // Tanto con suscripción de Stripe como en trial el cambio es in-place:
      // toast de éxito + refresh para repintar "TU PLAN" y el upsell.
      toast.success(t("shell.subscriptionTab.planUpdatedToast", { plan: targetPlan }));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("shell.subscriptionTab.errChangePlanGeneric"));
    } finally {
      setChangingPlan(null);
    }
  }

  const statusLabel = subscriptionActive
    ? t("shell.subscriptionTab.statusActive")
    : isInTrial
      ? t("shell.subscriptionTab.statusTrial")
      : trialExpired
        ? t("shell.subscriptionTab.statusTrialExpired")
        : t("shell.subscriptionTab.statusNone");

  const statusTone = subscriptionActive
    ? { bg: "rgba(52,211,153,0.12)", border: "rgba(52,211,153,0.3)", fg: "#34d399" }
    : isInTrial
      ? { bg: "rgba(124,58,237,0.12)", border: "rgba(124,58,237,0.3)", fg: "#a78bfa" }
      : { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.3)", fg: "#f87171" };

  const hasStripeCustomer = !!clinic.stripeCustomerId;
  const hasStripeSubscription = !!clinic.stripeSubscriptionId;

  return (
    <div className="space-y-5 max-w-3xl">
      {/* ── Estado actual del plan ───────────────────────────────── */}
      <section
        className="bg-card border border-border rounded-2xl p-6"
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", fontWeight: 600, marginBottom: 6 }}>
              {t("shell.subscriptionTab.yourPlan")}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div
                style={{
                  padding: "4px 12px",
                  borderRadius: 100,
                  background: statusTone.bg,
                  border: `1px solid ${statusTone.border}`,
                  color: statusTone.fg,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {statusLabel}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>
                {t("shell.subscriptionTab.planLine", { name: currentPlan?.name ?? currentPlanId, price: currentPlan?.priceMxn ?? 0 })}
              </div>
            </div>
          </div>
        </div>

        {isInTrial && trialEndsAt && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
              <span style={{ color: "var(--text-2)" }}>
                {daysLeft === 0
                  ? t("shell.subscriptionTab.endsToday")
                  : daysLeft === 1
                    ? t("shell.subscriptionTab.oneDayLeft")
                    : t("shell.subscriptionTab.daysLeftOfTotal", { days: daysLeft, total: TRIAL_DAYS_TOTAL })}
              </span>
              <span className="font-mono" style={{ color: "var(--text-3)" }}>
                {t("shell.subscriptionTab.endsOn", { date: formatFecha(trialEndsAt) })}
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: daysLeft <= 3
                    ? "linear-gradient(90deg, #f59e0b, #ef4444)"
                    : "linear-gradient(90deg, #a78bfa, #7c3aed)",
                  transition: "width .4s",
                }}
              />
            </div>
          </div>
        )}

        {trialExpired && (
          <div style={{ padding: "12px 14px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, fontSize: 13, color: "#fca5a5" }}>
            {t("shell.subscriptionTab.trialExpiredNotice", { date: trialEndsAt ? formatFecha(trialEndsAt) : "" })}
          </div>
        )}

        {/* CTA activar/pagar — visible cuando NO hay suscripción activa (trial,
            prueba expirada o sin plan). Lleva a la pantalla de pago existente
            (/dashboard/suspended) con tarjeta/SPEI/OXXO, preseleccionando el
            plan actual de la clínica. Permite pagar ANTES de expirar. */}
        {!subscriptionActive && (
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              flexWrap: "wrap", gap: 12, padding: "14px 16px", borderRadius: 12,
              background: "linear-gradient(90deg, rgba(124,58,237,0.12), rgba(99,102,241,0.10))",
              border: "1px solid rgba(124,58,237,0.3)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-1)" }}>
                {t("shell.subscriptionTab.activateTitle")}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                {t("shell.subscriptionTab.activateSubtitle")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push("/dashboard/suspended")}
              className="btn-new btn-new--primary btn-new--sm"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}
            >
              <CreditCard size={14} aria-hidden />
              {t("shell.subscriptionTab.activateCta")}
            </button>
          </div>
        )}
      </section>

      {/* ── Cambiar plan ─────────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-2xl p-6" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={14} aria-hidden style={{ color: "var(--brand)" }} />
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
            {t("shell.subscriptionTab.changePlanTitle")}
          </h2>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
          {hasStripeSubscription
            ? t("shell.subscriptionTab.changePlanDescSub")
            : t("shell.subscriptionTab.changePlanDescCheckout")}
        </p>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          {(plans ?? []).map((plan) => {
            const isCurrent = plan.id === currentPlanId;
            const isPopular = plan.id === "PRO";
            const isPending = changingPlan === plan.id;
            return (
              <div
                key={plan.id}
                className="border rounded-xl"
                style={{
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  background: isCurrent ? "var(--brand-softer, hsl(var(--card)))" : "hsl(var(--card))",
                  borderColor: isCurrent ? "var(--brand)" : "hsl(var(--border))",
                  borderWidth: isCurrent ? 2 : 1,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>{plan.name}</div>
                  {isCurrent && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 100, background: "var(--brand)", color: "#fff", textTransform: "uppercase", letterSpacing: 0.4 }}>
                      {t("shell.subscriptionTab.currentPlanBadge")}
                    </span>
                  )}
                  {!isCurrent && isPopular && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 100, background: "rgba(124,58,237,0.15)", color: "var(--brand)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                      {t("shell.subscriptionTab.popularBadge")}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "var(--brand)" }}>
                  ${plan.priceMxn}
                  <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-3)", marginLeft: 4 }}>{t("shell.subscriptionTab.mxnPerMonth")}</span>
                </div>
                {!isCurrent && currentPlan && plan.priceMxn !== currentPlan.priceMxn && (
                  <div style={{ fontSize: 11, fontWeight: 600, color: plan.priceMxn > currentPlan.priceMxn ? "var(--brand)" : "var(--text-3)" }}>
                    {plan.priceMxn > currentPlan.priceMxn
                      ? t("shell.subscriptionTab.priceDeltaUp", { delta: plan.priceMxn - currentPlan.priceMxn })
                      : t("shell.subscriptionTab.priceDeltaDown", { delta: currentPlan.priceMxn - plan.priceMxn })}
                  </div>
                )}
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                  {[...plan.features, cfdiBullet(plan)].map((f) => (
                    <li key={f} style={{ fontSize: 11, color: "var(--text-2)", display: "flex", alignItems: "center", gap: 6 }}>
                      <Check size={11} aria-hidden style={{ color: "var(--brand)" }} />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => setConfirmPlan(plan.id)}
                  disabled={isCurrent || changingPlan !== null}
                  style={{
                    marginTop: 4,
                    padding: "8px 12px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: isCurrent || changingPlan !== null ? "not-allowed" : "pointer",
                    background: isCurrent ? "transparent" : "var(--brand)",
                    color: isCurrent ? "var(--text-3)" : "#fff",
                    border: isCurrent ? "1px solid var(--border-soft, hsl(var(--border)))" : 0,
                    opacity: isCurrent ? 0.6 : 1,
                  }}
                >
                  {isCurrent
                    ? t("shell.subscriptionTab.currentPlanBadge")
                    : isPending
                      ? t("shell.subscriptionTab.applying")
                      : t("shell.subscriptionTab.changeToThisPlan")}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Método de pago ───────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-2xl p-6" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
          {t("shell.subscriptionTab.paymentMethodTitle")}
        </h2>

        {clinic.paymentMethodCollected ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-soft, hsl(var(--border)))", borderRadius: 10 }}>
            {clinic.paymentMethodType === "card" ? (
              <>
                <div style={{ width: 40, height: 26, borderRadius: 4, background: "linear-gradient(135deg, #1a1f3a, #0d1026)", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, color: "#a78bfa" }}>
                  CARD
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500 }}>
                    {t("shell.subscriptionTab.cardEndingIn", { last4: clinic.paymentMethodLast4 ?? "••••" })}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {t("shell.subscriptionTab.autoMonthlyCharge")}
                  </div>
                </div>
              </>
            ) : clinic.paymentMethodType === "paypal" ? (
              <>
                <div style={{ width: 40, height: 26, borderRadius: 4, background: "#003087", display: "grid", placeItems: "center", fontSize: 9, fontWeight: 800, color: "#fff", letterSpacing: "0.02em" }}>
                  PayPal
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500 }}>PayPal</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>{t("shell.subscriptionTab.recurringSubscription")}</div>
                </div>
              </>
            ) : (
              <>
                <div style={{ width: 40, height: 26, borderRadius: 4, background: "rgba(251,191,36,0.2)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, color: "#fbbf24" }}>
                  SPEI
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500 }}>
                    {t("shell.subscriptionTab.bankTransfer")}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>{t("shell.subscriptionTab.manualPaymentConfirmation")}</div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div style={{ padding: 14, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 10, fontSize: 13, color: "#fcd34d" }}>
            {t("shell.subscriptionTab.noPaymentMethod")}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setPaymentModalOpen(true)}
            className="btn-new btn-new--secondary btn-new--sm"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <CreditCard size={12} aria-hidden />
            {t("shell.subscriptionTab.changePaymentMethod")}
          </button>
          {!localCancelRequested ? (
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              className="btn-new btn-new--ghost btn-new--sm"
              style={{ color: "var(--danger, #ef4444)" }}
            >
              {t("shell.subscriptionTab.cancelSubscription")}
            </button>
          ) : (
            <div style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", fontSize: 12, color: "#fca5a5", fontWeight: 500 }}>
              {t("shell.subscriptionTab.cancellationRequestedBadge")}
            </div>
          )}
        </div>
      </section>

      {/* ── Facturación CFDI (cupo del mes + excedente + adeudo) ──── */}
      <CfdiUsageCard />

      {/* ── Facturación ──────────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-2xl p-6" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Receipt size={14} aria-hidden style={{ color: "var(--brand)" }} />
            <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
              {t("shell.subscriptionTab.invoiceHistory")}
            </h2>
          </div>
          {hasStripeCustomer && (
            <button
              type="button"
              onClick={() => setPaymentModalOpen(true)}
              className="btn-new btn-new--ghost btn-new--sm"
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              {t("shell.subscriptionTab.stripePortal")} <ExternalLink size={11} aria-hidden />
            </button>
          )}
        </div>

        {invoices === null ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
            <Loader2 size={16} className="animate-spin" aria-hidden style={{ margin: "0 auto 6px", display: "block" }} />
            {t("shell.subscriptionTab.loadingInvoices")}
          </div>
        ) : invoices.length === 0 ? (
          <div style={{ padding: 22, background: "rgba(255,255,255,0.02)", border: "1px dashed var(--border-soft, hsl(var(--border)))", borderRadius: 10, fontSize: 13, color: "var(--text-3)", textAlign: "center" }}>
            {t("shell.subscriptionTab.noInvoices")}
            {stripeUnavailable && (
              <div style={{ marginTop: 6, fontSize: 11 }}>
                {t("shell.subscriptionTab.stripeNotConfigured")}
              </div>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto", margin: "0 -6px" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={thStyle}>{t("common.date")}</th>
                  <th style={thStyle}>{t("shell.subscriptionTab.colConcept")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("shell.subscriptionTab.colAmount")}</th>
                  <th style={thStyle}>{t("common.status")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} style={{ borderBottom: "1px solid var(--border-soft, hsl(var(--border)))" }}>
                    <td style={tdStyle}>{new Date(inv.date).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td style={tdStyle}>{inv.description}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                      {formatMoney(inv.amount, inv.currency)}
                    </td>
                    <td style={tdStyle}>
                      <StatusBadge status={inv.status} />
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                        {inv.downloadUrl && (
                          <a
                            href={inv.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-new btn-new--ghost btn-new--sm"
                            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px", fontSize: 11 }}
                            title={t("shell.subscriptionTab.downloadInvoice")}
                          >
                            <Download size={11} aria-hidden />
                            PDF
                          </a>
                        )}
                        {inv.paymentUrl && (
                          <a
                            href={inv.paymentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-new btn-new--secondary btn-new--sm"
                            style={{ padding: "4px 10px", fontSize: 11 }}
                            title={t("shell.subscriptionTab.payInvoice")}
                          >
                            {t("shell.subscriptionTab.pay")}
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Modal de cancelación (existente) ─────────────────────── */}
      {cancelOpen && (
        <div
          onClick={() => setCancelOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
            display: "grid", placeItems: "center", padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 480, width: "100%",
              background: "var(--bg-elev, hsl(var(--card)))",
              border: "1px solid rgba(239,68,68,0.35)",
              borderRadius: 14,
              padding: 28,
              boxShadow: "0 40px 80px rgba(0,0,0,0.6), 0 0 40px rgba(239,68,68,0.15)",
            }}
          >
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--text-1)", marginBottom: 10 }}>
              {t("shell.subscriptionTab.cancelModalTitle")}
            </h3>
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.55, marginBottom: 18 }}>
              {t("shell.subscriptionTab.cancelModalBodyStart")}{" "}
              <strong>{trialEndsAt && formatFecha(trialEndsAt)}</strong>{t("shell.subscriptionTab.cancelModalBodyEnd")}
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setCancelOpen(false)} className="btn-new btn-new--ghost">
                {t("shell.subscriptionTab.noKeep")}
              </button>
              <button type="button" onClick={handleRequestCancel} disabled={cancelling} className="btn-new btn-new--danger">
                {cancelling ? t("shell.subscriptionTab.processing") : t("shell.subscriptionTab.yesCancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de confirmación de cambio de plan ──────────────── */}
      {confirmPlan && (
        <div
          onClick={() => setConfirmPlan(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
            display: "grid", placeItems: "center", padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-2xl"
            style={{ maxWidth: 460, width: "100%", padding: 26 }}
          >
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--text-1)", marginBottom: 10 }}>
              {t("shell.subscriptionTab.confirmChangeTitle", { name: plans?.find((p) => p.id === confirmPlan)?.name ?? "" })}
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)", lineHeight: 1.55, marginBottom: 18 }}>
              {hasStripeSubscription
                ? t("shell.subscriptionTab.confirmChangeBodySub")
                : t("shell.subscriptionTab.confirmChangeBodyCheckout")}
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setConfirmPlan(null)} className="btn-new btn-new--ghost">
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => applyPlanChange(confirmPlan)}
                disabled={changingPlan !== null}
                className="btn-new btn-new--primary"
              >
                {changingPlan ? t("shell.subscriptionTab.applying") : t("shell.subscriptionTab.continue")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de método de pago ──────────────────────────────── */}
      <PaymentMethodModal
        open={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        currentPlan={currentPlanId}
        hasStripeCustomer={hasStripeCustomer}
        paypalUrl={paypalLinkFor(currentPlanId)}
      />
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "8px 6px",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "var(--text-3)",
  fontWeight: 600,
  borderBottom: "1px solid var(--border-soft, hsl(var(--border)))",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 6px",
  fontSize: 12,
  color: "var(--text-1)",
  verticalAlign: "middle",
};

function StatusBadge({ status }: { status: BillingInvoiceRow["status"] }) {
  const t = useT();
  const tones: Record<BillingInvoiceRow["status"], { bg: string; fg: string; labelKey: string }> = {
    paid:    { bg: "rgba(52,211,153,0.15)", fg: "#34d399", labelKey: "shell.subscriptionTab.statusPaid" },
    pending: { bg: "rgba(124,58,237,0.15)", fg: "#a78bfa", labelKey: "shell.subscriptionTab.statusPending" },
    overdue: { bg: "rgba(245,158,11,0.15)", fg: "#fbbf24", labelKey: "shell.subscriptionTab.statusOverdue" },
    failed:  { bg: "rgba(239,68,68,0.15)",  fg: "#f87171", labelKey: "shell.subscriptionTab.statusFailed" },
    void:    { bg: "rgba(148,163,184,0.15)", fg: "#94a3b8", labelKey: "shell.subscriptionTab.statusVoid" },
  };
  const tone = tones[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 9px",
        borderRadius: 100,
        background: tone.bg,
        color: tone.fg,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {t(tone.labelKey)}
    </span>
  );
}
