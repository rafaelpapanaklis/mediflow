"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  FileText, Plus, Loader2, Trash2, Copy, Check, Download, Send,
  CheckCircle2, XCircle, Pencil, Files, ReceiptText, ClipboardList, Search,
} from "lucide-react";
import { computeTotals } from "@/lib/quotes/compute";
import type { QuoteDTO, QuoteStatus, QuoteItemInput } from "@/lib/quotes/types";

function money(n: number): string {
  const v = isFinite(Number(n)) ? Number(n) : 0;
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(v);
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

const STATUS_CFG: Record<QuoteStatus, { label: string; cls: string }> = {
  DRAFT:     { label: "Borrador",  cls: "bg-muted text-muted-foreground border-border" },
  PRESENTED: { label: "Presentado", cls: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800" },
  ACCEPTED:  { label: "Aceptado",  cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800" },
  REJECTED:  { label: "Rechazado", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800" },
  EXPIRED:   { label: "Vencido",   cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800" },
};

interface CatalogProcedure { id: string; name: string; basePrice: number; category?: string }

interface EditorItem {
  key: string;
  procedureId: string | null;
  name: string;
  toothFdi: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  phase: string; // "" o número
  notes: string;
}

let _seq = 0;
function newKey(): string { _seq += 1; return `it-${_seq}`; }

// Prellenado opcional para abrir el editor desde otra superficie (ej. odontograma).
export interface QuotePrefill {
  title?: string;
  items?: Array<Partial<QuoteItemInput>>;
}

interface QuotesTabProps {
  patientId: string;
  /** Si viene, abre el editor directamente con estos conceptos. */
  prefill?: QuotePrefill | null;
}

export function QuotesTab({ patientId, prefill }: QuotesTabProps) {
  const [quotes, setQuotes] = useState<QuoteDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<QuoteDTO | null>(null);
  const [initialItems, setInitialItems] = useState<QuotePrefill | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/quotes?patientId=${encodeURIComponent(patientId)}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setQuotes(Array.isArray(data) ? data : []);
    } catch {
      setQuotes([]);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  // Abrir editor con prefill (una sola vez).
  const prefillDone = useRef(false);
  useEffect(() => {
    if (prefill && !prefillDone.current) {
      prefillDone.current = true;
      setEditing(null);
      setInitialItems(prefill);
      setEditorOpen(true);
    }
  }, [prefill]);

  function openNew() { setEditing(null); setInitialItems(null); setEditorOpen(true); }
  function openEdit(q: QuoteDTO) { setEditing(q); setInitialItems(null); setEditorOpen(true); }
  function closeEditor() { setEditorOpen(false); setEditing(null); setInitialItems(null); }

  async function onSaved() {
    closeEditor();
    setLoading(true);
    await load();
  }

  if (editorOpen) {
    return (
      <QuoteEditor
        patientId={patientId}
        editing={editing}
        prefill={initialItems}
        onCancel={closeEditor}
        onSaved={onSaved}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold flex items-center gap-2">
          <FileText size={15} className="text-brand-600" /> Presupuestos
        </h2>
        <button
          type="button"
          onClick={openNew}
          className="text-xs font-semibold bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 flex items-center gap-1.5"
        >
          <Plus size={14} /> Nuevo presupuesto
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-brand-600" size={24} />
        </div>
      ) : quotes.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground">
          <FileText size={28} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm font-semibold">Aún no hay presupuestos</p>
          <p className="text-xs mt-1">Crea uno con los conceptos del tarifario y compártelo con el paciente.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {quotes.map((q) => (
            <QuoteCard key={q.id} quote={q} onChanged={load} onEdit={() => openEdit(q)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tarjeta de un presupuesto + acciones
// ---------------------------------------------------------------------------

function QuoteCard({ quote, onChanged, onEdit }: { quote: QuoteDTO; onChanged: () => Promise<void> | void; onEdit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const cfg = STATUS_CFG[quote.status] ?? STATUS_CFG.DRAFT;

  const post = useCallback(async (url: string, body?: unknown) => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? "Error");
      await onChanged();
      return out;
    } catch (e) {
      setMsg((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [onChanged]);

  async function del() {
    if (!confirm(`¿Eliminar el presupuesto ${quote.folio}?`)) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/quotes/${quote.id}`, { method: "DELETE" });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? "Error");
      await onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!quote.acceptToken) return;
    const url = `${window.location.origin}/presupuesto/${quote.acceptToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMsg("No se pudo copiar; copia manual: " + url);
    }
  }

  const Btn = ({ onClick, children, tone = "default" as "default" | "primary" | "danger" | "success" }) => {
    const tones: Record<string, string> = {
      default: "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
      primary: "border-brand-200 text-brand-700 hover:bg-brand-50 dark:border-brand-800 dark:text-brand-300 dark:hover:bg-brand-950/40",
      danger: "border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/30",
      success: "border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30",
    };
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onClick}
        className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 ${tones[tone]}`}
      >
        {children}
      </button>
    );
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs font-bold text-muted-foreground">{quote.folio}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.cls}`}>{cfg.label}</span>
            {quote.invoiceId && (
              <span className="text-[10px] font-semibold text-emerald-600 inline-flex items-center gap-1"><ReceiptText size={11} /> Facturado</span>
            )}
            {quote.treatmentPlanId && (
              <span className="text-[10px] font-semibold text-brand-600 inline-flex items-center gap-1"><ClipboardList size={11} /> Plan creado</span>
            )}
          </div>
          <div className="font-bold text-sm mt-1 truncate">{quote.title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {quote.items.length} concepto{quote.items.length === 1 ? "" : "s"}
            {quote.validUntil ? ` · vence ${fmtDate(quote.validUntil)}` : ""}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-lg font-bold text-foreground">{money(quote.total)}</div>
          {quote.discountAmount > 0 && (
            <div className="text-[11px] text-muted-foreground">desc. {money(quote.discountAmount)}</div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {/* PDF siempre disponible */}
        <a
          href={`/api/quotes/${quote.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 inline-flex items-center gap-1.5"
        >
          <Download size={12} /> PDF
        </a>

        {(quote.status === "DRAFT" || quote.status === "PRESENTED") && (
          <Btn onClick={onEdit} tone="default"><Pencil size={12} /> Editar</Btn>
        )}

        {quote.status === "DRAFT" && (
          <Btn onClick={() => post(`/api/quotes/${quote.id}/status`, { action: "present" })} tone="primary">
            <Send size={12} /> Presentar
          </Btn>
        )}

        {quote.status === "PRESENTED" && (
          <>
            <Btn onClick={copyLink} tone="primary">
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "¡Copiada!" : "Copiar liga"}
            </Btn>
            <Btn onClick={() => post(`/api/quotes/${quote.id}/status`, { action: "accept" })} tone="success">
              <CheckCircle2 size={12} /> Aceptado
            </Btn>
            <Btn onClick={() => post(`/api/quotes/${quote.id}/status`, { action: "reject" })} tone="danger">
              <XCircle size={12} /> Rechazado
            </Btn>
          </>
        )}

        {quote.status === "EXPIRED" && (
          <Btn onClick={() => post(`/api/quotes/${quote.id}/status`, { action: "present" })} tone="primary">
            <Send size={12} /> Re-presentar
          </Btn>
        )}

        {quote.status === "ACCEPTED" && (
          <>
            <Btn onClick={() => post(`/api/quotes/${quote.id}/invoice`)} tone="success">
              <ReceiptText size={12} /> {quote.invoiceId ? "Ver factura" : "Generar factura"}
            </Btn>
            <Btn onClick={() => post(`/api/quotes/${quote.id}/treatment-plan`)} tone="primary">
              <ClipboardList size={12} /> {quote.treatmentPlanId ? "Ver plan" : "Crear plan"}
            </Btn>
          </>
        )}

        <Btn onClick={() => post(`/api/quotes/${quote.id}/duplicate`)} tone="default"><Files size={12} /> Duplicar</Btn>

        {quote.status === "DRAFT" && (
          <Btn onClick={del} tone="danger"><Trash2 size={12} /> Eliminar</Btn>
        )}
      </div>

      {msg && <p className="text-[11px] text-rose-600 mt-2">{msg}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor de presupuesto
// ---------------------------------------------------------------------------

function toEditorItems(prefill: QuotePrefill | null, editing: QuoteDTO | null): EditorItem[] {
  if (editing) {
    return editing.items.map((it) => ({
      key: newKey(),
      procedureId: it.procedureId,
      name: it.name,
      toothFdi: it.toothFdi ?? "",
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      discount: it.discount,
      phase: it.phase == null ? "" : String(it.phase),
      notes: it.notes ?? "",
    }));
  }
  if (prefill?.items?.length) {
    return prefill.items.map((it) => ({
      key: newKey(),
      procedureId: it.procedureId ?? null,
      name: it.name ?? "",
      toothFdi: it.toothFdi ?? "",
      quantity: Number(it.quantity) || 1,
      unitPrice: Number(it.unitPrice) || 0,
      discount: Number(it.discount) || 0,
      phase: it.phase == null ? "" : String(it.phase),
      notes: it.notes ?? "",
    }));
  }
  return [];
}

function QuoteEditor({
  patientId, editing, prefill, onCancel, onSaved,
}: {
  patientId: string;
  editing: QuoteDTO | null;
  prefill: QuotePrefill | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(editing?.title ?? prefill?.title ?? "Presupuesto");
  const [items, setItems] = useState<EditorItem[]>(() => toEditorItems(prefill, editing));
  const [discountMode, setDiscountMode] = useState<"none" | "pct" | "amount">(
    editing?.discountPct != null ? "pct" : (editing && editing.discountAmount > 0 ? "amount" : "none"),
  );
  const [discountValue, setDiscountValue] = useState<number>(
    editing?.discountPct != null ? editing.discountPct : (editing?.discountAmount ?? 0),
  );
  const [validUntil, setValidUntil] = useState<string>(() => {
    const base = editing?.validUntil ? new Date(editing.validUntil) : new Date(Date.now() + 30 * 86400000);
    return isNaN(base.getTime()) ? "" : base.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tarifario para el autocomplete
  const [catalog, setCatalog] = useState<CatalogProcedure[]>([]);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    fetch("/api/procedures")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setCatalog(Array.isArray(d) ? d.map((p: { id: string; name: string; basePrice: number; category?: string }) => ({ id: p.id, name: p.name, basePrice: Number(p.basePrice) || 0, category: p.category })) : []))
      .catch(() => setCatalog([]));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const base = q ? catalog.filter((p) => p.name.toLowerCase().includes(q)) : catalog;
    return base.slice(0, 30);
  }, [catalog, search]);

  const totals = useMemo(() => {
    const asInput: QuoteItemInput[] = items.map((it) => ({
      procedureId: it.procedureId,
      name: it.name,
      toothFdi: it.toothFdi,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      discount: it.discount,
      phase: it.phase === "" ? null : Number(it.phase),
      notes: it.notes,
    }));
    return computeTotals(asInput, {
      discountPct: discountMode === "pct" ? discountValue : null,
      discountAmount: discountMode === "amount" ? discountValue : null,
    });
  }, [items, discountMode, discountValue]);

  function addProcedure(p: CatalogProcedure) {
    setItems((prev) => [...prev, {
      key: newKey(), procedureId: p.id, name: p.name, toothFdi: "",
      quantity: 1, unitPrice: p.basePrice, discount: 0, phase: "", notes: "",
    }]);
    setSearch("");
    setShowSearch(false);
  }
  function addBlank() {
    setItems((prev) => [...prev, {
      key: newKey(), procedureId: null, name: "", toothFdi: "",
      quantity: 1, unitPrice: 0, discount: 0, phase: "", notes: "",
    }]);
  }
  function patchItem(key: string, patch: Partial<EditorItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }
  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  async function save() {
    const clean = items.filter((it) => it.name.trim().length > 0);
    if (clean.length === 0) { setError("Agrega al menos un concepto con nombre."); return; }
    setSaving(true); setError(null);
    const payload = {
      patientId,
      title: title.trim() || "Presupuesto",
      items: clean.map((it) => ({
        procedureId: it.procedureId,
        name: it.name.trim(),
        toothFdi: it.toothFdi.trim() || null,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discount: it.discount,
        phase: it.phase === "" ? null : Number(it.phase),
        notes: it.notes.trim() || null,
      })),
      discountPct: discountMode === "pct" ? discountValue : null,
      discountAmount: discountMode === "amount" ? discountValue : null,
      validUntil: validUntil ? new Date(validUntil).toISOString() : null,
      notes: notes.trim() || null,
    };
    try {
      const res = await fetch(editing ? `/api/quotes/${editing.id}` : "/api/quotes", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? "No se pudo guardar");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const num = (v: string) => {
    const n = Number(v);
    return isFinite(n) ? n : 0;
  };

  const inputCls = "w-full bg-background border border-border rounded-lg px-2 py-1.5 text-sm";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">{editing ? `Editar ${editing.folio}` : "Nuevo presupuesto"}</h2>
        <button type="button" onClick={onCancel} className="text-xs font-semibold text-muted-foreground hover:text-foreground">
          Cancelar
        </button>
      </div>

      {/* Título */}
      <div className="bg-card border border-border rounded-xl p-4">
        <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Título</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
          placeholder="Ej. Rehabilitación integral"
        />
      </div>

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
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2">
                    <Field label="Dientes FDI">
                      <input value={it.toothFdi} onChange={(e) => patchItem(it.key, { toothFdi: e.target.value })}
                        placeholder="11,12" className={inputCls} />
                    </Field>
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
                    <Field label="Fase">
                      <input type="number" min={1} value={it.phase}
                        onChange={(e) => patchItem(it.key, { phase: e.target.value })}
                        placeholder="—" className={inputCls} />
                    </Field>
                  </div>
                  <div className="flex items-center justify-between mt-2 gap-2">
                    <input value={it.notes} onChange={(e) => patchItem(it.key, { notes: e.target.value })}
                      placeholder="Nota (opcional)"
                      className="flex-1 min-w-0 bg-transparent text-xs text-muted-foreground border-b border-transparent focus:border-border px-1 py-0.5 outline-none" />
                    <span className="text-sm font-bold whitespace-nowrap">{money(line ? line.lineTotal : 0)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Descuento global + vigencia + notas */}
      <div className="bg-card border border-border rounded-xl p-4 grid sm:grid-cols-2 gap-4">
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
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Vigencia</label>
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)}
            className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="sm:col-span-2">
          <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Notas</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="Condiciones, formas de pago, etc."
            className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm resize-y" />
        </div>
      </div>

      {/* Totales + guardar */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex flex-col items-end gap-0.5 mb-3">
          <div className="flex justify-between w-full max-w-xs text-xs text-muted-foreground">
            <span>Subtotal</span><span>{money(totals.subtotal)}</span>
          </div>
          {totals.discountAmount > 0 && (
            <div className="flex justify-between w-full max-w-xs text-xs text-muted-foreground">
              <span>Descuento</span><span>-{money(totals.discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between w-full max-w-xs text-base font-bold text-brand-700 dark:text-brand-300 pt-1">
            <span>Total</span><span>{money(totals.total)}</span>
          </div>
        </div>

        {error && <p className="text-xs text-rose-600 mb-2 text-right">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="text-xs font-semibold px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted/50">
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={saving}
            className="text-xs font-semibold px-4 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 inline-flex items-center gap-1.5">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {editing ? "Guardar cambios" : "Crear presupuesto"}
          </button>
        </div>
      </div>
    </div>
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
