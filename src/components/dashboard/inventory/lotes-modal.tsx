"use client";

// «Lotes» de un artículo (ws1-t5) — lotes, caducidad y baja por caducado.
// Componente propio y aislado a propósito: así el archivo grande de
// inventory-client.tsx (que tocan varias pantallas de esta ola) solo recibe
// un botón y un `useState` nuevos, nada más.

import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import toast from "react-hot-toast";
import { AlertTriangle, Loader2, Package, Plus, Trash2, X } from "lucide-react";

const fmtFecha = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));

interface Lote {
  id: string;
  lotNumber: string | null;
  expiresAt: string | null;
  quantity: number;
  remaining: number;
  unitCost: number | null;
  purchaseLineId: string | null;
  createdAt: string;
  estado: "ok" | "por_caducar" | "caducado";
}

function EstadoPill({ estado }: { estado: Lote["estado"] }) {
  if (estado === "caducado") {
    return <span style={pill("var(--danger-soft)", "var(--danger)")}>Caducado</span>;
  }
  if (estado === "por_caducar") {
    return <span style={pill("var(--warning-soft)", "var(--warning-strong)")}>Por caducar</span>;
  }
  return <span style={pill("var(--success-soft)", "var(--success-strong)")}>Vigente</span>;
}

function pill(bg: string, color: string): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, background: bg, color };
}

export function LotesModal({
  itemId, itemName, unit, onClose,
}: {
  itemId: string;
  itemName: string;
  unit: string;
  onClose: () => void;
}) {
  const [lotes, setLotes] = useState<Lote[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState({ lotNumber: "", expiresAt: "", quantity: "" });

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/inventory/${itemId}/lots`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setLotes(data.lots);
    } catch {
      toast.error("No se pudieron cargar los lotes");
      setLotes([]);
    } finally {
      setCargando(false);
    }
  }, [itemId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function registrarLote() {
    const quantity = Number(form.quantity);
    if (!(quantity > 0)) { toast.error("La cantidad debe ser mayor a 0"); return; }
    setGuardando(true);
    try {
      const res = await fetch(`/api/inventory/${itemId}/lots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lotNumber: form.lotNumber.trim() || null,
          expiresAt: form.expiresAt || null,
          quantity,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "No se pudo registrar el lote"); return; }
      toast.success(`Lote registrado: +${quantity} ${unit}`);
      setForm({ lotNumber: "", expiresAt: "", quantity: "" });
      await cargar();
    } catch {
      toast.error("No se pudo registrar el lote");
    } finally {
      setGuardando(false);
    }
  }

  async function darDeBaja(loteId: string) {
    if (!confirm("¿Dar de baja este lote por caducado? Se descuenta de existencias y no se puede deshacer.")) return;
    try {
      const res = await fetch(`/api/inventory/${itemId}/lots/${loteId}/write-off`, { method: "POST" });
      if (!res.ok) { const d = await res.json(); toast.error(d.error ?? "No se pudo dar de baja"); return; }
      toast.success("Lote dado de baja");
      await cargar();
    } catch {
      toast.error("No se pudo dar de baja");
    }
  }

  return (
    <Dialog.Root open onOpenChange={v => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal" style={{ maxWidth: 640 }} onEscapeKeyDown={onClose}>
          <div className="modal__header">
            <Dialog.Title className="modal__title">Lotes — {itemName}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label="Cerrar">
                <X size={18} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="modal__body">
            {cargando ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
                <Loader2 size={20} className="animate-spin" aria-hidden />
              </div>
            ) : (
              <>
                {(lotes ?? []).length === 0 ? (
                  <p style={{ color: "var(--text-3)", fontSize: 13.5 }}>Este artículo todavía no tiene lotes registrados.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                    {(lotes ?? []).map(l => (
                      <div key={l.id} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-1)",
                        background: l.estado === "caducado" ? "var(--danger-soft)" : "transparent",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <Package size={16} aria-hidden style={{ color: "var(--text-3)" }} />
                          <div>
                            <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                              {l.lotNumber ?? "Sin lote"}
                              {l.expiresAt && <span style={{ color: "var(--text-3)", fontWeight: 400 }}> — caduca {fmtFecha(l.expiresAt)}</span>}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                              {l.remaining} {unit} restantes de {l.quantity}
                              {l.unitCost != null && ` · costo ${l.unitCost.toFixed(2)}/u`}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <EstadoPill estado={l.estado} />
                          {l.estado === "caducado" && l.remaining > 0 && (
                            <button
                              type="button"
                              onClick={() => darDeBaja(l.id)}
                              className="btn-new btn-new--ghost btn-new--sm"
                              style={{ color: "var(--danger)" }}
                              title="Dar de baja (pérdida)"
                            >
                              <Trash2 size={14} aria-hidden />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 14 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-2)", marginBottom: 8 }}>
                    Registrar lote nuevo (suma a existencias)
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
                    <div className="field-new">
                      <label className="field-new__label">Número de lote</label>
                      <input className="input-new" value={form.lotNumber} onChange={e => setForm(f => ({ ...f, lotNumber: e.target.value }))} placeholder="Opcional" />
                    </div>
                    <div className="field-new">
                      <label className="field-new__label">Caduca</label>
                      <input type="date" className="input-new" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
                    </div>
                    <div className="field-new">
                      <label className="field-new__label">Cantidad ({unit})</label>
                      <input type="number" min={0} step="0.001" className="input-new mono" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
                    </div>
                    <button type="button" onClick={registrarLote} disabled={guardando} className="btn-new btn-new--primary" style={{ height: 36 }}>
                      {guardando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />}
                    </button>
                  </div>
                  {!form.expiresAt && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12, color: "var(--text-3)" }}>
                      <AlertTriangle size={13} aria-hidden />
                      Sin fecha de caducidad no entra en los avisos de &ldquo;por caducar&rdquo;.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
