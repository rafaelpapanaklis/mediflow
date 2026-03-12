"use client";

import { useState } from "react";
import { Plus, CreditCard, TrendingUp, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import toast from "react-hot-toast";

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Pendiente", cls: "text-amber-700 bg-amber-50 border-amber-200"     },
  PARTIAL: { label: "Parcial",   cls: "text-blue-700 bg-blue-50 border-blue-200"        },
  PAID:    { label: "Pagado",    cls: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  OVERDUE: { label: "Vencido",   cls: "text-rose-700 bg-rose-50 border-rose-200"         },
  DRAFT:   { label: "Borrador",  cls: "text-slate-600 bg-slate-50 border-slate-200"      },
};

interface Props {
  invoices:     any[];
  patients:     { id: string; firstName: string; lastName: string; patientNumber: string }[];
  totalPaid:    number;
  totalPending: number;
}

export function BillingClient({ invoices: initial, patients, totalPaid, totalPending }: Props) {
  const [invoices, setInvoices] = useState(initial);
  const [showNew, setShowNew]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [paying, setPaying]     = useState<string | null>(null);
  const [payAmount, setPayAmount]= useState("");
  const [payMethod, setPayMethod]= useState("CASH");

  const [form, setForm] = useState({
    patientId: "", description: "", quantity: "1", unitPrice: "", notes: "",
  });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function createInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!form.patientId || !form.description || !form.unitPrice) {
      toast.error("Completa los campos requeridos"); return;
    }
    setLoading(true);
    try {
      const qty   = Number(form.quantity) || 1;
      const price = Number(form.unitPrice) || 0;
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: form.patientId, notes: form.notes,
          items: [{ description: form.description, quantity: qty, unitPrice: price, total: qty * price }],
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const inv = await res.json();
      setInvoices(prev => [inv, ...prev]);
      toast.success(`Factura ${inv.invoiceNumber} creada`);
      setShowNew(false);
      setForm({ patientId:"", description:"", quantity:"1", unitPrice:"", notes:"" });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function registerPayment(invoiceId: string) {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { toast.error("Monto inválido"); return; }
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, method: payMethod }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Pago registrado");
      setPaying(null);
      setPayAmount("");
      // refresh
      const updated = await fetch("/api/invoices").then(r => r.json());
      if (updated.invoices) setInvoices(updated.invoices);
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-extrabold">Facturación</h1>
          <p className="text-sm text-muted-foreground">{invoices.length} facturas</p>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4" />
          Nueva factura
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { icon: <TrendingUp className="w-4 h-4 text-emerald-600" />, label: "Total cobrado",  val: formatCurrency(totalPaid),    bg: "bg-emerald-50" },
          { icon: <Clock className="w-4 h-4 text-amber-600" />,       label: "Por cobrar",     val: formatCurrency(totalPending), bg: "bg-amber-50"   },
          { icon: <CreditCard className="w-4 h-4 text-brand-600" />,  label: "Total facturas", val: String(invoices.length),     bg: "bg-brand-50"   },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-border bg-white p-4 shadow-card">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 ${k.bg}`}>{k.icon}</div>
            <div className="text-xl font-extrabold">{k.val}</div>
            <div className="text-xs text-muted-foreground">{k.label}</div>
          </div>
        ))}
      </div>

      {/* New invoice */}
      {showNew && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-5 mb-5 animate-fade-up">
          <h2 className="text-sm font-bold mb-4 text-brand-700">💰 Nueva factura</h2>
          <form onSubmit={createInvoice} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Paciente *</label>
              <select className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
                value={form.patientId} onChange={e => set("patientId", e.target.value)}>
                <option value="">Seleccionar…</option>
                {patients.map(p => <option key={p.id} value={p.id}>#{p.patientNumber} — {p.firstName} {p.lastName}</option>)}
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Descripción *</label>
              <input className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none" placeholder="Consulta dental…"
                value={form.description} onChange={e => set("description", e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Cantidad</label>
              <input type="number" min="1" className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none"
                value={form.quantity} onChange={e => set("quantity", e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Precio unitario *</label>
              <input type="number" min="0" className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none" placeholder="500"
                value={form.unitPrice} onChange={e => set("unitPrice", e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Total</label>
              <div className="h-10 flex items-center px-3 rounded-lg bg-muted border border-border text-sm font-bold">
                {formatCurrency((Number(form.quantity)||1) * (Number(form.unitPrice)||0))}
              </div>
            </div>
            <div className="col-span-2 lg:col-span-4 flex gap-2">
              <Button type="submit" disabled={loading} size="sm">{loading ? "Guardando…" : "Crear factura"}</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowNew(false)}>Cancelar</Button>
            </div>
          </form>
        </div>
      )}

      {/* Invoice table */}
      <div className="rounded-xl border border-border bg-white shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Factura","Paciente","Monto","Pagado","Saldo","Estado",""].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide first:pl-5 last:pr-5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-16 text-center text-muted-foreground text-sm">No hay facturas aún.</td></tr>
            ) : invoices.map(inv => {
              const s = STATUS_CONFIG[inv.status] ?? STATUS_CONFIG.PENDING;
              return (
                <>
                  <tr key={inv.id} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs font-bold">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 font-medium">{inv.patient.firstName} {inv.patient.lastName}</td>
                    <td className="px-4 py-3 font-mono font-bold">{formatCurrency(inv.total)}</td>
                    <td className="px-4 py-3 text-emerald-600 font-mono">{formatCurrency(inv.paid)}</td>
                    <td className="px-4 py-3 font-mono font-bold text-rose-600">{formatCurrency(inv.balance)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>
                    </td>
                    <td className="px-5 py-3">
                      {inv.status !== "PAID" && inv.status !== "CANCELLED" && (
                        <button onClick={() => setPaying(paying === inv.id ? null : inv.id)}
                          className="text-xs font-semibold text-brand-600 hover:underline">Registrar pago</button>
                      )}
                    </td>
                  </tr>
                  {paying === inv.id && (
                    <tr key={`pay-${inv.id}`} className="bg-brand-50">
                      <td colSpan={7} className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-brand-700">Saldo: {formatCurrency(inv.balance)}</span>
                          <input type="number" placeholder="Monto" className="h-8 w-28 rounded-lg border border-border bg-white px-3 text-sm"
                            value={payAmount} onChange={e => setPayAmount(e.target.value)} />
                          <select className="h-8 rounded-lg border border-border bg-white px-2 text-sm"
                            value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                            <option value="CASH">Efectivo</option>
                            <option value="CARD">Tarjeta</option>
                            <option value="TRANSFER">Transferencia</option>
                          </select>
                          <Button size="sm" onClick={() => registerPayment(inv.id)}>Registrar</Button>
                          <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setPaying(null)}>Cancelar</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
