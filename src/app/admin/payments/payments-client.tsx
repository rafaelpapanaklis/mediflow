"use client";

import { useState, useMemo } from "react";
import { formatCurrency } from "@/lib/utils";
import toast from "react-hot-toast";

/* ── Constants ────────────────────────────────────────────────────────────── */

const PLAN_PRICES: Record<string, number> = { BASIC: 299, PRO: 499, CLINIC: 799 };

const PAYMENT_METHODS = [
  { value: "stripe",   label: "Stripe",        icon: "\uD83D\uDCB3" },
  { value: "transfer", label: "Transferencia",  icon: "\uD83C\uDFE6" },
  { value: "oxxo",     label: "OXXO",           icon: "\uD83C\uDFEA" },
  { value: "paypal",   label: "PayPal",         icon: "\uD83C\uDD7F\uFE0F" },
  { value: "cash",     label: "Efectivo",       icon: "\uD83D\uDCB5" },
] as const;

const STATUS_BADGES: Record<string, { bg: string; text: string; label: string }> = {
  paid:    { bg: "bg-emerald-900/50", text: "text-emerald-400", label: "Pagado" },
  pending: { bg: "bg-amber-900/50",   text: "text-amber-400",   label: "Pendiente" },
  failed:  { bg: "bg-red-900/50",     text: "text-red-400",     label: "Fallido" },
};

function methodBadge(method: string | null | undefined) {
  const m = PAYMENT_METHODS.find(pm => pm.value === method);
  return m ? `${m.icon} ${m.label}` : method ?? "\u2014";
}

function statusBadge(status: string) {
  const s = STATUS_BADGES[status] ?? STATUS_BADGES.pending;
  return (
    <span className={`text-xs font-bold px-2 py-1 rounded-full ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
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

  const inputCls = "w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500";
  const labelCls = "text-xs text-slate-500 dark:text-slate-400 block mb-1 font-medium";

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Pagos y Suscripciones</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Gestiona pagos, verifica transferencias y activa clinicas
          </p>
        </div>
        <button
          onClick={() => setShowNewPayment(!showNewPayment)}
          className="bg-brand-600 hover:bg-brand-700 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-colors shadow-md"
        >
          + Registrar pago
        </button>
      </div>

      {/* ── Stats Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
          <div className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wide mb-2">MRR Actual</div>
          <div className="text-3xl font-extrabold text-emerald-500 dark:text-emerald-400">{formatCurrency(metrics.currentMRR)}</div>
          <div className="text-xs text-slate-400 mt-1">{metrics.activeClinics} clinicas activas</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
          <div className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wide mb-2">Ingresos este mes</div>
          <div className="text-3xl font-extrabold text-blue-500 dark:text-blue-400">{formatCurrency(metrics.thisMonthRevenue)}</div>
          <div className={`text-xs font-semibold mt-1 ${metrics.revenueChange >= 0 ? "text-emerald-500" : "text-red-500"}`}>
            {metrics.revenueChange >= 0 ? "\u2191" : "\u2193"} {Math.abs(metrics.revenueChange)}% vs mes anterior
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
          <div className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wide mb-2">Pendientes de verificar</div>
          <div className="text-3xl font-extrabold text-amber-500 dark:text-amber-400">{pending.length}</div>
          <div className="text-xs text-slate-400 mt-1">
            {formatCurrency(pending.reduce((s: number, p: any) => s + (p.amount || 0), 0))} en espera
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
          <div className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wide mb-2">Clinicas vencidas</div>
          <div className="text-3xl font-extrabold text-red-500 dark:text-red-400">{metrics.expiredClinics}</div>
          <div className="text-xs text-slate-400 mt-1">{overdue.length} requieren accion</div>
        </div>
      </div>

      {/* ── New Payment Form ────────────────────────────────────────────── */}
      {showNewPayment && (
        <div className="bg-white dark:bg-slate-900 border-2 border-brand-500/30 rounded-2xl p-6 space-y-5 shadow-lg">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg text-slate-900 dark:text-white">Registrar nuevo pago</h2>
            <button onClick={() => setShowNewPayment(false)} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Clinica *</label>
              <select value={form.clinicId} onChange={e => onClinicChange(e.target.value)} className={inputCls}>
                <option value="">Selecciona clinica</option>
                {clinics.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.plan})</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Monto (MXN) *</label>
              <input type="number" value={form.amount} onChange={e => setF("amount", e.target.value)} placeholder="499" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Metodo de pago *</label>
              <select value={form.method} onChange={e => setF("method", e.target.value)} className={inputCls}>
                {PAYMENT_METHODS.map(m => (
                  <option key={m.value} value={m.value}>{m.icon} {m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Referencia / Folio</label>
              <input value={form.reference} onChange={e => setF("reference", e.target.value)} placeholder="Numero de transferencia, orden, etc." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Periodo inicio *</label>
              <input type="date" value={form.periodStart} onChange={e => setF("periodStart", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Periodo fin *</label>
              <input type="date" value={form.periodEnd} onChange={e => setF("periodEnd", e.target.value)} className={inputCls} />
            </div>

            {/* Stripe section */}
            {form.method === "stripe" && (
              <div className="md:col-span-2 lg:col-span-3">
                <button
                  onClick={generateStripeLink}
                  disabled={loading === "stripe"}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-5 py-2.5 rounded-xl text-sm disabled:opacity-50 transition-colors"
                >
                  {loading === "stripe" ? "Generando..." : "\uD83D\uDCB3 Generar link de pago Stripe"}
                </button>
                <p className="text-xs text-slate-400 mt-1">Se creara una suscripcion en Stripe y se copiara el link de pago</p>
              </div>
            )}

            {/* PayPal section */}
            {form.method === "paypal" && (
              <>
                <div>
                  <label className={labelCls}>Email PayPal</label>
                  <input value={form.paypalEmail} onChange={e => setF("paypalEmail", e.target.value)} placeholder="correo@paypal.com" className={inputCls} />
                </div>
                <div className="flex items-center gap-3 pt-5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.paypalRecurring}
                      onChange={e => setF("paypalRecurring", e.target.checked)}
                      className="rounded border-slate-300 dark:border-slate-600"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">Suscripcion recurrente</span>
                  </label>
                  {!form.paypalRecurring && (
                    <span className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full font-medium">Pago unico</span>
                  )}
                </div>
              </>
            )}

            <div className="md:col-span-2 lg:col-span-3">
              <label className={labelCls}>Notas</label>
              <input value={form.notes} onChange={e => setF("notes", e.target.value)} placeholder="Observaciones opcionales" className={inputCls} />
            </div>

            {/* Coupon */}
            <div className="md:col-span-2 lg:col-span-3 bg-slate-50 dark:bg-slate-800/50 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-3 space-y-2">
              <label className={labelCls}>Cupón de descuento (opcional)</label>
              {couponApplied ? (
                <div className="flex items-center gap-3">
                  <div className="flex-1 text-sm">
                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{couponApplied.code}</span>
                    <span className="text-slate-500 dark:text-slate-400 ml-2">−${couponApplied.discount.toFixed(2)} MXN</span>
                    <span className="text-slate-500 dark:text-slate-400 ml-2">
                      → total: <span className="font-bold">${couponApplied.finalAmount.toFixed(2)}</span>
                    </span>
                  </div>
                  <button
                    onClick={removeCoupon}
                    className="text-xs font-bold text-rose-600 hover:text-rose-700 underline"
                  >
                    Quitar
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={couponCode}
                    onChange={e => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="Ej: LANZAMIENTO20"
                    className={`${inputCls} font-mono uppercase`}
                  />
                  <button
                    onClick={applyCoupon}
                    disabled={validatingCoupon || !couponCode.trim()}
                    className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold px-4 rounded-lg disabled:opacity-50 whitespace-nowrap"
                  >
                    {validatingCoupon ? "…" : "Aplicar"}
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setShowNewPayment(false)} className="flex-1 border border-slate-200 dark:border-slate-700 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors">
              Cancelar
            </button>
            <button onClick={createPayment} disabled={loading === "new"} className="flex-1 bg-brand-600 hover:bg-brand-700 text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-50 transition-colors">
              {loading === "new" ? "Guardando..." : "Guardar pago"}
            </button>
          </div>
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {([
          { key: "pending", label: "Pendientes de verificar", count: pending.length },
          { key: "all",     label: "Todos los pagos",         count: payments.length },
          { key: "overdue", label: "Clinicas vencidas",       count: overdue.length },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
              tab === t.key
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full font-bold ${
                tab === t.key ? "bg-brand-100 dark:bg-brand-900/50 text-brand-600 dark:text-brand-400" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab: Pending Transfers ──────────────────────────────────────── */}
      {tab === "pending" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
          {pending.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-4xl mb-3">&#9989;</div>
              <div className="text-slate-500 dark:text-slate-400 font-medium">No hay pagos pendientes de verificar</div>
              <div className="text-xs text-slate-400 mt-1">Todos los pagos estan al dia</div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                  <th className="px-5 py-3 text-left font-semibold">Clinica</th>
                  <th className="px-5 py-3 text-left font-semibold">Plan</th>
                  <th className="px-5 py-3 text-left font-semibold">Monto</th>
                  <th className="px-5 py-3 text-left font-semibold">Metodo</th>
                  <th className="px-5 py-3 text-left font-semibold">Referencia</th>
                  <th className="px-5 py-3 text-left font-semibold">Fecha</th>
                  <th className="px-5 py-3 text-right font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((inv: any) => (
                  <tr key={inv.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="font-semibold text-slate-900 dark:text-white">{inv.clinic?.name ?? "—"}</div>
                      <div className="text-xs text-slate-400">{inv.clinic?.email}</div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                        {inv.clinic?.plan ?? "—"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-emerald-600 dark:text-emerald-400 font-bold">{formatCurrency(inv.amount)}</td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-400">{methodBadge(inv.method)}</td>
                    <td className="px-5 py-3 text-slate-500 dark:text-slate-400 text-xs font-mono">{inv.reference || "—"}</td>
                    <td className="px-5 py-3 text-slate-500 dark:text-slate-400 text-xs">{fmtDate(inv.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => verifyPayment(inv.id)}
                          disabled={loading === inv.id}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                        >
                          {loading === inv.id ? "..." : "\u2705 Verificar"}
                        </button>
                        <button
                          onClick={() => setRejectId(inv.id)}
                          disabled={loading === inv.id}
                          className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                        >
                          \u274C Rechazar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Reject modal */}
          {rejectId && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-xl space-y-4">
                <h3 className="font-bold text-lg text-slate-900 dark:text-white">Rechazar pago</h3>
                <div>
                  <label className={labelCls}>Razon del rechazo</label>
                  <textarea
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    rows={3}
                    placeholder="Referencia no encontrada, monto incorrecto, etc."
                    className={inputCls}
                  />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => { setRejectId(null); setRejectReason(""); }} className="flex-1 border border-slate-200 dark:border-slate-700 rounded-xl py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                    Cancelar
                  </button>
                  <button
                    onClick={() => rejectPayment(rejectId, rejectReason)}
                    disabled={!rejectReason.trim() || loading === rejectId}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl py-2 text-sm font-bold disabled:opacity-50"
                  >
                    {loading === rejectId ? "Rechazando..." : "Confirmar rechazo"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: All Payments ───────────────────────────────────────────── */}
      {tab === "all" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Estado:</span>
              <div className="flex gap-1">
                {[
                  { v: "all", l: "Todos" },
                  { v: "paid", l: "Pagados" },
                  { v: "pending", l: "Pendientes" },
                  { v: "failed", l: "Fallidos" },
                ].map(f => (
                  <button
                    key={f.v}
                    onClick={() => setFilterStatus(f.v)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                      filterStatus === f.v
                        ? "bg-brand-600 border-brand-600 text-white"
                        : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white"
                    }`}
                  >
                    {f.l}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Metodo:</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setFilterMethod("all")}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                    filterMethod === "all"
                      ? "bg-brand-600 border-brand-600 text-white"
                      : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white"
                  }`}
                >
                  Todos
                </button>
                {PAYMENT_METHODS.map(m => (
                  <button
                    key={m.value}
                    onClick={() => setFilterMethod(m.value)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                      filterMethod === m.value
                        ? "bg-brand-600 border-brand-600 text-white"
                        : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white"
                    }`}
                  >
                    {m.icon} {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
            {filteredPayments.length === 0 ? (
              <div className="py-16 text-center text-slate-500 dark:text-slate-400">Sin registros con esos filtros</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                    <th className="px-5 py-3 text-left font-semibold">Clinica</th>
                    <th className="px-5 py-3 text-left font-semibold">Monto</th>
                    <th className="px-5 py-3 text-left font-semibold">Metodo</th>
                    <th className="px-5 py-3 text-left font-semibold">Estado</th>
                    <th className="px-5 py-3 text-left font-semibold">Referencia</th>
                    <th className="px-5 py-3 text-left font-semibold">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.map((inv: any) => (
                    <tr key={inv.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-5 py-3">
                        <div className="font-semibold text-slate-900 dark:text-white">{inv.clinic?.name ?? "—"}</div>
                      </td>
                      <td className="px-5 py-3 text-emerald-600 dark:text-emerald-400 font-bold">{formatCurrency(inv.amount)}</td>
                      <td className="px-5 py-3 text-slate-600 dark:text-slate-400">{methodBadge(inv.method)}</td>
                      <td className="px-5 py-3">{statusBadge(inv.status)}</td>
                      <td className="px-5 py-3 text-slate-500 dark:text-slate-400 text-xs font-mono">{inv.reference || "—"}</td>
                      <td className="px-5 py-3 text-slate-500 dark:text-slate-400 text-xs">{fmtDate(inv.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Overdue Clinics ────────────────────────────────────────── */}
      {tab === "overdue" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
          {overdue.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-4xl mb-3">&#127881;</div>
              <div className="text-slate-500 dark:text-slate-400 font-medium">No hay clinicas vencidas</div>
              <div className="text-xs text-slate-400 mt-1">Todas las clinicas tienen suscripcion activa o trial vigente</div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                  <th className="px-5 py-3 text-left font-semibold">Clinica</th>
                  <th className="px-5 py-3 text-left font-semibold">Plan</th>
                  <th className="px-5 py-3 text-left font-semibold">Email</th>
                  <th className="px-5 py-3 text-left font-semibold">Vencio</th>
                  <th className="px-5 py-3 text-right font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {overdue.map((clinic: any) => (
                  <tr key={clinic.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-5 py-3 font-semibold text-slate-900 dark:text-white">{clinic.name}</td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                        {clinic.plan}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-500 dark:text-slate-400 text-xs">{clinic.email || "—"}</td>
                    <td className="px-5 py-3 text-red-500 dark:text-red-400 text-xs font-medium">
                      {clinic.trialEndsAt ? fmtDate(clinic.trialEndsAt) : "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        {activateClinicId === clinic.id ? (
                          <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
                            <select
                              value={activatePlan}
                              onChange={e => setActivatePlan(e.target.value)}
                              className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1 text-xs font-medium text-slate-900 dark:text-white"
                            >
                              <option value="BASIC">BASIC</option>
                              <option value="PRO">PRO</option>
                              <option value="CLINIC">CLINIC</option>
                            </select>
                            <select
                              value={activateMonths}
                              onChange={e => setActivateMonths(Number(e.target.value))}
                              className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1 text-xs font-medium text-slate-900 dark:text-white"
                            >
                              <option value={1}>1 mes</option>
                              <option value={3}>3 meses</option>
                              <option value={6}>6 meses</option>
                              <option value={12}>12 meses</option>
                            </select>
                            <button
                              onClick={() => activateClinic(clinic.id)}
                              disabled={loading === clinic.id}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                            >
                              {loading === clinic.id ? "..." : "Activar"}
                            </button>
                            <button
                              onClick={() => setActivateClinicId(null)}
                              className="text-slate-400 hover:text-slate-600 text-xs"
                            >
                              &times;
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => { setActivateClinicId(clinic.id); setActivatePlan(clinic.plan || "PRO"); }}
                              className="bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                            >
                              Activar manualmente
                            </button>
                            <button
                              onClick={() => toast.success("Funcion de recordatorio en desarrollo")}
                              className="border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                            >
                              Enviar recordatorio
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
