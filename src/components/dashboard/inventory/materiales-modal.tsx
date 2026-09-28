"use client";

// «Materiales» (receta) de UN procedimiento del catálogo (ws1-t5) — qué
// insumos y cuánto gasta una realización. Se descuenta solo, por FEFO, al
// registrar la sesión que use este procedimiento.
//
// Componente propio y aislado: procedures-client.tsx (que tocan varias
// pantallas) solo recibe un botón y un `useState` nuevos.

import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import toast from "react-hot-toast";
import { Loader2, Plus, Trash2, X } from "lucide-react";

interface Linea {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
}

interface InsumoOpcion {
  id: string;
  name: string;
  unit: string;
}

export function MaterialesModal({
  procedureId, procedureName, onClose,
}: {
  procedureId: string;
  procedureName: string;
  onClose: () => void;
}) {
  const [lineas, setLineas] = useState<Linea[] | null>(null);
  const [insumos, setInsumos] = useState<InsumoOpcion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [nuevo, setNuevo] = useState({ itemId: "", quantity: "" });

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [resReceta, resInsumos] = await Promise.all([
        fetch(`/api/procedures/${procedureId}/materials`),
        fetch(`/api/inventory`),
      ]);
      const receta = await resReceta.json();
      const items  = await resInsumos.json();
      setLineas(receta.lines ?? []);
      setInsumos((items ?? []).map((i: any) => ({ id: i.id, name: i.name, unit: i.unit })));
    } catch {
      toast.error("No se pudo cargar la receta de materiales");
      setLineas([]);
    } finally {
      setCargando(false);
    }
  }, [procedureId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function agregarLinea() {
    const quantity = Number(nuevo.quantity);
    if (!nuevo.itemId) { toast.error("Elige un insumo"); return; }
    if (!(quantity > 0)) { toast.error("La cantidad debe ser mayor a 0"); return; }
    setGuardando(true);
    try {
      const res = await fetch(`/api/procedures/${procedureId}/materials`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: nuevo.itemId, quantity }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "No se pudo guardar"); return; }
      setLineas(data.lines);
      setNuevo({ itemId: "", quantity: "" });
    } catch {
      toast.error("No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function quitarLinea(itemId: string) {
    try {
      const res = await fetch(`/api/procedures/${procedureId}/materials?itemId=${encodeURIComponent(itemId)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "No se pudo quitar"); return; }
      setLineas(data.lines);
    } catch {
      toast.error("No se pudo quitar");
    }
  }

  const disponibles = insumos.filter(i => !(lineas ?? []).some(l => l.itemId === i.id));

  return (
    <Dialog.Root open onOpenChange={v => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        {/* Ajuste 3 (ws1-t5) — ver la misma nota en lotes-modal.tsx: sin este
            `position: fixed` propio, Dialog.Content queda en flujo normal
            (el grid de .modal-overlay solo centra a sus hijos directos, y
            Content es hermano de Overlay dentro del Portal). */}
        <Dialog.Content
          className="modal"
          style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            maxWidth: 560, width: "calc(100vw - 32px)", maxHeight: "90vh", zIndex: 101,
          }}
          onEscapeKeyDown={onClose}
        >
          <div className="modal__header">
            <Dialog.Title className="modal__title">Materiales — {procedureName}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label="Cerrar">
                <X size={18} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="modal__body">
            <p style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 12 }}>
              Qué insumos y cuánto gasta UNA realización de este procedimiento. Al registrar la
              sesión que lo use, se descuenta solo (por lote, primero el que caduca antes).
            </p>

            {cargando ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
                <Loader2 size={20} className="animate-spin" aria-hidden />
              </div>
            ) : (
              <>
                {(lineas ?? []).length === 0 ? (
                  <p style={{ color: "var(--text-3)", fontSize: 13.5, marginBottom: 12 }}>Sin receta capturada todavía.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                    {(lineas ?? []).map(l => (
                      <div key={l.itemId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border-1)" }}>
                        <span style={{ fontSize: 13.5 }}>{l.itemName}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span className="mono" style={{ fontSize: 13, color: "var(--text-2)" }}>{l.quantity} {l.unit}</span>
                          <button type="button" onClick={() => quitarLinea(l.itemId)} className="btn-new btn-new--ghost btn-new--sm" style={{ padding: 0, width: 24, color: "var(--danger)" }} aria-label="Quitar">
                            <Trash2 size={14} aria-hidden />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 100px auto", gap: 8, alignItems: "end", borderTop: "1px solid var(--border-1)", paddingTop: 12 }}>
                  <div className="field-new">
                    <label className="field-new__label">Insumo</label>
                    <select className="input-new" value={nuevo.itemId} onChange={e => setNuevo(f => ({ ...f, itemId: e.target.value }))}>
                      <option value="">Elige…</option>
                      {disponibles.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                    </select>
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Cantidad</label>
                    <input type="number" min={0} step="0.001" className="input-new mono" value={nuevo.quantity} onChange={e => setNuevo(f => ({ ...f, quantity: e.target.value }))} />
                  </div>
                  <button type="button" onClick={agregarLinea} disabled={guardando} className="btn-new btn-new--primary" style={{ height: 36 }}>
                    {guardando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />}
                  </button>
                </div>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
