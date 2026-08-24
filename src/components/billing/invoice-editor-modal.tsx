"use client";

// ÚNICO editor de facturas del panel: lo usan la ficha del paciente y Caja.
// Tiene la misma riqueza que el editor de presupuestos (QuoteEditor): tarifario
// + línea libre, descuento por línea y descuento global (% / monto), doctor
// atribuido, impuestos y totales en vivo. Reusa la matemática autoritativa de
// `@/lib/quotes/compute` (computeTotals/round2) y mapea al contrato de
// POST /api/invoices = { patientId, items:[{description,quantity,unitPrice,discount?,total}],
// discount, notes?, doctorId?, taxRate?, taxIncluded? }.
// El servidor recalcula subtotal/total/balance (y aplica IVA agregado si taxIncluded=false).
//
// El paciente puede venir FIJO (ficha) o elegirse aquí con el buscador (Caja):
// ver `patientId` vs `patients` en las props.

import { useState, useEffect, useMemo } from "react";
import { Plus, Loader2, Trash2, Check, Search, User } from "lucide-react";
import toast from "react-hot-toast";
import { computeTotals, round2 } from "@/lib/quotes/compute";
import { clinicInvoiceTaxDefaults, IVA_RATE_PCT, type CfdiTaxMode } from "@/lib/invoice-totals";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useT } from "@/i18n/i18n-provider";

function money(n: number): string {
  const v = isFinite(Number(n)) ? Number(n) : 0;
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(v);
}

interface CatalogProcedure { id: string; name: string; basePrice: number; category?: string }
interface DoctorOption { id: string; name: string }

/** Paciente del buscador. Lo provee el server ya filtrado por clínica y visibilidad. */
export interface InvoiceEditorPatient {
  id: string;
  firstName: string;
  lastName: string;
  patientNumber?: number | string | null;
}

interface EditorItem {
  key: string;
  procedureId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
}

let _seq = 0;
function newKey(): string { _seq += 1; return `inv-it-${_seq}`; }

function patientLabel(p: InvoiceEditorPatient): string {
  const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "—";
  return p.patientNumber ? `#${p.patientNumber} — ${name}` : name;
}

export interface InvoiceEditorModalProps {
  open: boolean;
  /** Paciente FIJO (ficha del paciente). Omitir para que el editor muestre el buscador. */
  patientId?: string;
  patientName?: string;
  /** Catálogo del buscador cuando no hay paciente fijo (Caja). Ya viene acotado por clínica. */
  patients?: InvoiceEditorPatient[];
  /** Clinic.cfdiTaxMode ("exempt" | "iva16"): impuestos con los que NACE la factura. */
  clinicTaxMode?: string | null;
  onClose: () => void;
  /** Recibe la factura creada (shape de POST /api/invoices) para insertarla sin recargar. */
  onCreated: (invoice: any) => void;
}

export function InvoiceEditorModal({ open, patientId, patientName, patients, clinicTaxMode, onClose, onCreated }: InvoiceEditorModalProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        {/* El cuerpo se monta de cero en cada apertura → el formulario nunca queda con estado viejo. */}
        <InvoiceEditorBody
          patientId={patientId}
          patientName={patientName}
          patients={patients}
          clinicTaxMode={clinicTaxMode}
          onClose={onClose}
          onCreated={onCreated}
        />
      </DialogContent>
    </Dialog>
  );
}

function InvoiceEditorBody({
  patientId, patientName, patients, clinicTaxMode, onClose, onCreated,
}: {
  patientId?: string;
  patientName?: string;
  patients?: InvoiceEditorPatient[];
  clinicTaxMode?: string | null;
  onClose: () => void;
  onCreated: (invoice: any) => void;
}) {
  const t = useT();
  const [items, setItems] = useState<EditorItem[]>([]);
  const [discountMode, setDiscountMode] = useState<"none" | "pct" | "amount">("none");
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [notes, setNotes] = useState("");
  // "Vence el" (Invoice.dueDate) — opcional. Viaja como "YYYY-MM-DD" y el
  // servidor lo ancla al día natural de la clínica. Es lo ÚNICO que hace que
  // una factura cuente como vencida (KPI, filtro "Vencidas", Caja, Finanzas).
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Paciente: fijo por prop (ficha) o elegido aquí con el buscador (Caja).
  const fixedPatient = Boolean(patientId);
  const [pickedPatient, setPickedPatient] = useState<InvoiceEditorPatient | null>(null);
  const [patientQuery, setPatientQuery] = useState("");
  const effectivePatientId = patientId ?? pickedPatient?.id ?? "";
  const effectivePatientName = patientId
    ? (patientName ?? "")
    : (pickedPatient ? `${pickedPatient.firstName ?? ""} ${pickedPatient.lastName ?? ""}`.trim() : "");

  // Doctor atribuido (Invoice.doctorId) — opcional, alimenta los reportes por médico de Caja.
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [doctorId, setDoctorId] = useState("");

  // Impuestos (Invoice.taxRate / taxIncluded). Nacen según la preferencia fiscal
  // de la clínica: exenta (odontología, lo común) = 0% sin desglose; iva16 = 16%
  // ya incluido en el precio. Cambiable por factura.
  const initialTax = useMemo(() => clinicInvoiceTaxDefaults(clinicTaxMode), [clinicTaxMode]);
  const [taxRate, setTaxRate] = useState<number>(initialTax.taxRate);
  const [taxIncluded, setTaxIncluded] = useState<boolean>(initialTax.taxIncluded);
  const taxMode: CfdiTaxMode = taxRate > 0 ? "iva16" : "exento";

  // Tarifario para el autocomplete (mismo endpoint que presupuestos).
  const [catalog, setCatalog] = useState<CatalogProcedure[]>([]);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    fetch("/api/procedures")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setCatalog(Array.isArray(d) ? d.map((p: { id: string; name: string; basePrice: number; category?: string }) => ({ id: p.id, name: p.name, basePrice: Number(p.basePrice) || 0, category: p.category })) : []))
      .catch(() => setCatalog([]));
  }, []);

  useEffect(() => {
    fetch("/api/agenda/doctors")
      .then((r) => (r.ok ? r.json() : { doctors: [] }))
      .then((d) => setDoctors(Array.isArray(d?.doctors) ? d.doctors.map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })) : []))
      .catch(() => setDoctors([]));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const base = q ? catalog.filter((p) => p.name.toLowerCase().includes(q)) : catalog;
    return base.slice(0, 30);
  }, [catalog, search]);

  const patientMatches = useMemo(() => {
    const list = patients ?? [];
    const q = patientQuery.toLowerCase().trim();
    const base = q
      ? list.filter((p) => `${p.firstName ?? ""} ${p.lastName ?? ""} ${p.patientNumber ?? ""}`.toLowerCase().includes(q))
      : list;
    return base.slice(0, 30);
  }, [patients, patientQuery]);

  const totals = useMemo(() => {
    const asInput = items.map((it) => ({ name: it.name, quantity: it.quantity, unitPrice: it.unitPrice, discount: it.discount }));
    return computeTotals(asInput, {
      discountPct: discountMode === "pct" ? discountValue : null,
      discountAmount: discountMode === "amount" ? discountValue : null,
    });
  }, [items, discountMode, discountValue]);

  // IVA en vivo sobre la base (subtotal − descuento):
  //   incluido → IVA = base − base/(1+r); total = base.
  //   agregado → IVA = base·r;            total = base + IVA.
  //   exento (r=0) → IVA = 0;             total = base.
  const { tax, grandTotal } = useMemo(() => {
    const base = totals.total;
    const r = Math.min(100, Math.max(0, taxRate)) / 100;
    if (taxIncluded) {
      const t = r > 0 ? round2(base - base / (1 + r)) : 0;
      return { tax: t, grandTotal: round2(base) };
    }
    const t = round2(base * r);
    return { tax: t, grandTotal: round2(base + t) };
  }, [totals.total, taxRate, taxIncluded]);

  function addProcedure(p: CatalogProcedure) {
    setItems((prev) => [...prev, {
      key: newKey(), procedureId: p.id, name: p.name, quantity: 1, unitPrice: p.basePrice, discount: 0,
    }]);
    setSearch("");
    setShowSearch(false);
  }
  function addBlank() {
    setItems((prev) => [...prev, {
      key: newKey(), procedureId: null, name: "", quantity: 1, unitPrice: 0, discount: 0,
    }]);
  }
  function patchItem(key: string, patch: Partial<EditorItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }
  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  const num = (v: string) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const inputCls = "w-full bg-background border border-border rounded-lg px-2 py-1.5 text-sm";
  const selectCls = "mt-1 w-full bg-background border border-border rounded-lg px-2 py-2 text-sm";

  async function save() {
    if (!effectivePatientId) { toast.error(t("billing.invoiceEditor.errorNoPatient")); return; }
    const clean = items.filter((it) => it.name.trim().length > 0);
    if (clean.length === 0) { toast.error(t("billing.invoiceEditor.errorNoItems")); return; }
    setSaving(true);
    // Reusa la matemática autoritativa: normaliza líneas (lineTotal con descuento
    // de línea) y resuelve el descuento global %→monto. Así el server obtiene
    // subtotal=Σtotal y total=subtotal−discount, coincidiendo con el "Total" en vivo.
    const normalized = computeTotals(
      clean.map((it) => ({ name: it.name.trim(), quantity: it.quantity, unitPrice: it.unitPrice, discount: it.discount })),
      {
        discountPct: discountMode === "pct" ? discountValue : null,
        discountAmount: discountMode === "amount" ? discountValue : null,
      },
    );
    const payload: any = {
      patientId: effectivePatientId,
      items: normalized.items.map((it) => ({
        description: String(it.name).trim(),
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        // El descuento POR LÍNEA viaja con el concepto (clamp a importe): el
        // server y la guarda del CFDI calculan qty × unitPrice − discount; sin
        // él, el total interno (neto) no cuadraría con los conceptos (bruto).
        ...(it.discount > 0 ? { discount: Math.min(it.discount, round2(it.unitPrice * it.quantity)) } : {}),
        total: round2(it.lineTotal),
      })),
      discount: round2(normalized.discountAmount),
      // Exento viaja como tasa 0: es la señal explícita que lee resolveTaxMode al
      // timbrar (la columna nace en 16, así que 0 solo puede venir de esta elección).
      taxRate: Math.min(100, Math.max(0, taxRate)),
      taxIncluded,
    };
    if (doctorId) payload.doctorId = doctorId;
    if (notes.trim()) payload.notes = notes.trim();
    if (dueDate) payload.dueDate = dueDate;
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || t("billing.invoiceEditor.errorCreate"));
      toast.success(t("billing.invoiceEditor.createdToast", { number: out.invoiceNumber ?? "" }));
      onCreated(out);
      // No reseteamos `saving`: el modal se cierra (open=false) y este cuerpo se desmonta.
    } catch (e) {
      toast.error((e as Error).message || t("billing.invoiceEditor.errorCreate"));
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {effectivePatientName
            ? t("billing.invoiceEditor.titleWithPatient", { patient: effectivePatientName })
            : t("billing.invoiceEditor.title")}
        </DialogTitle>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto min-h-0 px-6 pb-4 space-y-4">
        {/* Paciente — solo cuando NO viene fijo desde la ficha */}
        {!fixedPatient && (
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold">{t("billing.invoiceEditor.patient")}</h3>
              {pickedPatient && (
                <button type="button" onClick={() => { setPickedPatient(null); setPatientQuery(""); }}
                  className="text-[11px] font-semibold text-brand-700 dark:text-brand-300">
                  {t("billing.invoiceEditor.changePatient")}
                </button>
              )}
            </div>

            {pickedPatient ? (
              <div className="flex items-center gap-2 border border-border rounded-lg px-3 py-2 bg-background">
                <User size={14} className="text-muted-foreground flex-shrink-0" />
                <span className="text-sm font-medium truncate">{patientLabel(pickedPatient)}</span>
              </div>
            ) : (
              <>
                <input
                  value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                  placeholder={t("billing.invoiceEditor.patientSearchPlaceholder")}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                />
                <div className="max-h-48 overflow-y-auto divide-y divide-border border border-border rounded-lg">
                  {patientMatches.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3 text-center">
                      {(patients ?? []).length === 0
                        ? t("billing.invoiceEditor.noPatients")
                        : t("billing.invoiceEditor.noPatientMatches")}
                    </p>
                  ) : patientMatches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setPickedPatient(p); setPatientQuery(""); }}
                      className="w-full text-left px-3 py-2 hover:bg-muted/50 text-xs font-medium truncate"
                    >
                      {patientLabel(p)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Conceptos */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold">{t("billing.invoiceEditor.items")}</h3>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setShowSearch((s) => !s)}
                className="text-[11px] font-semibold text-brand-700 dark:text-brand-300 inline-flex items-center gap-1">
                <Search size={13} aria-hidden /> {t("billing.invoiceEditor.fromCatalog")}
              </button>
              <button type="button" onClick={addBlank}
                className="text-[11px] font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                <Plus size={13} aria-hidden /> {t("billing.invoiceEditor.freeLine")}
              </button>
            </div>
          </div>

          {showSearch && (
            <div className="border border-border rounded-lg p-2 bg-muted/30">
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("billing.invoiceEditor.procedureSearchPlaceholder")}
                className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm"
              />
              <div className="mt-2 max-h-56 overflow-y-auto divide-y divide-border">
                {filtered.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3 text-center">{t("billing.invoiceEditor.noCatalogMatches")}</p>
                ) : filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProcedure(p)}
                    className="w-full text-left px-2 py-2 hover:bg-muted/50 flex items-center justify-between gap-2"
                  >
                    <span className="text-xs font-medium truncate">{p.name}</span>
                    <span className="text-xs font-bold text-muted-foreground whitespace-nowrap">{money(p.basePrice)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              {t("billing.invoiceEditor.emptyItems")}
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((it) => {
                const line = computeTotals([{
                  name: it.name, quantity: it.quantity, unitPrice: it.unitPrice, discount: it.discount,
                }], {}).items[0];
                return (
                  <div key={it.key} className="border border-border rounded-lg p-2.5 bg-background">
                    <div className="flex items-start gap-2">
                      <input
                        value={it.name}
                        onChange={(e) => patchItem(it.key, { name: e.target.value })}
                        placeholder={t("billing.invoiceEditor.itemPlaceholder")}
                        className="flex-1 min-w-0 bg-transparent border-b border-border px-1 py-1 text-sm font-medium focus:border-brand-500 outline-none"
                      />
                      <button type="button" onClick={() => removeItem(it.key)}
                        aria-label={t("billing.invoiceEditor.removeItem")}
                        title={t("billing.invoiceEditor.removeItem")}
                        className="p-1 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex-shrink-0">
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <Field label={t("billing.invoiceEditor.qty")}>
                        <input type="number" min={1} value={it.quantity}
                          onChange={(e) => patchItem(it.key, { quantity: Math.max(1, Math.floor(num(e.target.value))) })}
                          className={inputCls} />
                      </Field>
                      <Field label={t("billing.invoiceEditor.unitPrice")}>
                        <input type="number" min={0} step="0.01" value={it.unitPrice}
                          onChange={(e) => patchItem(it.key, { unitPrice: num(e.target.value) })}
                          className={inputCls} />
                      </Field>
                      <Field label={t("billing.invoiceEditor.discount")}>
                        <input type="number" min={0} step="0.01" value={it.discount}
                          onChange={(e) => patchItem(it.key, { discount: num(e.target.value) })}
                          className={inputCls} />
                      </Field>
                    </div>
                    <div className="flex items-center justify-end mt-2">
                      <span className="text-sm font-bold whitespace-nowrap">{money(line ? line.lineTotal : 0)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Doctor + Descuento global + Impuestos + Notas */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{t("billing.invoiceEditor.doctor")}</label>
              <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className={selectCls}>
                <option value="">{t("billing.invoiceEditor.doctorUnassigned")}</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{t("billing.invoiceEditor.globalDiscount")}</label>
              <div className="flex items-center gap-1.5 mt-1">
                <select value={discountMode} onChange={(e) => setDiscountMode(e.target.value as "none" | "pct" | "amount")}
                  className="min-w-0 flex-1 bg-background border border-border rounded-lg px-2 py-2 text-sm">
                  <option value="none">{t("billing.invoiceEditor.discountNone")}</option>
                  <option value="pct">{t("billing.invoiceEditor.discountPct")}</option>
                  <option value="amount">{t("billing.invoiceEditor.discountAmount")}</option>
                </select>
                {discountMode !== "none" && (
                  <input type="number" min={0} step="0.01" value={discountValue}
                    onChange={(e) => setDiscountValue(num(e.target.value))}
                    className="w-24 flex-shrink-0 bg-background border border-border rounded-lg px-3 py-2 text-sm" />
                )}
              </div>
            </div>
          </div>

          {/* Impuestos: solo los dos modos que el CFDI sabe timbrar (Facturapi
              desglosa 16% fijo). Una tasa intermedia se vería bien aquí y luego
              rebotaría al timbrar con el 409 de descuadre. */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{t("billing.invoiceEditor.taxes")}</label>
              <select
                value={taxMode}
                onChange={(e) => {
                  const iva = e.target.value === "iva16";
                  setTaxRate(iva ? IVA_RATE_PCT : 0);
                  // Al volver a Exento hay que resetear la modalidad: el select de
                  // abajo se desmonta y dejaría un "IVA agregado" residual, o sea
                  // una factura con tasa 0 que dice desglosar. Cuadra igual, pero
                  // si al timbrar alguien fuerza "IVA 16%" la guarda ve base×1.16
                  // y bloquea con un 409 que culpa a los conceptos.
                  if (!iva) setTaxIncluded(true);
                }}
                className={selectCls}
              >
                <option value="exento">{t("billing.invoiceEditor.taxExempt")}</option>
                <option value="iva16">{t("billing.invoiceEditor.taxIva", { rate: IVA_RATE_PCT })}</option>
              </select>
            </div>
            {taxMode === "iva16" && (
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{t("billing.invoiceEditor.taxMode")}</label>
                <select
                  value={taxIncluded ? "included" : "added"}
                  onChange={(e) => setTaxIncluded(e.target.value === "included")}
                  className={selectCls}
                >
                  <option value="included">{t("billing.invoiceEditor.taxIncludedOption")}</option>
                  <option value="added">{t("billing.invoiceEditor.taxAddedOption")}</option>
                </select>
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{t("billing.invoiceEditor.dueDate")}</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
              <p className="mt-1 text-[11px] text-muted-foreground">{t("billing.invoiceEditor.dueDateHint")}</p>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{t("billing.invoiceEditor.notes")}</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder={t("billing.invoiceEditor.notesPlaceholder")}
                className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
        </div>
      </div>

      {/* Totales + acciones (footer fijo, siempre visible) */}
      <DialogFooter className="flex-col items-stretch gap-3">
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex justify-between w-full max-w-xs text-xs text-muted-foreground">
            <span>{t("billing.invoiceEditor.subtotal")}</span><span>{money(totals.subtotal)}</span>
          </div>
          {totals.discountAmount > 0 && (
            <div className="flex justify-between w-full max-w-xs text-xs text-muted-foreground">
              <span>{t("billing.invoiceEditor.discount")}</span><span>-{money(totals.discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between w-full max-w-xs text-xs text-muted-foreground">
            {taxMode === "iva16" ? (
              <>
                <span>{t(taxIncluded ? "billing.invoiceEditor.taxIvaIncluded" : "billing.invoiceEditor.taxIva", { rate: round2(taxRate) })}</span><span>{money(tax)}</span>
              </>
            ) : (
              <>
                <span>{t("billing.invoiceEditor.taxes")}</span><span>{t("billing.invoiceEditor.exempt")}</span>
              </>
            )}
          </div>
          <div className="flex justify-between w-full max-w-xs text-base font-bold text-brand-700 dark:text-brand-300 pt-1">
            <span>{t("billing.invoiceEditor.total")}</span><span>{money(grandTotal)}</span>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="text-xs font-semibold px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted/50">
            {t("billing.invoiceEditor.cancel")}
          </button>
          <button type="button" onClick={save} disabled={saving}
            className="text-xs font-semibold px-4 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 inline-flex items-center gap-1.5">
            {saving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}
            {saving ? t("billing.invoiceEditor.creating") : t("billing.invoiceEditor.createInvoice")}
          </button>
        </div>
      </DialogFooter>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">{label}</span>
      {children}
    </label>
  );
}
