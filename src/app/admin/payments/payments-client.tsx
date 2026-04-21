"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { X, DollarSign, TrendingUp, AlertCircle, XCircle, CheckCircle2, Plus } from "lucide-react";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { fmtMXN } from "@/lib/format";

/* ── Constants ────────────────────────────────────────────────────────────── */

const PLAN_PRICES: Record<string, number> = { BASIC: 299, PRO: 499, CLINIC: 799 };

const PAYMENT_METHODS = [
  { value: "stripe",   label: "Stripe",        icon: "\uD83D\uDCB3" },
  { value: "transfer", label: "Transferencia",  icon: "\uD83C\uDFE6" },
  { value: "oxxo",     label: "OXXO",           icon: "\uD83C\uDFEA" },
  { value: "paypal",   label: "PayPal",         icon: "\uD83C\uDD7F\uFE0F" },
  { value: "cash",     label: "Efectivo",       icon: "\uD83D\uDCB5" },
] as const;

function methodBadge(method: string | null | undefined) {
  const m = PAYMENT_METHODS.find(pm => pm.value === method);
  return m ? `${m.icon} ${m.label}` : method ?? "\u2014";
}

function statusBadge(status: string) {
  if (status === "paid")    return <BadgeNew tone="success" dot>Pagado</BadgeNew>;
  if (status === "pending") return <BadgeNew tone="warning" dot>Pendiente</BadgeNew>;
  if (status === "failed")  return <BadgeNew tone="danger"  dot>Fallido</BadgeNew>;
  return <BadgeNew tone="neutral" dot>{status}</BadgeNew>;
}

function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

/* ── Props ────────────────────────────────────────────────────────────────── */

interface Props {
  metrics: {
    totalClinics: number;
    activeClinics: number;
    trialClinics: number;
    expiredClinics: number;
    currentMRR: number;
    thisMonthRevenue: number;
    thisMonthPayments: number;
    prevMonthRevenue: number;
    revenueChange: number;
  };
  recentPayments: any[];
  pendingTransfers: any[];
  overdueClinics: any[];
  clinics: any[];
}

/* ── Component ────────────────────────────────────────────────────────────── */

export function PaymentsClient({
  metrics,
  recentPayments: initPayments,
  pendingTransfers: initPending,
  overdueClinics: initOverdue,
  clinics,
}: Props) {
  /* State */
  const [tab, setTab] = useState<"pending" | "all" | "overdue">("pending");
  const [payments, setPayments] = useState(initPayments);
  const [pending, setPending] = useState(initPending);
  const [overdue, setOverdue] = useState(initOverdue);

  const [showNewPayment, setShowNewPayment] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  // Filters for "all payments" tab
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterMethod, setFilterMethod] = useState("all");

  // Activate clinic form
  const [activateClinicId, setActivateClinicId] = useState<string | null>(null);
  const [activatePlan, setActivatePlan] = useState("PRO");
  const [activateMonths, setActivateMonths] = useState(1);

  // Reject modal
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // New payment form
  const [form, setForm] = useState({
    clinicId: "",
    amount: "",
    method: "transfer",
    reference: "",
    periodStart: "",
    periodEnd: "",
    notes: "",
    paypalEmail: "",
    paypalRecurring: false,
  });

  // Coupon
  const [couponCode, setCouponCode]   = useState("");
  const [couponApplied, setCouponApplied] = useState<{ code: string; discount: number; finalAmount: number } | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  function setF(k: string, v: string | boolean) {
    setForm(f => ({ ...f, [k]: v }));
  }

  /* Auto-fill from clinic plan */
  function onClinicChange(clinicId: string) {
    const clinic = clinics.find((c: any) => c.id === clinicId);
    const price = clinic?.monthlyPrice || PLAN_PRICES[clinic?.plan] || 0;
    const now = new Date();
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
    setForm(f => ({ ...f, clinicId, amount: String(price), periodStart: start, periodEnd: endStr }));
  }

  /* Filtered payments */
  const filteredPayments = useMemo(() => {
    return payments.filter((p: any) => {
      if (filterStatus !== "all" && p.status !== filterStatus) return false;
      if (filterMethod !== "all" && p.method !== filterMethod) return false;
      return true;
    });
  }, [payments, filterStatus, filterMethod]);

  /* ── Actions ──────────────────────────────────────────────────────────── */

  async function verifyPayment(invoiceId: string) {
    setLoading(invoiceId);
    try {
      const res = await fetch("/api/admin/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify_payment", invoiceId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Error al verificar");
      setPending(prev => prev.filter((p: any) => p.id !== invoiceId));
      setPayments(prev =>
        prev.map((p: any) => (p.id === invoiceId ? { ...p, status: "paid", paidAt: new Date().toISOString() } : p))
      );
      toast.success("Pago verificado correctamente");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(null);
    }
  }

  async function rejectPayment(invoiceId: string, reason: string) {
    setLoading(invoiceId);
    try {
      const res = await fetch("/api/admin/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject_payment", invoiceId, reason }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Error al rechazar");
      setPending(prev => prev.filter((p: any) => p.id !== invoiceId));
      setPayments(prev =>
        prev.map((p: any) => (p.id === invoiceId ? { ...p, status: "failed" } : p))
      );
      setRejectId(null);
      setRejectReason("");
      toast.success("Pago rechazado");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(null);
    }
  }

  async function activateClinic(clinicId: string) {
    setLoading(clinicId);
    try {
      const res = await fetch("/api/admin/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate_clinic", clinicId, plan: activatePlan, months: activateMonths }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Error al activar");
      setOverdue(prev => prev.filter((c: any) => c.id !== clinicId));
      setActivateClinicId(null);
      toast.success("Clinica activada correctamente");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(null);
    }
  }

  async function applyCoupon() {
    if (!couponCode.trim()) { toast.error("Escribe un código"); return; }
    if (!form.amount) { toast.error("Selecciona clínica y monto primero"); return; }
    setValidatingCoupon(true);
    try {
      const clinic = clinics.find((c: any) => c.id === form.clinicId);
      const res = await fetch("/api/admin/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: couponCode.trim(),
          amount: parseFloat(form.amount),
          plan: clinic?.plan,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Cupón inválido");
      }
      const data = await res.json();
      setCouponApplied({
        code: data.code,
        discount: data.discount,
        finalAmount: data.finalAmount,
      });
      toast.success(`Cupón aplicado: -$${data.discount.toFixed(2)}`);
    } catch (e: any) {
      toast.error(e.message);
      setCouponApplied(null);
    } finally {
      setValidatingCoupon(false);
    }
  }

  function removeCoupon() {
    setCouponApplied(null);
    setCouponCode("");
  }

  async function createPayment() {
    if (!form.clinicId || !form.amount || !form.periodStart || !form.periodEnd) {
      toast.error("Completa todos los campos obligatorios");
      return;
    }
    setLoading("new");
    try {
      const finalAmount = couponApplied ? couponApplied.finalAmount : parseFloat(form.amount);
      const notesWithCoupon = couponApplied
        ? `${form.notes ? form.notes + " · " : ""}Cupón ${couponApplied.code} -$${couponApplied.discount.toFixed(2)}`.trim()
        : form.notes;
      const res = await fetch("/api/admin/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinicId: form.clinicId,
          amount: finalAmount,
          method: form.method,
          reference: form.reference,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          notes: notesWithCoupon,
          status: "paid",
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const inv = await res.json();
      setPayments(prev => [inv, ...prev]);
      setShowNewPayment(false);
      setForm({ clinicId: "", amount: "", method: "transfer", reference: "", periodStart: "", periodEnd: "", notes: "", paypalEmail: "", paypalRecurring: false });
      setCouponApplied(null);
      setCouponCode("");
      toast.success("Pago registrado correctamente");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(null);
    }
  }

  async function generateStripeLink() {
    if (!form.clinicId) {
      toast.error("Selecciona una clinica primero");
      return;
    }
    const clinic = clinics.find((c: any) => c.id === form.clinicId);
    setLoading("stripe");
    try {
      const res = await fetch("/api/admin/billing/stripe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_subscription", clinicId: form.clinicId, plan: clinic?.plan || "PRO" }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Error al generar link");
      const data = await res.json();
      if (data.url) {
        navigator.clipboard.writeText(data.url).catch(() => {});
        toast.success("Link de Stripe copiado al portapapeles");
      } else {
        toast.success("Suscripcion Stripe creada");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(null);
    }
  }

  /* ── Render ───────────────────────────────────────────────────────────── */

  const tabs = [
    { key: "pending" as const, label: "Pendientes de verificar", count: pending.length },
    { key: "all"     as const, label: "Todos los pagos",         count: payments.length },
    { key: "overdue" as const, label: "Clínicas vencidas",       count: overdue.length },
  ];

  const statusFilters = [
    { v: "all",     l: "Todos" },
    { v: "paid",    l: "Pagados" },
    { v: "pending", l: "Pendientes" },
    { v: "failed",  l: "Fallidos" },
  ];

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Pagos de suscripción
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
            Gestiona pagos, verifica transferencias y activa clínicas
          </p>
        </div>
        <ButtonNew
          variant="primary"
          onClick={() => setShowNewPayment(!showNewPayment)}
          icon={<Plus size={14} />}
        >
          Registrar pago
        </ButtonNew>
      </div>

      {/* ── KPI row ─────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard
          label="MRR actual"
          value={fmtMXN(metrics.currentMRR)}
          icon={DollarSign}
          delta={{ value: `${metrics.activeClinics} clínicas activas`, direction: "up" }}
        />
        <KpiCard
          label="Ingresos este mes"
          value={fmtMXN(metrics.thisMonthRevenue)}
          icon={TrendingUp}
          delta={{
            value: `${Math.abs(metrics.revenueChange)}% vs mes anterior`,
            direction: metrics.revenueChange >= 0 ? "up" : "down",
          }}
        />
        <KpiCard
          label="Pendientes"
          value={String(pending.length)}
          icon={AlertCircle}
          delta={{
            value: `${fmtMXN(pending.reduce((s: number, p: any) => s + (p.amount || 0), 0))} en espera`,
            direction: "up",
          }}
        />
        <KpiCard
          label="Clínicas vencidas"
          value={String(metrics.expiredClinics)}
          icon={XCircle}
          delta={{ value: `${overdue.length} requieren acción`, direction: "down" }}
        />
      </div>

      {/* ── New Payment Form ────────────────────────────────────────────── */}
      {showNewPayment && (
        <div style={{ marginBottom: 20 }}>
          <CardNew
            title="Registrar nuevo pago"
            sub="Completa los datos del pago. El monto se precarga según el plan de la clínica."
            action={
              <ButtonNew
                variant="ghost"
                size="sm"
                onClick={() => setShowNewPayment(false)}
                icon={<X size={14} />}
              >
                Cerrar
              </ButtonNew>
            }
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
              <div className="field-new">
                <label className="field-new__label">Clínica <span className="req">*</span></label>
                <select
                  className="input-new"
                  value={form.clinicId}
                  onChange={e => onClinicChange(e.target.value)}
                >
                  <option value="">Selecciona clínica</option>
                  {clinics.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.plan})</option>
                  ))}
                </select>
              </div>

              <div className="field-new">
                <label className="field-new__label">Monto (MXN) <span className="req">*</span></label>
                <input
                  className="input-new"
                  type="number"
                  value={form.amount}
                  onChange={e => setF("amount", e.target.value)}
                  placeholder="499"
                />
              </div>

              <div className="field-new">
                <label className="field-new__label">Método de pago <span className="req">*</span></label>
                <select
                  className="input-new"
                  value={form.method}
                  onChange={e => setF("method", e.target.value)}
                >
                  {PAYMENT_METHODS.map(m => (
                    <option key={m.value} value={m.value}>{m.icon} {m.label}</option>
                  ))}
                </select>
              </div>

              <div className="field-new">
                <label className="field-new__label">Referencia / Folio</label>
                <input
                  className="input-new"
                  value={form.reference}
                  onChange={e => setF("reference", e.target.value)}
                  placeholder="Número de transferencia, orden, etc."
                />
              </div>

              <div className="field-new">
                <label className="field-new__label">Periodo inicio <span className="req">*</span></label>
                <input
                  className="input-new"
                  type="date"
                  value={form.periodStart}
                  onChange={e => setF("periodStart", e.target.value)}
                />
              </div>

              <div className="field-new">
                <label className="field-new__label">Periodo fin <span className="req">*</span></label>
                <input
                  className="input-new"
                  type="date"
                  value={form.periodEnd}
                  onChange={e => setF("periodEnd", e.target.value)}
                />
              </div>
            </div>

            {/* Stripe section */}
            {form.method === "stripe" && (
              <div style={{ marginTop: 14 }}>
                <ButtonNew
                  variant="secondary"
                  onClick={generateStripeLink}
                  disabled={loading === "stripe"}
                >
                  {loading === "stripe" ? "Generando…" : "💳 Generar link de pago Stripe"}
                </ButtonNew>
                <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>
                  Se creará una suscripción en Stripe y se copiará el link de pago
                </p>
              </div>
            )}

            {/* PayPal section */}
            {form.method === "paypal" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14, marginTop: 14 }}>
                <div className="field-new">
                  <label className="field-new__label">Email PayPal</label>
                  <input
                    className="input-new"
                    value={form.paypalEmail}
                    onChange={e => setF("paypalEmail", e.target.value)}
                    placeholder="correo@paypal.com"
                  />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 22 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "var(--text-2)", fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={form.paypalRecurring}
                      onChange={e => setF("paypalRecurring", e.target.checked)}
                    />
                    <span>Suscripción recurrente</span>
                  </label>
                  {!form.paypalRecurring && <BadgeNew tone="info">Pago único</BadgeNew>}
                </div>
              </div>
            )}

            <div className="field-new" style={{ marginTop: 14 }}>
              <label className="field-new__label">Notas</label>
              <input
                className="input-new"
                value={form.notes}
                onChange={e => setF("notes", e.target.value)}
                placeholder="Observaciones opcionales"
              />
            </div>

            {/* Coupon */}
            <div
              style={{
                marginTop: 14,
                padding: 14,
                borderRadius: 10,
                border: "1px dashed var(--border-soft)",
                background: "var(--bg-elev)",
              }}
            >
              <div className="field-new__label" style={{ marginBottom: 8 }}>Cupón de descuento (opcional)</div>
              {couponApplied ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1, fontSize: 12 }}>
                    <span className="mono" style={{ fontWeight: 600, color: "var(--success)" }}>{couponApplied.code}</span>
                    <span style={{ color: "var(--text-3)", marginLeft: 8 }}>−${couponApplied.discount.toFixed(2)} MXN</span>
                    <span style={{ color: "var(--text-3)", marginLeft: 8 }}>
                      → total: <span style={{ fontWeight: 600, color: "var(--text-1)" }}>${couponApplied.finalAmount.toFixed(2)}</span>
                    </span>
                  </div>
                  <ButtonNew size="sm" variant="ghost" onClick={removeCoupon}>Quitar</ButtonNew>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="input-new mono"
                    style={{ textTransform: "uppercase", flex: 1 }}
                    value={couponCode}
                    onChange={e => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="Ej: LANZAMIENTO20"
                  />
                  <ButtonNew
                    variant="primary"
                    onClick={applyCoupon}
                    disabled={validatingCoupon || !couponCode.trim()}
                  >
                    {validatingCoupon ? "…" : "Aplicar"}
                  </ButtonNew>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
              <ButtonNew variant="ghost" onClick={() => setShowNewPayment(false)}>
                Cancelar
              </ButtonNew>
              <ButtonNew
                variant="primary"
                onClick={createPayment}
                disabled={loading === "new"}
              >
                {loading === "new" ? "Guardando…" : "Guardar pago"}
              </ButtonNew>
            </div>
          </CardNew>
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 18 }}>
        <div className="segment-new" style={{ display: "inline-flex", gap: 2 }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`segment-new__btn ${tab === t.key ? "segment-new__btn--active" : ""}`}
            >
              {t.label}
              <span style={{ marginLeft: 6, opacity: 0.6, fontSize: 11 }}>{t.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab: Pending Transfers ──────────────────────────────────────── */}
      {tab === "pending" && (
        <CardNew noPad>
          {pending.length === 0 ? (
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <CheckCircle2 size={32} style={{ color: "var(--success)", margin: "0 auto 10px" }} />
              <div style={{ color: "var(--text-2)", fontSize: 13, fontWeight: 500 }}>
                No hay pagos pendientes de verificar
              </div>
              <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 4 }}>
                Todos los pagos están al día
              </div>
            </div>
          ) : (
            <table className="table-new">
              <thead>
                <tr>
                  <th>Clínica</th>
                  <th>Plan</th>
                  <th>Monto</th>
                  <th>Método</th>
                  <th>Referencia</th>
                  <th>Fecha</th>
                  <th style={{ textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((inv: any) => (
                  <tr key={inv.id}>
                    <td>
                      <div style={{ color: "var(--text-1)", fontWeight: 500 }}>{inv.clinic?.name ?? "—"}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)" }}>{inv.clinic?.email}</div>
                    </td>
                    <td>
                      <BadgeNew tone={inv.clinic?.plan === "CLINIC" ? "brand" : inv.clinic?.plan === "PRO" ? "info" : "neutral"}>
                        {inv.clinic?.plan ?? "—"}
                      </BadgeNew>
                    </td>
                    <td className="mono" style={{ color: "var(--success)", fontWeight: 600 }}>
                      {fmtMXN(inv.amount)}
                    </td>
                    <td style={{ color: "var(--text-2)" }}>{methodBadge(inv.method)}</td>
                    <td className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {inv.reference || "—"}
                    </td>
                    <td className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {fmtDate(inv.createdAt)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <ButtonNew
                          size="sm"
                          variant="primary"
                          onClick={() => verifyPayment(inv.id)}
                          disabled={loading === inv.id}
                        >
                          {loading === inv.id ? "…" : "Verificar"}
                        </ButtonNew>
                        <ButtonNew
                          size="sm"
                          variant="danger"
                          onClick={() => setRejectId(inv.id)}
                          disabled={loading === inv.id}
                        >
                          Rechazar
                        </ButtonNew>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Reject modal */}
          {rejectId && (
            <div className="modal-overlay" onClick={() => { setRejectId(null); setRejectReason(""); }}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal__header">
                  <div className="modal__title">Rechazar pago</div>
                  <button
                    className="btn-new btn-new--ghost btn-new--sm"
                    onClick={() => { setRejectId(null); setRejectReason(""); }}
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="modal__body">
                  <div className="field-new">
                    <label className="field-new__label">Razón del rechazo</label>
                    <textarea
                      className="input-new"
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      rows={3}
                      placeholder="Referencia no encontrada, monto incorrecto, etc."
                    />
                  </div>
                </div>
                <div className="modal__footer">
                  <ButtonNew
                    variant="ghost"
                    onClick={() => { setRejectId(null); setRejectReason(""); }}
                  >
                    Cancelar
                  </ButtonNew>
                  <ButtonNew
                    variant="danger"
                    onClick={() => rejectPayment(rejectId, rejectReason)}
                    disabled={!rejectReason.trim() || loading === rejectId}
                  >
                    {loading === rejectId ? "Rechazando…" : "Confirmar rechazo"}
                  </ButtonNew>
                </div>
              </div>
            </div>
          )}
        </CardNew>
      )}

      {/* ── Tab: All Payments ───────────────────────────────────────────── */}
      {tab === "all" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Filters */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 500 }}>Estado:</span>
              <div className="segment-new" style={{ display: "inline-flex", gap: 2 }}>
                {statusFilters.map(f => (
                  <button
                    key={f.v}
                    onClick={() => setFilterStatus(f.v)}
                    className={`segment-new__btn ${filterStatus === f.v ? "segment-new__btn--active" : ""}`}
                  >
                    {f.l}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 500 }}>Método:</span>
              <div className="segment-new" style={{ display: "inline-flex", gap: 2 }}>
                <button
                  onClick={() => setFilterMethod("all")}
                  className={`segment-new__btn ${filterMethod === "all" ? "segment-new__btn--active" : ""}`}
                >
                  Todos
                </button>
                {PAYMENT_METHODS.map(m => (
                  <button
                    key={m.value}
                    onClick={() => setFilterMethod(m.value)}
                    className={`segment-new__btn ${filterMethod === m.value ? "segment-new__btn--active" : ""}`}
                  >
                    {m.icon} {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Table */}
          <CardNew noPad>
            {filteredPayments.length === 0 ? (
              <div style={{ padding: "60px 0", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                Sin registros con esos filtros
              </div>
            ) : (
              <table className="table-new">
                <thead>
                  <tr>
                    <th>Clínica</th>
                    <th>Monto</th>
                    <th>Método</th>
                    <th>Estado</th>
                    <th>Referencia</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.map((inv: any) => (
                    <tr key={inv.id}>
                      <td style={{ color: "var(--text-1)", fontWeight: 500 }}>
                        {inv.clinic?.name ?? "—"}
                      </td>
                      <td className="mono" style={{ color: "var(--success)", fontWeight: 600 }}>
                        {fmtMXN(inv.amount)}
                      </td>
                      <td style={{ color: "var(--text-2)" }}>{methodBadge(inv.method)}</td>
                      <td>{statusBadge(inv.status)}</td>
                      <td className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                        {inv.reference || "—"}
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                            {fmtDate(inv.createdAt)}
                          </span>
                          <Link
                            href={`/admin/payments/${inv.id}/cfdi`}
                            style={{ fontSize: 11, fontWeight: 600, color: "#c4b5fd", textDecoration: "none" }}
                          >
                            CFDI
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardNew>
        </div>
      )}

      {/* ── Tab: Overdue Clinics ────────────────────────────────────────── */}
      {tab === "overdue" && (
        <CardNew noPad>
          {overdue.length === 0 ? (
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <CheckCircle2 size={32} style={{ color: "var(--success)", margin: "0 auto 10px" }} />
              <div style={{ color: "var(--text-2)", fontSize: 13, fontWeight: 500 }}>
                No hay clínicas vencidas
              </div>
              <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 4 }}>
                Todas las clínicas tienen suscripción activa o trial vigente
              </div>
            </div>
          ) : (
            <table className="table-new">
              <thead>
                <tr>
                  <th>Clínica</th>
                  <th>Plan</th>
                  <th>Email</th>
                  <th>Venció</th>
                  <th style={{ textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {overdue.map((clinic: any) => (
                  <tr key={clinic.id}>
                    <td style={{ color: "var(--text-1)", fontWeight: 500 }}>{clinic.name}</td>
                    <td>
                      <BadgeNew tone={clinic.plan === "CLINIC" ? "brand" : clinic.plan === "PRO" ? "info" : "neutral"}>
                        {clinic.plan}
                      </BadgeNew>
                    </td>
                    <td style={{ color: "var(--text-3)", fontSize: 11 }}>{clinic.email || "—"}</td>
                    <td className="mono" style={{ color: "var(--danger)", fontSize: 11, fontWeight: 500 }}>
                      {clinic.trialEndsAt ? fmtDate(clinic.trialEndsAt) : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {activateClinicId === clinic.id ? (
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: 8,
                            background: "var(--bg-elev)",
                            border: "1px solid var(--border-soft)",
                            borderRadius: 8,
                          }}
                        >
                          <select
                            className="input-new"
                            style={{ fontSize: 11, padding: "4px 6px", height: "auto", width: "auto" }}
                            value={activatePlan}
                            onChange={e => setActivatePlan(e.target.value)}
                          >
                            <option value="BASIC">BASIC</option>
                            <option value="PRO">PRO</option>
                            <option value="CLINIC">CLINIC</option>
                          </select>
                          <select
                            className="input-new"
                            style={{ fontSize: 11, padding: "4px 6px", height: "auto", width: "auto" }}
                            value={activateMonths}
                            onChange={e => setActivateMonths(Number(e.target.value))}
                          >
                            <option value={1}>1 mes</option>
                            <option value={3}>3 meses</option>
                            <option value={6}>6 meses</option>
                            <option value={12}>12 meses</option>
                          </select>
                          <ButtonNew
                            size="sm"
                            variant="primary"
                            onClick={() => activateClinic(clinic.id)}
                            disabled={loading === clinic.id}
                          >
                            {loading === clinic.id ? "…" : "Activar"}
                          </ButtonNew>
                          <ButtonNew
                            size="sm"
                            variant="ghost"
                            onClick={() => setActivateClinicId(null)}
                          >
                            <X size={12} />
                          </ButtonNew>
                        </div>
                      ) : (
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          <ButtonNew
                            size="sm"
                            variant="primary"
                            onClick={() => { setActivateClinicId(clinic.id); setActivatePlan(clinic.plan || "PRO"); }}
                          >
                            Activar manualmente
                          </ButtonNew>
                          <ButtonNew
                            size="sm"
                            variant="secondary"
                            onClick={() => toast.success("Función de recordatorio en desarrollo")}
                          >
                            Enviar recordatorio
                          </ButtonNew>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardNew>
      )}
    </div>
  );
}
