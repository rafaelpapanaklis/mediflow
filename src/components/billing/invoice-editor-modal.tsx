"use client";

// Editor de factura con la MISMA riqueza que el editor de presupuestos
// (QuoteEditor): tarifario + línea libre, descuento por línea y descuento
// global (% / monto), totales en vivo. Reusa la matemática autoritativa de
// `@/lib/quotes/compute` (computeTotals/round2) y mapea al contrato de
// POST /api/invoices = { patientId, items:[{description,quantity,unitPrice,total}],
// discount, notes?, doctorId?, taxRate?, taxIncluded? }.
// El servidor recalcula subtotal/total/balance (y aplica IVA agregado si taxIncluded=false).

import { useState, useEffect, useMemo } from "react";
import { Plus, Loader2, Trash2, Check, Search } from "lucide-react";
import toast from "react-hot-toast";
import { computeTotals, round2 } from "@/lib/quotes/compute";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

function money(n: number): string {
  const v = isFinite(Number(n)) ? Number(n) : 0;
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(v);
}

interface CatalogProcedure { id: string; name: string; basePrice: number; category?: string }
interface DoctorOption { id: string; name: string }

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

export interface InvoiceEditorModalProps {
  open: boolean;
  patientId: string;
  patientName: string;
  onClose: () => void;
  /** Recibe la factura creada (shape de POST /api/invoices) para insertarla sin recargar. */
  onCreated: (invoice: any) => void;
}

export function InvoiceEditorModal({ open, patientId, patientName, onClose, onCreated }: InvoiceEditorModalProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        {/* El cuerpo se monta de cero en cada apertura → el formulario nunca queda con estado viejo. */}
        <InvoiceEditorBody patientId={patientId} patientName={patientName} onClose={onClose} onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  );
}

function InvoiceEditorBody({
  patientId, patientName, onClose, onCreated,
}: {
  patientId: string;
  patientName: string;
  onClose: () => void;
  onCreated: (invoice: any) => void;
}) {
  const [items, setItems] = useState<EditorItem[]>([]);
  const [discountMode, setDiscountMode] = useState<"none" | "pct" | "amount">("none");
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Doctor atribuido (Invoice.doctorId, OLA 1) — opcional.
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [doctorId, setDoctorId] = useState("");

  // IVA (Invoice.taxRate / taxIncluded, OLA 1). Default: 16% ya incluido en el precio.
  const [taxRate, setTaxRate] = useState<number>(16);
  const [taxIncluded, setTaxIncluded] = useState<boolean>(true);

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

  async function save() {
    const clean = items.filter((it) => it.name.trim().length > 0);
    if (clean.length === 0) { toast.error("Agrega al menos un concepto."); return; }
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
      patientId,
      items: normalized.items.map((it) => ({
        description: String(it.name).trim(),
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        total: round2(it.lineTotal),
      })),
      discount: round2(normalized.discountAmount),
      taxRate: Math.min(100, Math.max(0, taxRate)),
      taxIncluded,
    };
    if (doctorId) payload.doctorId = doctorId;
    if (notes.trim()) payload.notes = notes.trim();
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "No se pudo crear la factura");
      toast.success("Factura creada: " + (out.invoiceNumber ?? ""));
      onCreated(out);
      // No reseteamos `saving`: el modal se cierra (open=false) y este cuerpo se desmonta.
    } catch (e) {
      toast.error((e as Error).message || "No se pudo crear la factura");
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Nueva factura · {patientName}</DialogTitle>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto min-h-0 px-6 pb-4 space-y-4">
        {/* Conceptos */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold">Conceptos</h3>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setShowSearch((s) => !s)}
                className="text-[11px] font-semibold text-brand-700 dark:text-brand-300 inline-flex items-center gap-1">
                <Search size={13} /> Del tarifario
              </button>
              <button type="button" onClick={addBlank}
                className="text-[11px] font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                <Plus size={13} /> Línea libre
              </button>
            </div>
          </div>

          {showSearch && (
            <div className="border border-border rounded-lg p-2 bg-muted/30">
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar procedimiento…"
                className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm"
              />
              <div className="mt-2 max-h-56 overflow-y-auto divide-y divide-border">
                {filtered.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3 text-center">Sin coincidencias en el tarifario.</p>
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
              Agrega conceptos desde el tarifario o como línea libre.
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
                        placeholder="Concepto"
                        className="flex-1 min-w-0 bg-transparent border-b border-border px-1 py-1 text-sm font-medium focus:border-brand-500 outline-none"
                      />
                      <button type="button" onClick={() => removeItem(it.key)}
                        className="p-1 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex-shrink-0">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <Field label="Cant.">
                        <input type="number" min={1} value={it.quantity}
                          onChange={(e) => patchItem(it.key, { quantity: Math.max(1, Math.floor(num(e.target.value))) })}
                          className={inputCls} />
                      </Field>
                      <Field label="P. unitario">
                        <input type="number" min={0} step="0.01" value={it.unitPrice}
                          onChange={(e) => patchItem(it.key, { unitPrice: num(e.target.value) })}
                          className={inputCls} />
                      </Field>
                      <Field label="Descuento">
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

        {/* Doctor + Descuento global + IVA + Notas */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Doctor</label>
              <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}
                className="mt-1 w-full bg-background border border-border rounded-lg px-2 py-2 text-sm">
                <option value="">Sin asignar</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Descuento global</label>
              <div className="flex items-center gap-1.5 mt-1">
                <select value={discountMode} onChange={(e) => setDiscountMode(e.target.value as "none" | "pct" | "amount")}
                  className="bg-background border border-border rounded-lg px-2 py-2 text-sm">
                  <option value="none">Sin descuento</option>
                  <option value="pct">Porcentaje %</option>
                  <option value="amount">Monto $</option>
                </select>
                {discountMode !== "none" && (
                  <input type="number" min={0} step="0.01" value={discountValue}
                    onChange={(e) => setDiscountValue(num(e.target.value))}
                    className="w-28 bg-background border border-border rounded-lg px-3 py-2 text-sm" />
                )}
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">IVA (%)</label>
              <input type="number" min={0} max={100} step="0.01" value={taxRate}
                onChange={(e) => setTaxRate(Math.min(100, Math.max(0, num(e.target.value))))}
                className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex sm:items-end">
              <label className="inline-flex items-center gap-2 text-sm font-medium cursor-pointer select-none py-2">
                <input type="checkbox" checked={taxIncluded}
                  onChange={(e) => setTaxIncluded(e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-brand-600" />
                El precio ya incluye IVA
              </label>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Notas</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Opcional"
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
      </div>

      {/* Totales + acciones (footer fijo, siempre visible) */}
      <DialogFooter className="flex-col items-stretch gap-3">
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex justify-between w-full max-w-xs text-xs text-muted-foreground">
            <span>Subtotal</span><span>{money(totals.subtotal)}</span>
          </div>
          {totals.discountAmount > 0 && (
            <div className="flex justify-between w-full max-w-xs text-xs text-muted-foreground">
              <span>Descuento</span><span>-{money(totals.discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between w-full max-w-xs text-xs text-muted-foreground">
            <span>IVA {round2(taxRate)}%{taxIncluded ? " (incluido)" : ""}</span><span>{money(tax)}</span>
          </div>
          <div className="flex justify-between w-full max-w-xs text-base font-bold text-brand-700 dark:text-brand-300 pt-1">
            <span>Total</span><span>{money(grandTotal)}</span>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="text-xs font-semibold px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted/50">
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={saving}
            className="text-xs font-semibold px-4 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 inline-flex items-center gap-1.5">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Crear factura
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
