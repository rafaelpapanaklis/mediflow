"use client";
import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, CheckCircle2, Clock, AlertCircle, FileText, Search, X,
} from "lucide-react";
import toast from "react-hot-toast";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fmtMXN, fmtMXNdec, formatRelativeDate } from "@/lib/format";
import { useConfirm } from "@/components/ui/confirm-dialog";

type Tone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";
const STATUS_BADGE: Record<string, { tone: Tone; label: string }> = {
  PENDING:   { tone: "warning", label: "Pendiente" },
  PARTIAL:   { tone: "info",    label: "Parcial"   },
  PAID:      { tone: "success", label: "Pagado"    },
  OVERDUE:   { tone: "danger",  label: "Vencido"   },
  DRAFT:     { tone: "brand",   label: "Borrador"  },
  CANCELLED: { tone: "neutral", label: "Cancelado" },
};

const STATUS_FILTERS = [
  { value: "all",      label: "Todas" },
  { value: "pending",  label: "Pendientes" },
  { value: "paid",     label: "Pagadas" },
  { value: "overdue",  label: "Vencidas" },
  { value: "draft",    label: "Borradores" },
];

interface Props {
  invoices:      any[];
  patients:      any[];
  totalPaid:     number;
  totalPending:  number;
  totalOverdue:  number;
  monthInvoices: number;
  clinic:        { facturApiEnabled: boolean; rfcEmisor: string | null };
}

export function BillingClient({ invoices: initial, patients, totalPaid, totalPending, totalOverdue, monthInvoices, clinic }: Props) {
  const askConfirm = useConfirm();
  const router = useRouter();
  const [invoices, setInvoices] = useState(initial);
  const [search, setSearch]     = useState("");
  const [status, setStatus]     = useState<string>("all");

  // Modals
  const [showNew, setShowNew]     = useState(false);
  const [payFor, setPayFor]       = useState<any | null>(null);
  const [cfdiFor, setCfdiFor]     = useState<any | null>(null);

  // New invoice form
  const [form, setForm] = useState({ patientId: "", description: "", quantity: "1", unitPrice: "", notes: "" });
  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const [loadingNew, setLoadingNew] = useState(false);

  // Payment form
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("CASH");

  // CFDI form
  const [cfdiLoading, setCfdiLoading] = useState(false);
  const [cfdiForm, setCfdiForm] = useState({
    rfc: "", nombre: "", regimenFiscal: "616", cp: "", usoCfdi: "D01", formaPago: "01",
  });
  const setCfdiF = (k: string, v: string) => setCfdiForm(f => ({ ...f, [k]: v }));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter(inv => {
      if (status !== "all") {
        const match =
          status === "pending" ? ["PENDING", "PARTIAL"].includes(inv.status) :
          status === "paid"    ? inv.status === "PAID" :
          status === "overdue" ? inv.status === "OVERDUE" :
          status === "draft"   ? inv.status === "DRAFT" : true;
        if (!match) return false;
      }
      if (!q) return true;
      const name = `${inv.patient?.firstName ?? ""} ${inv.patient?.lastName ?? ""}`.toLowerCase();
      return name.includes(q) || (inv.invoiceNumber ?? "").toLowerCase().includes(q);
    });
  }, [invoices, search, status]);

  async function createInvoice() {
    if (!form.patientId || !form.description || !form.unitPrice) {
      toast.error("Completa los campos requeridos");
      return;
    }
    setLoadingNew(true);
    try {
      const qty = Number(form.quantity) || 1;
      const price = Number(form.unitPrice) || 0;
      const total = Math.round(qty * price * 100) / 100;
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: form.patientId,
          notes: form.notes,
          items: [{ description: form.description, quantity: qty, unitPrice: price, total }],
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const inv = await res.json();
      setInvoices(prev => [inv, ...prev]);
      toast.success(`Factura ${inv.invoiceNumber} creada`);
      setShowNew(false);
      setForm({ patientId: "", description: "", quantity: "1", unitPrice: "", notes: "" });
    } catch (err: any) {
      toast.error(err.message ?? "Error al crear factura");
    } finally {
      setLoadingNew(false);
    }
  }

  async function registerPayment() {
    if (!payFor) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { toast.error("Monto inválido"); return; }
    try {
      const res = await fetch(`/api/invoices/${payFor.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, method: payMethod }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Pago registrado");
      setPayFor(null);
      setPayAmount("");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    }
  }

  async function confirmDraft(invoiceId: string) {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PENDING" }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, status: "PENDING" } : i));
      toast.success("Factura confirmada — ya puedes registrar pagos");
    } catch (err: any) {
      toast.error(err.message ?? "Error al confirmar factura");
    }
  }

  async function deleteDraft(invoiceId: string) {
    if (!(await askConfirm({
      title: "¿Eliminar factura borrador?",
      description: "El borrador se quitará permanentemente. No afecta facturas timbradas.",
      variant: "danger",
      confirmText: "Eliminar",
    }))) return;
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      setInvoices(prev => prev.filter(i => i.id !== invoiceId));
      toast.success("Factura borrador eliminada");
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    }
  }

  async function timbraCfdi() {
    if (!cfdiFor) return;
    if (!cfdiForm.rfc.trim() || !cfdiForm.nombre.trim() || !cfdiForm.cp.trim()) {
      toast.error("RFC, nombre y CP del paciente son requeridos");
      return;
    }
    setCfdiLoading(true);
    try {
      const res = await fetch("/api/cfdi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: cfdiFor.id,
          receptor: {
            rfc: cfdiForm.rfc.trim().toUpperCase(),
            nombre: cfdiForm.nombre.trim().toUpperCase(),
            regimenFiscal: cfdiForm.regimenFiscal,
            cp: cfdiForm.cp.trim(),
          },
          usoCfdi: cfdiForm.usoCfdi,
          paymentForm: cfdiForm.formaPago,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInvoices(prev => prev.map(inv =>
        inv.id === cfdiFor.id ? { ...inv, cfdiUuid: data.uuid } : inv,
      ));
      setCfdiFor(null);
      toast.success("CFDI timbrado correctamente ante el SAT");
      if (data.pdfUrl) window.open(data.pdfUrl, "_blank");
    } catch (err: any) {
      toast.error(err.message ?? "Error al timbrar");
    } finally {
      setCfdiLoading(false);
    }
  }

  const newFormTotal = (Number(form.quantity) || 1) * (Number(form.unitPrice) || 0);

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "clamp(16px, 1.4vw, 22px)", letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>Facturación</h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
            Gestión de facturas y pagos · {invoices.length} facturas
          </p>
        </div>
        <ButtonNew variant="primary" icon={<Plus size={14} />} onClick={() => setShowNew(true)}>
          Nueva factura
        </ButtonNew>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard label="Total cobrado" value={fmtMXN(totalPaid)}       icon={CheckCircle2} />
        <KpiCard label="Por cobrar"    value={fmtMXN(totalPending)}    icon={Clock} />
        <KpiCard label="Vencido"       value={fmtMXN(totalOverdue)}    icon={AlertCircle} />
        <KpiCard label="Este mes"      value={String(monthInvoices)}   icon={FileText} />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <div className="search-field">
          <Search size={14} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por paciente o folio…"
          />
        </div>
        <div className="segment-new">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatus(f.value)}
              className={`segment-new__btn ${status === f.value ? "segment-new__btn--active" : ""}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <CardNew noPad>
        {filtered.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            {invoices.length === 0 ? "No hay facturas todavía" : "Sin resultados para los filtros aplicados"}
          </div>
        ) : (
          <table className="table-new">
            <thead>
              <tr>
                <th>Folio</th>
                <th>Paciente</th>
                <th>Fecha</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "right" }}>Pagado</th>
                <th style={{ textAlign: "right" }}>Saldo</th>
                <th>Estado</th>
                <th>CFDI</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => {
                const badge = STATUS_BADGE[inv.status] ?? STATUS_BADGE.PENDING;
                const fullName = `${inv.patient?.firstName ?? ""} ${inv.patient?.lastName ?? "—"}`;
                const isDraft = inv.status === "DRAFT";
                const canPay  = !["PAID", "CANCELLED"].includes(inv.status) && !isDraft;
                return (
                  <tr key={inv.id}>
                    <td className="mono" style={{ color: "var(--text-2)" }}>
                      {isDraft && "📝 "}{inv.invoiceNumber}
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <AvatarNew name={fullName} size="sm" />
                        <span style={{ color: "var(--text-1)" }}>{fullName}</span>
                      </div>
                    </td>
                    <td className="mono" style={{ color: "var(--text-2)" }}>
                      {formatRelativeDate(inv.createdAt)}
                    </td>
                    <td className="mono" style={{ textAlign: "right", color: "var(--text-1)" }}>
                      {fmtMXNdec(inv.total)}
                    </td>
                    <td className="mono" style={{ textAlign: "right", color: "var(--success)" }}>
                      {fmtMXNdec(inv.paid)}
                    </td>
                    <td className="mono" style={{ textAlign: "right", color: inv.balance > 0 ? "var(--warning)" : "var(--text-3)" }}>
                      {fmtMXNdec(inv.balance)}
                    </td>
                    <td>
                      <BadgeNew tone={badge.tone} dot>{badge.label}</BadgeNew>
                    </td>
                    <td>
                      {inv.cfdiUuid ? (
                        <BadgeNew tone="success">Timbrado</BadgeNew>
                      ) : clinic.facturApiEnabled ? (
                        <button
                          type="button"
                          onClick={() => { setCfdiFor(inv); setCfdiForm(f => ({ ...f, rfc: "", nombre: "", cp: "" })); }}
                          className="btn-new btn-new--ghost btn-new--sm"
                        >
                          Timbrar
                        </button>
                      ) : (
                        <span style={{ fontSize: 10, color: "var(--text-4)" }}>SAT no configurado</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {isDraft ? (
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <button type="button" onClick={() => confirmDraft(inv.id)} className="btn-new btn-new--ghost btn-new--sm" style={{ color: "var(--success)" }}>
                            Confirmar
                          </button>
                          <button type="button" onClick={() => deleteDraft(inv.id)} className="btn-new btn-new--ghost btn-new--sm" style={{ color: "var(--danger)" }}>
                            Eliminar
                          </button>
                        </span>
                      ) : canPay ? (
                        <button
                          type="button"
                          onClick={() => { setPayFor(inv); setPayAmount(String(inv.balance)); }}
                          className="btn-new btn-new--ghost btn-new--sm"
                        >
                          Registrar pago
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardNew>

      {/* Modal: Nueva factura */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal modal--wide" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">Nueva factura</div>
              <button onClick={() => setShowNew(false)} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label="Cerrar">
                <X size={14} />
              </button>
            </div>
            <form onSubmit={e => { e.preventDefault(); createInvoice(); }}>
              <div className="modal__body">
                <div style={{ marginBottom: 22 }}>
                  <div className="form-section__title">Paciente y detalle<span className="form-section__rule" /></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
                    <div className="field-new" style={{ gridColumn: "1 / -1" }}>
                      <label className="field-new__label">Paciente <span className="req">*</span></label>
                      <select className="input-new" value={form.patientId} onChange={e => setF("patientId", e.target.value)}>
                        <option value="">Seleccionar…</option>
                        {patients.map(p => (
                          <option key={p.id} value={p.id}>#{p.patientNumber} — {p.firstName} {p.lastName}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field-new" style={{ gridColumn: "1 / -1" }}>
                      <label className="field-new__label">Descripción <span className="req">*</span></label>
                      <input className="input-new" placeholder="Consulta dental…" value={form.description} onChange={e => setF("description", e.target.value)} />
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: 22 }}>
                  <div className="form-section__title">Conceptos y totales<span className="form-section__rule" /></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 14px" }}>
                    <div className="field-new">
                      <label className="field-new__label">Cantidad</label>
                      <input type="number" min={1} className="input-new" value={form.quantity} onChange={e => setF("quantity", e.target.value)} />
                    </div>
                    <div className="field-new">
                      <label className="field-new__label">Precio unitario <span className="req">*</span></label>
                      <input type="number" min={0} className="input-new" placeholder="500" value={form.unitPrice} onChange={e => setF("unitPrice", e.target.value)} />
                    </div>
                    <div className="field-new">
                      <label className="field-new__label">Total</label>
                      <div className="input-new mono" style={{ display: "flex", alignItems: "center", color: "var(--text-1)", fontWeight: 600 }}>
                        {fmtMXNdec(newFormTotal)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="field-new">
                  <label className="field-new__label">Notas</label>
                  <input className="input-new" placeholder="Opcional" value={form.notes} onChange={e => setF("notes", e.target.value)} />
                </div>
              </div>
              <div className="modal__footer">
                <ButtonNew variant="ghost" type="button" onClick={() => setShowNew(false)}>Cancelar</ButtonNew>
                <ButtonNew variant="primary" type="submit" disabled={loadingNew}>
                  {loadingNew ? "Guardando…" : "Crear factura"}
                </ButtonNew>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Registrar pago */}
      {payFor && (
        <div className="modal-overlay" onClick={() => setPayFor(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">Registrar pago — {payFor.invoiceNumber}</div>
              <button onClick={() => setPayFor(null)} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label="Cerrar">
                <X size={14} />
              </button>
            </div>
            <div className="modal__body">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Total factura</div>
                  <div className="mono" style={{ color: "var(--text-1)", fontWeight: 600 }}>{fmtMXNdec(payFor.total)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Saldo pendiente</div>
                  <div className="mono" style={{ color: "var(--warning)", fontWeight: 600 }}>{fmtMXNdec(payFor.balance)}</div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
                <div className="field-new">
                  <label className="field-new__label">Monto <span className="req">*</span></label>
                  <input type="number" min={0} className="input-new" value={payAmount} onChange={e => setPayAmount(e.target.value)} />
                </div>
                <div className="field-new">
                  <label className="field-new__label">Método</label>
                  <select className="input-new" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                    <option value="CASH">Efectivo</option>
                    <option value="CARD">Tarjeta</option>
                    <option value="TRANSFER">Transferencia</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal__footer">
              <ButtonNew variant="ghost" type="button" onClick={() => setPayFor(null)}>Cancelar</ButtonNew>
              <ButtonNew variant="primary" onClick={registerPayment}>Registrar pago</ButtonNew>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Timbrar CFDI */}
      {cfdiFor && !cfdiFor.cfdiUuid && (
        <div className="modal-overlay" onClick={() => setCfdiFor(null)}>
          <div className="modal modal--wide" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">Timbrar CFDI — {cfdiFor.invoiceNumber}</div>
              <button onClick={() => setCfdiFor(null)} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label="Cerrar">
                <X size={14} />
              </button>
            </div>
            <div className="modal__body">
              <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 18 }}>
                Factura por <strong className="mono" style={{ color: "var(--text-1)" }}>{fmtMXNdec(cfdiFor.total)}</strong>.
                Emisor: {clinic.rfcEmisor ?? "—"}.
              </div>

              <div style={{ marginBottom: 22 }}>
                <div className="form-section__title">Datos del receptor<span className="form-section__rule" /></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: "12px 14px" }}>
                  <div className="field-new">
                    <label className="field-new__label">RFC <span className="req">*</span></label>
                    <input className="input-new mono" style={{ textTransform: "uppercase" }}
                      placeholder="XAXX010101000" value={cfdiForm.rfc}
                      onChange={e => setCfdiF("rfc", e.target.value.toUpperCase())} />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Nombre / Razón social <span className="req">*</span></label>
                    <input className="input-new" style={{ textTransform: "uppercase" }}
                      placeholder="JUAN PÉREZ GARCÍA" value={cfdiForm.nombre}
                      onChange={e => setCfdiF("nombre", e.target.value)} />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">CP <span className="req">*</span></label>
                    <input className="input-new mono" maxLength={5} placeholder="97000"
                      value={cfdiForm.cp} onChange={e => setCfdiF("cp", e.target.value)} />
                  </div>
                </div>
              </div>

              <div>
                <div className="form-section__title">Régimen, uso y forma de pago<span className="form-section__rule" /></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 14px" }}>
                  <div className="field-new">
                    <label className="field-new__label">Régimen fiscal</label>
                    <select className="input-new" value={cfdiForm.regimenFiscal} onChange={e => setCfdiF("regimenFiscal", e.target.value)}>
                      <option value="616">616 — Sin obligaciones fiscales</option>
                      <option value="605">605 — Sueldos y salarios</option>
                      <option value="612">612 — Personas físicas con actividad</option>
                      <option value="626">626 — Régimen simplificado de confianza</option>
                    </select>
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Uso CFDI</label>
                    <select className="input-new" value={cfdiForm.usoCfdi} onChange={e => setCfdiF("usoCfdi", e.target.value)}>
                      <option value="D01">D01 — Honorarios médicos</option>
                      <option value="D07">D07 — Primas seguros</option>
                      <option value="G03">G03 — Gastos en general</option>
                      <option value="S01">S01 — Sin efectos fiscales</option>
                    </select>
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Forma de pago</label>
                    <select className="input-new" value={cfdiForm.formaPago} onChange={e => setCfdiF("formaPago", e.target.value)}>
                      <option value="01">01 — Efectivo</option>
                      <option value="02">02 — Cheque</option>
                      <option value="03">03 — Transferencia</option>
                      <option value="04">04 — Tarjeta de crédito</option>
                      <option value="28">28 — Tarjeta de débito</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal__footer">
              <ButtonNew variant="ghost" type="button" onClick={() => setCfdiFor(null)}>Cancelar</ButtonNew>
              <ButtonNew variant="primary" onClick={timbraCfdi} disabled={cfdiLoading}>
                {cfdiLoading ? "Timbrando…" : "Timbrar ante SAT"}
              </ButtonNew>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
