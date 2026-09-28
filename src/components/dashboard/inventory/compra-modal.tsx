"use client";

// "Registrar compra" (ws1-t4) — entrada de inventario: suma existencias,
// actualiza el costo (último) y crea el gasto "Insumos" ligado, en una sola
// transacción del servidor (src/lib/inventory/compras.server.ts).
//
// Componente propio y aislado a propósito (mismo criterio que LotesModal de
// ws1-t5): así inventory-client.tsx, que tocan varias pantallas de esta ola,
// solo recibe un botón y un `useState` nuevos.

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import toast from "react-hot-toast";
import { Plus, Trash2, X } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fmtMXN } from "@/lib/format";
// Diseño (ws1-t5): la ropa de la ventana y la maqueta de las líneas.
import inv from "@/components/dashboard/cobros-inventario-rediseno/inventario.module.css";
import { ropaVentana } from "@/components/dashboard/cobros-inventario-rediseno/ventana";

interface ItemOpcion { id: string; name: string; unit: string; }
interface ProveedorOpcion { id: string; name: string; }
interface LineaForm { itemId: string; quantity: string; unitCost: string; lotNumber: string; expiresAt: string; }

export interface ResultadoCompra {
  items: { itemId: string; quantity: number; unitCost: number }[];
  expenseId: string | null;
  total: number;
}

const hoyISO = () => new Date().toISOString().slice(0, 10);

export function CompraModal({
  items, proveedores, onRegistrada, onClose, rediseno = false,
}: {
  items: ItemOpcion[];
  proveedores: ProveedorOpcion[];
  onRegistrada: (r: ResultadoCompra) => void;
  onClose: () => void;
  /** ¿Diseño nuevo? Solo decide la ropa de la ventana. */
  rediseno?: boolean;
}) {
  const ropa = ropaVentana(rediseno, "media");
  // Se genera UNA vez por apertura del modal y se reenvía tal cual en un
  // reintento (doble clic) — @@unique([clinicId, idempotencyKey]) en la base
  // descarta el duplicado.
  const [idempotencyKey] = useState(() =>
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  );
  const [providerId, setProviderId] = useState("");
  const [date, setDate] = useState(hoyISO());
  const [receiptRef, setReceiptRef] = useState("");
  const [lines, setLines] = useState<LineaForm[]>([{ itemId: "", quantity: "", unitCost: "", lotNumber: "", expiresAt: "" }]);
  const [guardando, setGuardando] = useState(false);

  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);

  function actualizarLinea(idx: number, patch: Partial<LineaForm>) {
    setLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function agregarLinea() {
    setLines(prev => [...prev, { itemId: "", quantity: "", unitCost: "", lotNumber: "", expiresAt: "" }]);
  }

  function quitarLinea(idx: number) {
    setLines(prev => prev.filter((_, i) => i !== idx));
  }

  async function guardar() {
    const validas = lines.filter(l => l.itemId);
    if (validas.length === 0) { toast.error("Agrega al menos un artículo."); return; }
    for (const l of validas) {
      const qty = Number(l.quantity);
      const cost = Number(l.unitCost);
      if (!Number.isInteger(qty) || qty <= 0) { toast.error(`Cantidad inválida para "${items.find(i => i.id === l.itemId)?.name ?? l.itemId}".`); return; }
      if (!Number.isFinite(cost) || cost < 0) { toast.error(`Costo inválido para "${items.find(i => i.id === l.itemId)?.name ?? l.itemId}".`); return; }
    }

    setGuardando(true);
    try {
      const res = await fetch("/api/inventory/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: providerId || null,
          date,
          receiptRef: receiptRef || null,
          idempotencyKey,
          // WS1-T5 — ajuste 2: lote/caducidad opcionales por línea. Si se
          // capturan, esa línea crea su propio InventoryLot (enlace
          // automático compra→lote); si no, la existencia sigue entrando al
          // colchón "sin lote" como hasta ahora.
          lines: validas.map(l => ({
            itemId: l.itemId, quantity: Number(l.quantity), unitCost: Number(l.unitCost),
            lotNumber: l.lotNumber.trim() || undefined,
            expiresAt: l.expiresAt || undefined,
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error(data?.error ?? "No se pudo registrar la compra."); return; }
      onRegistrada({ items: data.items, expenseId: data.expenseId, total: data.total });
      toast.success(data.yaExistia ? "Esa compra ya estaba registrada." : `Compra registrada — ${fmtMXN(data.total)}`);
      onClose();
    } catch {
      toast.error("No se pudo registrar la compra.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={ropa.velo} />
        <Dialog.Content className={ropa.caja} aria-describedby={undefined}>
          <div className="modal__header">
            <Dialog.Title className="modal__title">Registrar compra</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label="Cerrar">
                <X size={16} strokeWidth={1.75} aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <div className="modal__body">
            <div className={inv.seccion}>
              <div className={inv.rejilla2}>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="compra-proveedor">Proveedor</label>
                  <select id="compra-proveedor" className="input-new" value={providerId} onChange={e => setProviderId(e.target.value)}>
                    <option value="">Sin proveedor</option>
                    {proveedores.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="compra-fecha">Fecha</label>
                  <input id="compra-fecha" type="date" className="input-new" value={date} onChange={e => setDate(e.target.value)} />
                </div>
                <div className={`field-new ${inv.todoElAncho}`}>
                  <label className="field-new__label" htmlFor="compra-folio">Comprobante (folio, opcional)</label>
                  <input id="compra-folio" className="input-new" value={receiptRef} onChange={e => setReceiptRef(e.target.value)}
                    placeholder="Ej: Factura A-1234" />
                </div>
              </div>
            </div>

            <div className={inv.seccion}>
              <div className="form-section__title">
                Líneas de la compra
                <span className="form-section__rule" />
              </div>
              {/* Diseño (ws1-t5): cada línea es una ficha con sus rótulos. Antes
                  eran rejillas sueltas con los rótulos solo en la primera, y a
                  390 el selector de artículo se quedaba en 60 px («Eli»). */}
              <div className={inv.lineas}>
                {lines.map((line, idx) => (
                  <div key={idx} className={inv.linea}>
                    <div className={`field-new ${inv.lineaArticulo}`}>
                      <label className="field-new__label" htmlFor={`compra-articulo-${idx}`}>Artículo</label>
                      <select id={`compra-articulo-${idx}`} className="input-new" value={line.itemId} onChange={e => actualizarLinea(idx, { itemId: e.target.value })}>
                        <option value="">Elige un artículo…</option>
                        {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                      </select>
                    </div>
                    <div className={`field-new ${inv.lineaCantidad}`}>
                      <label className="field-new__label" htmlFor={`compra-cantidad-${idx}`}>Cantidad</label>
                      <input id={`compra-cantidad-${idx}`} type="number" min={1} inputMode="numeric" className={`input-new ${inv.cifra}`} value={line.quantity}
                        onChange={e => actualizarLinea(idx, { quantity: e.target.value })} />
                    </div>
                    <div className={`field-new ${inv.lineaCosto}`}>
                      <label className="field-new__label" htmlFor={`compra-costo-${idx}`}>Costo unit.</label>
                      <input id={`compra-costo-${idx}`} type="number" min={0} step="0.01" inputMode="decimal" className={`input-new ${inv.cifra}`} value={line.unitCost}
                        onChange={e => actualizarLinea(idx, { unitCost: e.target.value })} />
                    </div>
                    <button type="button" onClick={() => quitarLinea(idx)} disabled={lines.length === 1}
                      className={`${inv.accion} ${inv.accionBorrar} ${inv.lineaQuitar}`} aria-label={`Quitar la línea ${idx + 1}`} title="Quitar línea">
                      <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                    </button>
                    {/* WS1-T5 — ajuste 2: lote/caducidad opcionales de esta línea.
                        Si se llenan, esta línea crea su propio lote (FEFO); si
                        no, sigue entrando a "sin lote" como hasta hoy. */}
                    <div className={`field-new ${inv.lineaLote}`}>
                      <label className="field-new__label" htmlFor={`compra-lote-${idx}`}>Lote (opcional)</label>
                      <input id={`compra-lote-${idx}`} className="input-new" value={line.lotNumber} placeholder="Ej: L-2026-08"
                        onChange={e => actualizarLinea(idx, { lotNumber: e.target.value })} />
                    </div>
                    <div className={`field-new ${inv.lineaCaduca}`}>
                      <label className="field-new__label" htmlFor={`compra-caduca-${idx}`}>Caduca (opcional)</label>
                      <input id={`compra-caduca-${idx}`} type="date" className="input-new" value={line.expiresAt}
                        onChange={e => actualizarLinea(idx, { expiresAt: e.target.value })} />
                    </div>
                  </div>
                ))}
              </div>
              <ButtonNew variant="secondary" size="sm" type="button" icon={<Plus size={14} strokeWidth={1.75} aria-hidden />} onClick={agregarLinea}>
                Agregar línea
              </ButtonNew>

              <div className={inv.total}>
                <div>
                  <span className={inv.totalRotulo}>Total de la compra</span>
                  <span className={inv.totalPista}>Se registra como gasto en «Insumos».</span>
                </div>
                <span className={inv.totalCifra}>{fmtMXN(total)}</span>
              </div>
            </div>
          </div>
          <div className="modal__footer">
            <Dialog.Close asChild>
              <ButtonNew variant="ghost" type="button">Cancelar</ButtonNew>
            </Dialog.Close>
            <ButtonNew variant="primary" onClick={guardar} disabled={guardando}>
              {guardando ? "Guardando…" : "Registrar compra"}
            </ButtonNew>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
