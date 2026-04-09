"use client";
import { useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import toast from "react-hot-toast";

const PLAN_PRICES: Record<string, number> = { BASIC: 299, PRO: 499, CLINIC: 799 };

const PAYMENT_METHODS = [
  { value:"transfer",    label:"💳 Transferencia BBVA",   info:"CLABE: 012 345 678 901 234 567 | Rafael Papanaklis" },
  { value:"deposit",     label:"🏦 Depósito BBVA",        info:"Cuenta: 4152 3137 1234 5678 | Rafael Papanaklis" },
  { value:"paypal",      label:"🅿️ PayPal",               info:"rafaelpapanaklis@gmail.com" },
  { value:"stripe",      label:"💳 Stripe (tarjeta)",     info:"Pago con tarjeta de crédito/débito" },
  { value:"mercadopago", label:"🟡 Mercado Pago",         info:"Link de pago por Mercado Pago" },
  { value:"cash",        label:"💵 Efectivo",             info:"Pago en efectivo" },
];

interface Props { clinics: any[]; invoices: any[] }

export function AdminPaymentsClient({ clinics: initClinics, invoices: initInvoices }: Props) {
  const [invoices, setInvoices]   = useState(initInvoices);
  const [showForm, setShowForm]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [filter, setFilter]       = useState("all");

  const [form, setForm] = useState({
    clinicId:    "",
    amount:      "",
    method:      "transfer",
    reference:   "",
    periodStart: "",
    periodEnd:   "",
    notes:       "",
    status:      "paid",
  });

  function setF(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  // Auto-fill amount from clinic plan
  function onClinicChange(clinicId: string) {
    const clinic = initClinics.find(c => c.id === clinicId);
    const price  = clinic?.monthlyPrice || PLAN_PRICES[clinic?.plan] || 0;
    const now    = new Date();
    const start  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
    const end    = new Date(now.getFullYear(), now.getMonth()+1, 0);
    const endStr = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,"0")}-${String(end.getDate()).padStart(2,"0")}`;
    setForm(f => ({ ...f, clinicId, amount: String(price), periodStart: start, periodEnd: endStr }));
  }

  async function save() {
    if (!form.clinicId || !form.amount || !form.periodStart || !form.periodEnd) {
      toast.error("Completa todos los campos obligatorios"); return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const inv = await res.json();
      setInvoices(prev => [inv, ...prev]);
      setShowForm(false);
      setForm({ clinicId:"", amount:"", method:"transfer", reference:"", periodStart:"", periodEnd:"", notes:"", status:"paid" });
      toast.success("✅ Pago registrado");
    } catch(e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  const filtered = invoices.filter(i => filter === "all" || i.status === filter);
  const totalPaid    = invoices.filter(i=>i.status==="paid").reduce((s,i)=>s+i.amount,0);
  const totalPending = invoices.filter(i=>i.status==="pending").reduce((s,i)=>s+i.amount,0);

  const selectedMethod = PAYMENT_METHODS.find(m => m.value === form.method);

  return (
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold">Pagos de suscripción</h1>
            <p className="text-slate-400 text-sm">Registra y gestiona los pagos de las clínicas</p>
          </div>
          <button onClick={() => setShowForm(!showForm)}
            className="bg-brand-600 hover:bg-brand-700 text-white font-bold px-4 py-2 rounded-xl text-sm">
            + Registrar pago
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4">
            <div className="text-xs text-slate-400 mb-1">Total cobrado</div>
            <div className="text-2xl font-extrabold text-emerald-400">{formatCurrency(totalPaid)}</div>
          </div>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4">
            <div className="text-xs text-slate-400 mb-1">Pendiente</div>
            <div className="text-2xl font-extrabold text-amber-400">{formatCurrency(totalPending)}</div>
          </div>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4">
            <div className="text-xs text-slate-400 mb-1">Total registros</div>
            <div className="text-2xl font-extrabold text-white">{invoices.length}</div>
          </div>
        </div>

        {/* Payment methods info */}
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4">
          <div className="font-bold text-sm mb-3">📋 Datos de pago para clínicas</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {PAYMENT_METHODS.map(m => (
              <div key={m.value} className="flex items-start gap-2 p-2 rounded-lg bg-slate-800">
                <span className="text-sm shrink-0">{m.label}</span>
                <span className="text-xs text-slate-400">{m.info}</span>
              </div>
            ))}
          </div>
        </div>

        {/* New payment form */}
        {showForm && (
          <div className="bg-slate-900 border border-brand-700 rounded-2xl p-5 space-y-4">
            <div className="font-bold">Registrar nuevo pago</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Clínica *</label>
                <select value={form.clinicId} onChange={e => onClinicChange(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="">Selecciona clínica</option>
                  {initClinics.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.plan})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Monto (MXN) *</label>
                <input type="number" value={form.amount} onChange={e => setF("amount", e.target.value)}
                  placeholder="499" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Método de pago *</label>
                <select value={form.method} onChange={e => setF("method", e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                  {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                {selectedMethod && <p className="text-xs text-slate-500 mt-1">{selectedMethod.info}</p>}
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Referencia / Folio</label>
                <input value={form.reference} onChange={e => setF("reference", e.target.value)}
                  placeholder="Número de transferencia, orden MP, etc."
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Periodo inicio *</label>
                <input type="date" value={form.periodStart} onChange={e => setF("periodStart", e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Periodo fin *</label>
                <input type="date" value={form.periodEnd} onChange={e => setF("periodEnd", e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Estado</label>
                <select value={form.status} onChange={e => setF("status", e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                  <option value="paid">✅ Pagado</option>
                  <option value="pending">⏳ Pendiente</option>
                  <option value="failed">❌ Fallido</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Notas</label>
                <input value={form.notes} onChange={e => setF("notes", e.target.value)}
                  placeholder="Observaciones opcionales"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowForm(false)}
                className="flex-1 border border-slate-700 rounded-xl py-2 text-sm font-semibold hover:bg-slate-800">
                Cancelar
              </button>
              <button onClick={save} disabled={saving}
                className="flex-1 bg-brand-600 hover:bg-brand-700 text-white rounded-xl py-2 text-sm font-bold disabled:opacity-50">
                {saving ? "Guardando..." : "✅ Guardar pago"}
              </button>
            </div>
          </div>
        )}

        {/* Filter */}
        <div className="flex gap-2">
          {[{v:"all",l:"Todos"},{v:"paid",l:"Pagados"},{v:"pending",l:"Pendientes"},{v:"failed",l:"Fallidos"}].map(f=>(
            <button key={f.v} onClick={() => setFilter(f.v)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${filter===f.v?"bg-brand-600 border-brand-600 text-white":"border-slate-700 text-slate-400 hover:text-white"}`}>
              {f.l}
            </button>
          ))}
        </div>

        {/* Invoices table */}
        <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-slate-400 border-b border-slate-700">
              <th className="px-5 py-3 text-left">Clínica</th>
              <th className="px-5 py-3 text-left">Monto</th>
              <th className="px-5 py-3 text-left">Método</th>
              <th className="px-5 py-3 text-left">Periodo</th>
              <th className="px-5 py-3 text-left">Estado</th>
              <th className="px-5 py-3 text-left">Fecha</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-slate-500">Sin registros</td></tr>
              ) : filtered.map((inv: any) => (
                <tr key={inv.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                  <td className="px-5 py-3 font-semibold">{inv.clinic.name}</td>
                  <td className="px-5 py-3 text-emerald-400 font-bold">{formatCurrency(inv.amount)}</td>
                  <td className="px-5 py-3 text-slate-400 capitalize">
                    {PAYMENT_METHODS.find(m=>m.value===inv.method)?.label ?? inv.method ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-slate-400 text-xs">
                    {new Date(inv.periodStart).toLocaleDateString("es-MX",{month:"short",day:"numeric"})} — {new Date(inv.periodEnd).toLocaleDateString("es-MX",{month:"short",day:"numeric",year:"numeric"})}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${inv.status==="paid"?"bg-emerald-900/50 text-emerald-400":inv.status==="failed"?"bg-red-900/50 text-red-400":"bg-amber-900/50 text-amber-400"}`}>
                      {inv.status==="paid"?"Pagado":inv.status==="failed"?"Fallido":"Pendiente"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-400 text-xs">{new Date(inv.createdAt).toLocaleDateString("es-MX")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
  );
}
