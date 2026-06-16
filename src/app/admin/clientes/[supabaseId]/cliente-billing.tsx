"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Wallet, DollarSign, Clock, ExternalLink, PauseCircle, PlayCircle, XCircle,
  RotateCcw, CreditCard, AlertTriangle, Check, X,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { ClienteDetalle, ClienteClinica, ClienteInvoice } from "@/lib/admin/clientes";

type Tone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

const PLAN_TONE: Record<string, Tone> = { CLINIC: "brand", PRO: "info", BASIC: "neutral" };

function subStatusMeta(s: string | null): { label: string; tone: Tone } {
  switch (s) {
    case "active":   return { label: "Activa", tone: "success" };
    case "trialing": return { label: "En trial", tone: "info" };
    case "past_due": return { label: "Pago vencido", tone: "danger" };
    case "cancelled":return { label: "Cancelada", tone: "danger" };
    case "paused":   return { label: "Pausada", tone: "warning" };
    default:         return { label: s || "Sin estado", tone: "neutral" };
  }
}

function invStatusMeta(inv: ClienteInvoice): { label: string; tone: Tone } {
  if (inv.refunded) return { label: "Reembolsado", tone: "neutral" };
  if (inv.status === "paid") return { label: "Pagado", tone: "success" };
  if (inv.status === "pending") return { label: "Pendiente", tone: "warning" };
  if (inv.status === "failed") return { label: "Rechazado", tone: "danger" };
  return { label: inv.status, tone: "neutral" };
}

const METHOD_LABEL: Record<string, string> = {
  stripe: "Stripe", transfer: "Transferencia", spei: "SPEI", deposit: "Depósito",
  oxxo: "OXXO", paypal: "PayPal", cash: "Efectivo", mercadopago: "MercadoPago",
};
function methodLabel(m: string | null): string {
  if (!m) return "—";
  return METHOD_LABEL[m] ?? m;
}

function paymentMethodDisplay(c: ClienteClinica): string {
  if (!c.paymentMethodCollected && !c.paymentMethodType) return "No registrado";
  if (c.paymentMethodType === "card") return `Tarjeta ••${c.paymentMethodLast4 ?? "••••"}`;
  if (c.paymentMethodType === "paypal") return "PayPal";
  if (c.paymentMethodType === "transfer") return "Transferencia";
  return c.preferredPaymentMethod ? methodLabel(c.preferredPaymentMethod) : "No registrado";
}

function nextBillingLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  const fecha = formatDate(d);
  if (days < 0) return `${fecha} · vencido`;
  if (days === 0) return `${fecha} · hoy`;
  return `${fecha} · en ${days}d`;
}

async function postJson(url: string, body: any): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Error en la operación");
  return data;
}

export function ClienteBilling({
  cliente,
  stripeConfigured,
  stripeInstructions,
}: {
  cliente: ClienteDetalle;
  stripeConfigured: boolean;
  stripeInstructions: string;
}) {
  const router = useRouter();
  const askConfirm = useConfirm();
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  // Modal de reembolso
  const [refundFor, setRefundFor] = useState<ClienteInvoice | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refunding, setRefunding] = useState(false);

  async function changePlan(clinicId: string, plan: string) {
    setLoadingKey(`${clinicId}:plan`);
    try {
      const res = await fetch(`/api/admin/clinics/${clinicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Error");
      toast.success("Plan actualizado");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message ?? "Error al cambiar el plan");
    } finally {
      setLoadingKey(null);
    }
  }

  async function openPortal(clinicId: string) {
    setLoadingKey(`${clinicId}:portal`);
    try {
      const data = await postJson("/api/admin/billing/stripe", { action: "customer_portal", clinicId });
      if (data.url) window.open(data.url, "_blank", "noopener");
      else toast.error("No se obtuvo el enlace del portal");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingKey(null);
    }
  }

  async function pauseResume(clinic: ClienteClinica) {
    const isPaused = clinic.subscriptionStatus === "paused";
    const action = isPaused ? "resume_subscription" : "pause_subscription";
    const ok = await askConfirm({
      title: isPaused ? "¿Reanudar cobros?" : "¿Pausar cobros?",
      description: isPaused
        ? `Stripe volverá a cobrar la suscripción de "${clinic.name}".`
        : `Stripe dejará de cobrar a "${clinic.name}" hasta que reanudes. No cancela la cuenta.`,
      variant: "warning",
      confirmText: isPaused ? "Reanudar" : "Pausar",
    });
    if (!ok) return;
    setLoadingKey(`${clinic.id}:pause`);
    try {
      await postJson("/api/admin/billing/stripe", { action, clinicId: clinic.id });
      toast.success(isPaused ? "Cobros reanudados" : "Cobros pausados");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingKey(null);
    }
  }

  async function cancelSub(clinic: ClienteClinica) {
    const ok = await askConfirm({
      title: "¿Cancelar suscripción?",
      description: `Se cancelará la suscripción de Stripe de "${clinic.name}". Esta acción no se puede deshacer desde aquí.`,
      variant: "danger",
      confirmText: "Cancelar suscripción",
    });
    if (!ok) return;
    setLoadingKey(`${clinic.id}:cancel`);
    try {
      await postJson("/api/admin/billing/stripe", { action: "cancel_subscription", clinicId: clinic.id });
      toast.success("Suscripción cancelada");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingKey(null);
    }
  }

  async function verifyPay(inv: ClienteInvoice) {
    setLoadingKey(`inv:${inv.id}`);
    try {
      await postJson("/api/admin/billing", { action: "verify_payment", invoiceId: inv.id });
      toast.success("Pago aceptado");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingKey(null);
    }
  }

  async function rejectPay(inv: ClienteInvoice) {
    const ok = await askConfirm({
      title: "¿Rechazar pago?",
      description: `El cobro de ${formatCurrency(inv.amount, "MXN")} de "${inv.clinicName}" se marcará como rechazado.`,
      variant: "danger",
      confirmText: "Rechazar",
    });
    if (!ok) return;
    setLoadingKey(`inv:${inv.id}`);
    try {
      await postJson("/api/admin/billing", { action: "reject_payment", invoiceId: inv.id, reason: "Rechazado por admin" });
      toast.success("Pago rechazado");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingKey(null);
    }
  }

  function openRefund(inv: ClienteInvoice) {
    setRefundFor(inv);
    setRefundAmount(String(inv.amount));
    setRefundReason("");
  }

  async function submitRefund() {
    if (!refundFor) return;
    const amount = Number(refundAmount);
    if (!(amount > 0) || amount > refundFor.amount) {
      toast.error("Monto inválido (debe ser mayor a 0 y no exceder el cobro)");
      return;
    }
    setRefunding(true);
    try {
      await postJson("/api/admin/billing", {
        action: "refund_payment",
        invoiceId: refundFor.id,
        amountMxn: amount === refundFor.amount ? undefined : amount, // sin amount = reembolso total
        reason: refundReason,
      });
      toast.success("Reembolso procesado");
      setRefundFor(null);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRefunding(false);
    }
  }

  const stripeDisabledTitle = stripeConfigured ? undefined : "Configura Stripe primero";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Aviso Stripe no configurado */}
      {!stripeConfigured && (
        <div style={{
          padding: 16, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)",
          borderRadius: 14, display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={16} style={{ color: "var(--warning)" }} />
            <strong style={{ fontSize: 13, color: "var(--warning)" }}>Stripe no está configurado</strong>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-2)", margin: 0 }}>
            Los datos de cobros se muestran igual, pero las acciones de Stripe (portal, pausar, cancelar, reembolsar) están deshabilitadas.
          </p>
          <pre style={{
            whiteSpace: "pre-wrap", fontSize: 11, color: "var(--text-3)", background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)", borderRadius: 8, padding: 12, margin: 0, lineHeight: 1.5,
          }}>{stripeInstructions}</pre>
        </div>
      )}

      {/* KPIs de facturación */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <KpiCard label="Ingresos históricos" value={formatCurrency(cliente.ingresosTotales, "MXN")} icon={Wallet} />
        <KpiCard label="MRR" value={formatCurrency(cliente.mrr, "MXN")} icon={DollarSign} />
        <KpiCard
          label="Cobros pendientes"
          value={String(cliente.pendingPaymentsCount)}
          icon={Clock}
          delta={cliente.pendingPaymentsCount > 0 ? { value: "Requieren aprobación", direction: "down" } : undefined}
        />
      </div>

      {/* Una sección por clínica */}
      {cliente.clinics.map((clinic) => {
        const sub = subStatusMeta(clinic.subscriptionStatus);
        const isPaused = clinic.subscriptionStatus === "paused";
        const busy = (k: string) => loadingKey === `${clinic.id}:${k}`;
        return (
          <CardNew key={clinic.id} noPad>
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Cabecera clínica */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <CreditCard size={16} style={{ color: "var(--brand)" }} />
                <Link href={`/admin/clinics/${clinic.id}`} style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 15, textDecoration: "none" }}>
                  {clinic.name}
                </Link>
                <BadgeNew tone={PLAN_TONE[clinic.plan] ?? "neutral"}>{clinic.plan}</BadgeNew>
                <BadgeNew tone={sub.tone} dot>{sub.label}</BadgeNew>
              </div>

              {/* Datos de billing */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                <Field label="Próximo cobro" value={nextBillingLabel(clinic.nextBillingDate)} />
                <Field label="Método de pago" value={paymentMethodDisplay(clinic)} />
                <Field label="Precio mensual" value={`${formatCurrency(clinic.planPrice, "MXN")}/mes`} />
                <Field label="Suscripción Stripe" value={clinic.stripeSubscriptionId ?? "—"} mono />
              </div>

              {/* Acciones */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  className="input-new"
                  value={clinic.plan}
                  onChange={(e) => changePlan(clinic.id, e.target.value)}
                  disabled={busy("plan")}
                  style={{ width: "auto" }}
                  title="Cambiar plan"
                >
                  <option value="BASIC">Plan BASIC</option>
                  <option value="PRO">Plan PRO</option>
                  <option value="CLINIC">Plan CLINIC</option>
                </select>

                <ButtonNew
                  size="sm" variant="secondary" icon={<ExternalLink size={13} />}
                  onClick={() => openPortal(clinic.id)}
                  disabled={!stripeConfigured || !clinic.stripeCustomerId || busy("portal")}
                  title={!clinic.stripeCustomerId ? "Sin customer de Stripe" : stripeDisabledTitle}
                >
                  Portal de Stripe
                </ButtonNew>

                <ButtonNew
                  size="sm" variant="secondary"
                  icon={isPaused ? <PlayCircle size={13} /> : <PauseCircle size={13} />}
                  onClick={() => pauseResume(clinic)}
                  disabled={!stripeConfigured || !clinic.stripeSubscriptionId || busy("pause")}
                  title={!clinic.stripeSubscriptionId ? "Sin suscripción de Stripe" : stripeDisabledTitle}
                >
                  {isPaused ? "Reanudar cobros" : "Pausar cobros"}
                </ButtonNew>

                <ButtonNew
                  size="sm" variant="ghost"
                  icon={<XCircle size={13} />}
                  onClick={() => cancelSub(clinic)}
                  disabled={!stripeConfigured || !clinic.stripeSubscriptionId || busy("cancel")}
                  title={!clinic.stripeSubscriptionId ? "Sin suscripción de Stripe" : stripeDisabledTitle}
                  style={{ color: "var(--danger)" }}
                >
                  Cancelar suscripción
                </ButtonNew>
              </div>

              {/* Historial de cobros */}
              <div>
                <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 8 }}>
                  Historial de cobros ({clinic.invoices.length})
                </div>
                {clinic.invoices.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--text-3)", padding: "8px 0" }}>Sin cobros registrados.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="table-new">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Monto</th>
                          <th>Método</th>
                          <th>Estado</th>
                          <th>Referencia</th>
                          <th style={{ textAlign: "right" }}>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clinic.invoices.map((inv) => {
                          const st = invStatusMeta(inv);
                          const invBusy = loadingKey === `inv:${inv.id}`;
                          return (
                            <tr key={inv.id}>
                              <td className="mono" style={{ color: "var(--text-2)" }}>
                                {formatDate(inv.paidAt ?? inv.createdAt)}
                              </td>
                              <td className="mono" style={{ color: "var(--text-1)", fontWeight: 500 }}>
                                {formatCurrency(inv.amount, "MXN")}
                              </td>
                              <td style={{ color: "var(--text-2)" }}>{methodLabel(inv.method)}</td>
                              <td><BadgeNew tone={st.tone} dot>{st.label}</BadgeNew></td>
                              <td className="mono" style={{ color: "var(--text-3)", fontSize: 11, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {inv.reference ?? "—"}
                              </td>
                              <td style={{ textAlign: "right" }}>
                                <div style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                                  {inv.status === "pending" && (
                                    <>
                                      <ButtonNew size="sm" variant="secondary" icon={<Check size={12} />} onClick={() => verifyPay(inv)} disabled={invBusy}>
                                        Aceptar
                                      </ButtonNew>
                                      <ButtonNew size="sm" variant="ghost" icon={<X size={12} />} onClick={() => rejectPay(inv)} disabled={invBusy} style={{ color: "var(--danger)" }}>
                                        Rechazar
                                      </ButtonNew>
                                    </>
                                  )}
                                  {inv.refundable && (
                                    <ButtonNew size="sm" variant="ghost" icon={<RotateCcw size={12} />} onClick={() => openRefund(inv)} disabled={!stripeConfigured} title={stripeDisabledTitle}>
                                      Reembolsar
                                    </ButtonNew>
                                  )}
                                  {inv.refunded && (
                                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>Reembolsado</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </CardNew>
        );
      })}

      {/* Modal reembolso */}
      {refundFor && (
        <div className="modal-overlay" onClick={() => !refunding && setRefundFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "color-mix(in oklab, var(--brand) 14%, transparent)", display: "grid", placeItems: "center", color: "var(--brand)", flexShrink: 0 }}>
                  <RotateCcw size={16} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="modal__title">Reembolsar cobro</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {refundFor.clinicName} · {formatCurrency(refundFor.amount, "MXN")}
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setRefundFor(null)} disabled={refunding} className="btn-new btn-new--ghost btn-new--sm" aria-label="Cerrar">
                <X size={14} />
              </button>
            </div>

            <div className="modal__body">
              <div className="field-new" style={{ marginBottom: 12 }}>
                <label className="field-new__label">Monto a reembolsar (MXN)</label>
                <input
                  type="number" className="input-new" autoFocus disabled={refunding}
                  value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)}
                  min={1} max={refundFor.amount} step="0.01"
                />
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
                  Máximo {formatCurrency(refundFor.amount, "MXN")}. Déjalo en el total para reembolso completo.
                </div>
              </div>
              <div className="field-new">
                <label className="field-new__label">Motivo (opcional)</label>
                <textarea
                  className="input-new" rows={3} disabled={refunding}
                  value={refundReason} onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Ej. cobro duplicado, ajuste comercial…"
                  style={{ height: "auto", resize: "vertical" }}
                />
              </div>
            </div>

            <div className="modal__footer">
              <ButtonNew variant="ghost" onClick={() => setRefundFor(null)} disabled={refunding}>Cancelar</ButtonNew>
              <ButtonNew variant="primary" icon={<RotateCcw size={14} />} onClick={submitRefund} disabled={refunding}>
                {refunding ? "Procesando…" : "Reembolsar"}
              </ButtonNew>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>{label}</div>
      <div className={mono ? "mono" : undefined} style={{ fontSize: mono ? 11 : 13, color: "var(--text-1)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  );
}
