"use client";
import { useState } from "react";
import { Plus, CreditCard, TrendingUp, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  PENDING:   { label: "Pendiente", cls: "text-amber-700 bg-amber-50 border-amber-200"       },
  PARTIAL:   { label: "Parcial",   cls: "text-blue-700 bg-blue-50 border-blue-200"          },
  PAID:      { label: "Pagado",    cls: "text-emerald-700 bg-emerald-50 border-emerald-200"  },
  OVERDUE:   { label: "Vencido",   cls: "text-rose-700 bg-rose-50 border-rose-200"           },
  DRAFT:     { label: "Borrador",  cls: "text-slate-600 bg-slate-50 border-slate-200"        },
  CANCELLED: { label: "Cancelado", cls: "text-slate-500 bg-slate-50 border-slate-200"        },
};

interface Props {
  invoices: any[]; patients: any[];
  totalPaid: number; totalPending: number;
  clinic: { facturApiEnabled: boolean; rfcEmisor: string | null };
}

export function BillingClient({ invoices: initial, patients, totalPaid, totalPending, clinic }: Props) {
  const router = useRouter();
  const [invoices, setInvoices] = useState(initial);
  const [showNew, setShowNew]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [paying, setPaying]     = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("CASH");
  const [form, setForm] = useState({ patientId: "", description: "", quantity: "1", unitPrice: "", notes: "" });
  // CFDI state
  const [cfdiInv,    setCfdiInv]    = useState<string | null>(null); // invoiceId being timbrado
  const [cfdiLoading,setCfdiLoading]= useState(false);
  const [cfdiForm,   setCfdiForm]   = useState({
    rfc: "", nombre: "", regimenFiscal: "616", cp: "", usoCfdi: "D01", formaPago: "01",
  });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function createInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!form.patientId || !form.description || !form.unitPrice) { toast.error("Completa los campos requeridos"); return; }
    setLoading(true);
    try {
      const qty = Number(form.quantity) || 1; const price = Number(form.unitPrice) || 0;
      const res = await fetch("/api/invoices", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: form.patientId, notes: form.notes, items: [{ description: form.description, quantity: qty, unitPrice: price, total: qty * price }] }) });
      if (!res.ok) throw new Error((await res.json()).error);
      const inv = await res.json();
      setInvoices(prev => [inv, ...prev]);
      toast.success(`Factura ${inv.invoiceNumber} creada`);
      setShowNew(false);
      setForm({ patientId: "", description: "", quantity: "1", unitPrice: "", notes: "" });
    } catch (err: any) { toast.error(err.message ?? "Error"); } finally { setLoading(false); }
  }

  async function registerPayment(invoiceId: string) {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { toast.error("Monto inválido"); return; }
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount, method: payMethod }) });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Pago registrado");
      setPaying(null); setPayAmount("");
      router.refresh();
    } catch (err: any) { toast.error(err.message ?? "Error"); }
  }

  async function timbraCfdi(invoiceId: string) {
    if (!cfdiForm.rfc.trim() || !cfdiForm.nombre.trim() || !cfdiForm.cp.trim()) {
      toast.error("RFC, nombre y código postal del paciente son requeridos");
      return;
    }
    setCfdiLoading(true);
    try {
      const res = await fetch("/api/cfdi", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          receptor: {
            rfc:           cfdiForm.rfc.trim().toUpperCase(),
            nombre:        cfdiForm.nombre.trim().toUpperCase(),
            regimenFiscal: cfdiForm.regimenFiscal,
            cp:            cfdiForm.cp.trim(),
          },
          usoCfdi:     cfdiForm.usoCfdi,
          paymentForm: cfdiForm.formaPago,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInvoices(prev => prev.map(inv =>
        inv.id === invoiceId ? { ...inv, cfdiUuid: data.uuid } : inv
      ));
      setCfdiInv(null);
      toast.success("✅ CFDI timbrado correctamente ante el SAT");
      // Open PDF in new tab if available
      if (data.pdfUrl) window.open(data.pdfUrl, "_blank");
    } catch (err: any) {
      toast.error(err.message ?? "Error al timbrar");
    } finally {
      setCfdiLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-extrabold">Facturación</h1>
          <p className="text-sm text-muted-foreground">{invoices.length} facturas</p>
        </div>
        <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />Nueva factura</Button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { icon: <TrendingUp className="w-4 h-4 text-emerald-600" />, label: "Total cobrado",  val: formatCurrency(totalPaid),    bg: "bg-emerald-50" },
          { icon: <Clock className="w-4 h-4 text-amber-600" />,       label: "Por cobrar",     val: formatCurrency(totalPending), bg: "bg-amber-50"   },
          { icon: <CreditCard className="w-4 h-4 text-brand-600" />,  label: "Total facturas", val: String(invoices.length),      bg: "bg-brand-50"   },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-border bg-white p-4 shadow-card">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 ${k.bg}`}>{k.icon}</div>
            <div className="text-xl font-extrabold">{k.val}</div>
            <div className="text-xs text-muted-foreground">{k.label}</div>
          </div>
        ))}
      </div>

      {showNew && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-5 mb-5 animate-fade-up">
          <h2 className="text-sm font-bold mb-4 text-brand-700">💰 Nueva factura</h2>
          <form onSubmit={createInvoice} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Paciente *</label>
              <select className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none" value={form.patientId} onChange={e => set("patientId", e.target.value)}>
                <option value="">Seleccionar…</option>
                {patients.map(p => <option key={p.id} value={p.id}>#{p.patientNumber} — {p.firstName} {p.lastName}</option>)}
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Descripción *</label>
              <input className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none" placeholder="Consulta dental…" value={form.description} onChange={e => set("description", e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Cantidad</label>
              <input type="number" min="1" className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none" value={form.quantity} onChange={e => set("quantity", e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Precio unitario *</label>
              <input type="number" min="0" className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none" placeholder="500" value={form.unitPrice} onChange={e => set("unitPrice", e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Total</label>
              <div className="h-10 flex items-center px-3 rounded-lg bg-muted border border-border text-sm font-bold">
                {formatCurrency((Number(form.quantity)||1) * (Number(form.unitPrice)||0))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-muted-foreground">Notas</label>
              <input className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none" placeholder="Opcional" value={form.notes} onChange={e => set("notes", e.target.value)} />
            </div>
            <div className="col-span-2 lg:col-span-4 flex gap-2">
              <Button type="submit" disabled={loading} size="sm">{loading ? "Guardando…" : "Crear factura"}</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowNew(false)}>Cancelar</Button>
            </div>
          </form>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl">
      <div className="rounded-xl border border-border bg-white shadow-card overflow-hidden min-w-[640px]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Factura","Paciente","Monto","Pagado","Saldo","Estado","CFDI",""].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide first:pl-5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-16 text-center text-muted-foreground text-sm">
                No hay facturas. <button onClick={() => setShowNew(true)} className="text-brand-600 hover:underline">Crear primera →</button>
              </td></tr>
            ) : invoices.map(inv => {
              const s = STATUS_CONFIG[inv.status] ?? STATUS_CONFIG.PENDING;
              return (
                <>
                  <tr key={inv.id} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs font-bold">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 font-medium">{inv.patient?.firstName} {inv.patient?.lastName}</td>
                    <td className="px-4 py-3 font-mono font-bold">{formatCurrency(inv.total)}</td>
                    <td className="px-4 py-3 text-emerald-600 font-mono">{formatCurrency(inv.paid)}</td>
                    <td className="px-4 py-3 font-mono font-bold text-rose-600">{formatCurrency(inv.balance)}</td>
                    <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span></td>
                    <td className="px-4 py-3">
                      {inv.cfdiUuid ? (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          ✅ Timbrado
                        </span>
                      ) : clinic.facturApiEnabled ? (
                        <button
                          onClick={() => { setCfdiInv(cfdiInv === inv.id ? null : inv.id); }}
                          className="text-xs font-semibold text-violet-600 hover:underline">
                          🏛 Timbrar CFDI
                        </button>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">SAT no configurado</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!["PAID","CANCELLED"].includes(inv.status) && (
                        <button onClick={() => setPaying(paying === inv.id ? null : inv.id)} className="text-xs font-semibold text-brand-600 hover:underline">Registrar pago</button>
                      )}
                    </td>
                  </tr>
                  {paying === inv.id && (
                    <tr key={`pay-${inv.id}`} className="bg-brand-50">
                      <td colSpan={8} className="px-5 py-3">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-xs font-bold text-brand-700">Saldo: {formatCurrency(inv.balance)}</span>
                          <input type="number" placeholder="Monto" className="h-8 w-28 rounded-lg border border-border bg-white px-3 text-sm" value={payAmount} onChange={e => setPayAmount(e.target.value)} />
                          <select className="h-8 rounded-lg border border-border bg-white px-2 text-sm" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                            <option value="CASH">Efectivo</option><option value="CARD">Tarjeta</option><option value="TRANSFER">Transferencia</option>
                          </select>
                          <Button size="sm" onClick={() => registerPayment(inv.id)}>Registrar</Button>
                          <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setPaying(null)}>Cancelar</button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {cfdiInv === inv.id && !inv.cfdiUuid && (
                    <tr key={`cfdi-${inv.id}`} className="bg-violet-50 dark:bg-violet-950/20">
                      <td colSpan={8} className="px-5 py-4">
                        <div className="space-y-3">
                          <div className="text-xs font-bold text-violet-700 dark:text-violet-300 mb-2">
                            🏛 Datos del receptor para CFDI — Factura {inv.invoiceNumber} · {formatCurrency(inv.total)}
                          </div>
                          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <div className="space-y-1">
                              <label className="text-xs font-bold text-muted-foreground">RFC receptor *</label>
                              <input className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none uppercase"
                                placeholder="XAXX010101000"
                                value={cfdiForm.rfc}
                                onChange={e => setCfdiForm(f => ({ ...f, rfc: e.target.value.toUpperCase() }))} />
                            </div>
                            <div className="space-y-1 lg:col-span-2">
                              <label className="text-xs font-bold text-muted-foreground">Nombre / Razón social *</label>
                              <input className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none uppercase"
                                placeholder="JUAN PÉREZ GARCÍA"
                                value={cfdiForm.nombre}
                                onChange={e => setCfdiForm(f => ({ ...f, nombre: e.target.value }))} />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-bold text-muted-foreground">C.P. receptor *</label>
                              <input className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none"
                                placeholder="97000" maxLength={5}
                                value={cfdiForm.cp}
                                onChange={e => setCfdiForm(f => ({ ...f, cp: e.target.value }))} />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-bold text-muted-foreground">Régimen fiscal</label>
                              <select className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-2 text-sm focus:outline-none"
                                value={cfdiForm.regimenFiscal}
                                onChange={e => setCfdiForm(f => ({ ...f, regimenFiscal: e.target.value }))}>
                                <option value="616">616 — Sin obligaciones fiscales</option>
                                <option value="605">605 — Sueldos y salarios</option>
                                <option value="612">612 — Personas físicas con actividad</option>
                                <option value="626">626 — Régimen simplificado de confianza</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-bold text-muted-foreground">Uso CFDI</label>
                              <select className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-2 text-sm focus:outline-none"
                                value={cfdiForm.usoCfdi}
                                onChange={e => setCfdiForm(f => ({ ...f, usoCfdi: e.target.value }))}>
                                <option value="D01">D01 — Honorarios médicos</option>
                                <option value="D07">D07 — Primas seguros</option>
                                <option value="G03">G03 — Gastos en general</option>
                                <option value="S01">S01 — Sin efectos fiscales</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-bold text-muted-foreground">Forma de pago</label>
                              <select className="flex h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800 px-2 text-sm focus:outline-none"
                                value={cfdiForm.formaPago}
                                onChange={e => setCfdiForm(f => ({ ...f, formaPago: e.target.value }))}>
                                <option value="01">01 — Efectivo</option>
                                <option value="02">02 — Cheque</option>
                                <option value="03">03 — Transferencia</option>
                                <option value="04">04 — Tarjeta de crédito</option>
                                <option value="28">28 — Tarjeta de débito</option>
                              </select>
                            </div>
                          </div>
                          <div className="flex gap-2 pt-1">
                            <Button size="sm" onClick={() => timbraCfdi(inv.id)} disabled={cfdiLoading}
                              className="bg-violet-600 hover:bg-violet-700">
                              {cfdiLoading ? "Timbrando…" : "🏛 Timbrar CFDI ante SAT"}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setCfdiInv(null)}>Cancelar</Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            El CFDI se timbra vía Facturapi. El paciente podrá descargar XML y PDF.
                          </p>
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
    </div>
  );
}
