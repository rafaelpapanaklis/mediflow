"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, CheckCircle2, Clock, AlertCircle, FileText, Search, X, Wallet,
} from "lucide-react";
import toast from "react-hot-toast";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fmtMXN, fmtMXNdec, formatRelativeDate } from "@/lib/format";
import { PaymentModal, type PaymentInvoice } from "@/components/dashboard/billing/payment-modal";
import { InvoiceDetailModal } from "@/components/dashboard/billing/invoice-detail-modal";
import { useT } from "@/i18n/i18n-provider";

type Tone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";
const STATUS_BADGE: Record<string, { tone: Tone; labelKey: string }> = {
  PENDING:   { tone: "warning", labelKey: "billing.billingClient.statusPending"   },
  PARTIAL:   { tone: "info",    labelKey: "billing.billingClient.statusPartial"   },
  PAID:      { tone: "success", labelKey: "billing.billingClient.statusPaid"      },
  OVERDUE:   { tone: "danger",  labelKey: "billing.billingClient.statusOverdue"   },
  DRAFT:     { tone: "brand",   labelKey: "billing.billingClient.statusDraft"     },
  CANCELLED: { tone: "neutral", labelKey: "billing.billingClient.statusCancelled" },
};

const STATUS_FILTERS = [
  { value: "all",      labelKey: "billing.billingClient.filterAll" },
  { value: "pending",  labelKey: "billing.billingClient.filterPending" },
  { value: "paid",     labelKey: "billing.billingClient.filterPaid" },
  { value: "overdue",  labelKey: "billing.billingClient.filterOverdue" },
  { value: "draft",    labelKey: "billing.billingClient.filterDraft" },
];

interface Props {
  invoices:      any[];
  patients:      any[];
  totalPaid:     number;
  totalPending:  number;
  totalOverdue:  number;
  monthInvoices: number;
  /** Saldo a favor total de la clínica (SUM patient_credits). 0 si no hay. */
  creditTotal?:  number;
  clinic:        { facturApiEnabled: boolean; rfcEmisor: string | null };
}

function patientNameOf(inv: any): string {
  return `${inv.patient?.firstName ?? ""} ${inv.patient?.lastName ?? ""}`.trim() || "—";
}

export function BillingClient({ invoices: initial, patients, totalPaid, totalPending, totalOverdue, monthInvoices, creditTotal = 0, clinic }: Props) {
  const t = useT();
  const router = useRouter();
  const [invoices, setInvoices] = useState(initial);
  const [search, setSearch]     = useState("");
  const [status, setStatus]     = useState<string>("all");

  // Sync local state cuando router.refresh() trae props nuevos del server.
  // useState(initial) solo toma el valor en mount, así que sin esto las
  // mutaciones pierden la actualización después de un router.refresh().
  useEffect(() => { setInvoices(initial); }, [initial]);

  // Modals
  const [showNew, setShowNew]                     = useState(false);
  const [paymentInvoice, setPaymentInvoice]       = useState<(PaymentInvoice & { _patientName?: string }) | null>(null);
  const [detailInvoice, setDetailInvoice]         = useState<any | null>(null);
  const [cfdiFor, setCfdiFor]                     = useState<any | null>(null);

  // New invoice form
  const [form, setForm] = useState({ patientId: "", description: "", quantity: "1", unitPrice: "", notes: "" });
  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const [loadingNew, setLoadingNew] = useState(false);

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

  // Refresh tras una mutación de factura. router.refresh() re-corre el server
  // component con los revalidatePath que dispararon los endpoints; el
  // useEffect arriba propaga el prop nuevo al state local.
  function refresh() {
    router.refresh();
  }

  async function createInvoice() {
    if (!form.patientId || !form.description || !form.unitPrice) {
      toast.error(t("billing.billingClient.toastRequiredFields"));
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
      toast.success(t("billing.billingClient.toastInvoiceCreated", { number: inv.invoiceNumber }));
      setShowNew(false);
      setForm({ patientId: "", description: "", quantity: "1", unitPrice: "", notes: "" });
      refresh();
    } catch (err: any) {
      toast.error(err.message ?? t("billing.billingClient.toastInvoiceCreateError"));
    } finally {
      setLoadingNew(false);
    }
  }

  async function timbraCfdi() {
    if (!cfdiFor) return;
    if (!cfdiForm.rfc.trim() || !cfdiForm.nombre.trim() || !cfdiForm.cp.trim()) {
      toast.error(t("billing.billingClient.toastCfdiReceptorRequired"));
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
      toast.success(t("billing.billingClient.toastCfdiStamped"));
      // Al superar el cupo del mes: se timbra igual y se avisa que es adicional.
      if (data.quota && data.quota.overage > 0) {
        toast(
          t("billing.billingClient.toastCfdiOverage", { price: fmtMXNdec((data.quota.overagePriceCents ?? 0) / 100) }),
          { icon: "🧾", duration: 6000 },
        );
      }
      if (data.pdfUrl) window.open(data.pdfUrl, "_blank");
    } catch (err: any) {
      toast.error(err.message ?? t("billing.billingClient.toastCfdiStampError"));
    } finally {
      setCfdiLoading(false);
    }
  }

  function openPaymentForRow(e: React.MouseEvent, inv: any) {
    e.stopPropagation();  // no abrir el detalle si se cliqueó "Registrar pago"
    setPaymentInvoice({
      id: inv.id, invoiceNumber: inv.invoiceNumber,
      total: inv.total, paid: inv.paid, balance: inv.balance, status: inv.status,
      patientName: patientNameOf(inv),
    });
  }

  const newFormTotal = (Number(form.quantity) || 1) * (Number(form.unitPrice) || 0);

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "clamp(16px, 1.4vw, 22px)", letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>{t("billing.billingClient.title")}</h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
            {t("billing.billingClient.subtitle", { count: invoices.length })}
          </p>
        </div>
        <ButtonNew variant="primary" icon={<Plus size={14} />} onClick={() => setShowNew(true)}>
          {t("billing.billingClient.newInvoice")}
        </ButtonNew>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard label={t("billing.billingClient.kpiTotalCollected")} value={fmtMXN(totalPaid)}       icon={CheckCircle2} />
        <KpiCard label={t("billing.billingClient.kpiToCollect")}      value={fmtMXN(totalPending)}    icon={Clock} />
        <KpiCard label={t("billing.billingClient.kpiOverdue")}        value={fmtMXN(totalOverdue)}    icon={AlertCircle} />
        <KpiCard label={t("billing.billingClient.kpiThisMonth")}      value={String(monthInvoices)}   icon={FileText} />
        {creditTotal > 0 && (
          <KpiCard label={t("billing.billingClient.kpiCredit")}       value={fmtMXN(creditTotal)}     icon={Wallet} />
        )}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <div className="search-field">
          <Search size={14} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("billing.billingClient.searchPlaceholder")}
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
              {t(f.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <CardNew noPad>
        {filtered.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            {invoices.length === 0 ? t("billing.billingClient.emptyNoInvoices") : t("billing.billingClient.emptyNoResults")}
          </div>
        ) : (
          <table className="table-new">
            <thead>
              <tr>
                <th>{t("billing.billingClient.thFolio")}</th>
                <th>{t("billing.billingClient.thPatient")}</th>
                <th>{t("common.date")}</th>
                <th style={{ textAlign: "right" }}>{t("common.total")}</th>
                <th style={{ textAlign: "right" }}>{t("billing.billingClient.thPaid")}</th>
                <th style={{ textAlign: "right" }}>{t("billing.billingClient.thBalance")}</th>
                <th>{t("common.status")}</th>
                <th>{t("billing.billingClient.thCfdi")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => {
                const badge = STATUS_BADGE[inv.status] ?? STATUS_BADGE.PENDING;
                const fullName = patientNameOf(inv);
                const isDraft = inv.status === "DRAFT";
                const canPay  = !["PAID", "CANCELLED"].includes(inv.status) && !isDraft;
                return (
                  <tr
                    key={inv.id}
                    onClick={() => setDetailInvoice(inv)}
                    style={{ cursor: "pointer" }}
                  >
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
                      <BadgeNew tone={badge.tone} dot>{t(badge.labelKey)}</BadgeNew>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {inv.cfdiUuid ? (
                        <BadgeNew tone="success">{t("billing.billingClient.cfdiStamped")}</BadgeNew>
                      ) : clinic.facturApiEnabled ? (
                        <button
                          type="button"
                          onClick={() => { setCfdiFor(inv); setCfdiForm(f => ({ ...f, rfc: "", nombre: "", cp: "" })); }}
                          className="btn-new btn-new--ghost btn-new--sm"
                        >
                          {t("billing.billingClient.cfdiStamp")}
                        </button>
                      ) : (
                        <span style={{ fontSize: 10, color: "var(--text-4)" }}>{t("billing.billingClient.satNotConfigured")}</span>
                      )}
                    </td>
                    <td
                      style={{ textAlign: "right", whiteSpace: "nowrap" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {canPay ? (
                        <button
                          type="button"
                          onClick={(e) => openPaymentForRow(e, inv)}
                          className="btn-new btn-new--ghost btn-new--sm"
                        >
                          {t("billing.billingClient.registerPayment")}
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

      {/* Modal: Nueva factura — sigue siendo custom porque tiene flujo de
       *  selección de paciente y conceptos que no aplica al PaymentModal. */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal modal--wide" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">{t("billing.billingClient.newInvoice")}</div>
              <button onClick={() => setShowNew(false)} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label={t("common.close")}>
                <X size={14} />
              </button>
            </div>
            <form onSubmit={e => { e.preventDefault(); createInvoice(); }}>
              <div className="modal__body">
                <div style={{ marginBottom: 22 }}>
                  <div className="form-section__title">{t("billing.billingClient.sectionPatientDetail")}<span className="form-section__rule" /></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
                    <div className="field-new" style={{ gridColumn: "1 / -1" }}>
                      <label className="field-new__label">{t("billing.billingClient.labelPatient")} <span className="req">*</span></label>
                      <select className="input-new" value={form.patientId} onChange={e => setF("patientId", e.target.value)}>
                        <option value="">{t("billing.billingClient.optionSelect")}</option>
                        {patients.map(p => (
                          <option key={p.id} value={p.id}>#{p.patientNumber} — {p.firstName} {p.lastName}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field-new" style={{ gridColumn: "1 / -1" }}>
                      <label className="field-new__label">{t("billing.billingClient.labelDescription")} <span className="req">*</span></label>
                      <input className="input-new" placeholder={t("billing.billingClient.placeholderDescription")} value={form.description} onChange={e => setF("description", e.target.value)} />
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: 22 }}>
                  <div className="form-section__title">{t("billing.billingClient.sectionItemsTotals")}<span className="form-section__rule" /></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 14px" }}>
                    <div className="field-new">
                      <label className="field-new__label">{t("billing.billingClient.labelQuantity")}</label>
                      <input type="number" min={1} className="input-new" value={form.quantity} onChange={e => setF("quantity", e.target.value)} />
                    </div>
                    <div className="field-new">
                      <label className="field-new__label">{t("billing.billingClient.labelUnitPrice")} <span className="req">*</span></label>
                      <input type="number" min={0} className="input-new" placeholder="500" value={form.unitPrice} onChange={e => setF("unitPrice", e.target.value)} />
                    </div>
                    <div className="field-new">
                      <label className="field-new__label">{t("common.total")}</label>
                      <div className="input-new mono" style={{ display: "flex", alignItems: "center", color: "var(--text-1)", fontWeight: 600 }}>
                        {fmtMXNdec(newFormTotal)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="field-new">
                  <label className="field-new__label">{t("billing.billingClient.labelNotes")}</label>
                  <input className="input-new" placeholder={t("billing.billingClient.placeholderOptional")} value={form.notes} onChange={e => setF("notes", e.target.value)} />
                </div>
              </div>
              <div className="modal__footer">
                <ButtonNew variant="ghost" type="button" onClick={() => setShowNew(false)}>{t("common.cancel")}</ButtonNew>
                <ButtonNew variant="primary" type="submit" disabled={loadingNew}>
                  {loadingNew ? t("billing.billingClient.savingEllipsis") : t("billing.billingClient.createInvoice")}
                </ButtonNew>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detalle de factura — mismo componente que en /dashboard/patients/[id]
       *  Acciones: Cobrar, Marcar pagada, Editar precio, Aplicar descuento,
       *  Cancelar, Reembolsar, Imprimir, Copiar UUID. */}
      <InvoiceDetailModal
        open={detailInvoice !== null}
        invoice={detailInvoice}
        patientName={detailInvoice ? patientNameOf(detailInvoice) : ""}
        onClose={() => setDetailInvoice(null)}
        onMutated={refresh}
      />

      {/* PaymentModal compartido — atajo "Registrar pago" inline en cada row. */}
      <PaymentModal
        open={paymentInvoice !== null}
        invoice={paymentInvoice}
        onClose={() => setPaymentInvoice(null)}
        onSuccess={() => {
          setPaymentInvoice(null);
          refresh();
        }}
      />

      {/* Modal: Timbrar CFDI — flujo SAT específico, no se reemplaza. */}
      {cfdiFor && !cfdiFor.cfdiUuid && (
        <div className="modal-overlay" onClick={() => setCfdiFor(null)}>
          <div className="modal modal--wide" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">{t("billing.billingClient.cfdiModalTitle", { number: cfdiFor.invoiceNumber })}</div>
              <button onClick={() => setCfdiFor(null)} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label={t("common.close")}>
                <X size={14} />
              </button>
            </div>
            <div className="modal__body">
              <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 18 }}>
                {t("billing.billingClient.cfdiInvoiceFor")} <strong className="mono" style={{ color: "var(--text-1)" }}>{fmtMXNdec(cfdiFor.total)}</strong>.
                {" "}{t("billing.billingClient.cfdiIssuer", { rfc: clinic.rfcEmisor ?? "—" })}
              </div>

              <div style={{ marginBottom: 22 }}>
                <div className="form-section__title">{t("billing.billingClient.cfdiReceptorData")}<span className="form-section__rule" /></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: "12px 14px" }}>
                  <div className="field-new">
                    <label className="field-new__label">RFC <span className="req">*</span></label>
                    <input className="input-new mono" style={{ textTransform: "uppercase" }}
                      placeholder="XAXX010101000" value={cfdiForm.rfc}
                      onChange={e => setCfdiF("rfc", e.target.value.toUpperCase())} />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">{t("billing.billingClient.labelNameLegal")} <span className="req">*</span></label>
                    <input className="input-new" style={{ textTransform: "uppercase" }}
                      placeholder="JUAN PÉREZ GARCÍA" value={cfdiForm.nombre}
                      onChange={e => setCfdiF("nombre", e.target.value)} />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">{t("billing.billingClient.labelZip")} <span className="req">*</span></label>
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
              <ButtonNew variant="ghost" type="button" onClick={() => setCfdiFor(null)}>{t("common.cancel")}</ButtonNew>
              <ButtonNew variant="primary" onClick={timbraCfdi} disabled={cfdiLoading}>
                {cfdiLoading ? t("billing.billingClient.stampingEllipsis") : t("billing.billingClient.stampAtSat")}
              </ButtonNew>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
