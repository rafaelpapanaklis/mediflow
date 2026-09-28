"use client";

// «Lotes» de un artículo (ws1-t5) — lotes, caducidad y baja por caducado.
// Componente propio y aislado a propósito: así el archivo grande de
// inventory-client.tsx (que tocan varias pantallas de esta ola) solo recibe
// un botón y un `useState` nuevos, nada más.

import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import toast from "react-hot-toast";
import { Info, Loader2, Package, Plus, Trash2, X } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
// Diseño (ws1-t5): la ropa de la ventana y la maqueta de la lista. Antes los
// bordes pedían `--border-1`, que no existe: las filas salían sin borde.
import inv from "@/components/dashboard/cobros-inventario-rediseno/inventario.module.css";
import { ropaVentana } from "@/components/dashboard/cobros-inventario-rediseno/ventana";

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
    return <span className={`${inv.pildora} ${inv.pildoraPeligro}`}>Caducado</span>;
  }
  if (estado === "por_caducar") {
    return <span className={`${inv.pildora} ${inv.pildoraAlerta}`}>Por caducar</span>;
  }
  return <span className={`${inv.pildora} ${inv.pildoraExito}`}>Vigente</span>;
}

export function LotesModal({
  itemId, itemName, unit, onClose, rediseno = false,
}: {
  itemId: string;
  itemName: string;
  unit: string;
  onClose: () => void;
  /** ¿Diseño nuevo? Solo decide la ropa de la ventana. */
  rediseno?: boolean;
}) {
  const ropa = ropaVentana(rediseno, "media");
  const askConfirm = useConfirm();
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
    // Diseño (ws1-t5): la confirmación del panel en vez de la caja gris del
    // navegador. Misma pregunta, mismo sí/no y el mismo efecto al aceptar.
    if (!(await askConfirm({
      title: "¿Dar de baja este lote por caducado?",
      description: "Se descuenta de existencias y no se puede deshacer.",
      variant: "danger",
      confirmText: "Dar de baja",
    }))) return;
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
        <Dialog.Overlay className={ropa.velo} />
        {/* Ajuste 3 — .modal-overlay centra por CSS grid a sus HIJOS; Dialog.Content
            es hermano de Dialog.Overlay dentro del Portal, así que la caja se
            centra ella sola (`position: fixed`). Eso lo pone ahora la ropa
            (`ropaVentana`), igual que en el resto de ventanas de Inventario. */}
        <Dialog.Content className={ropa.caja} aria-describedby={undefined} onEscapeKeyDown={onClose}>
          <div className="modal__header">
            <Dialog.Title className="modal__title">
              <span className={inv.tituloTextos}>
                Lotes y caducidad
                <span className={inv.tituloSub}>{itemName}</span>
              </span>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label="Cerrar">
                <X size={16} strokeWidth={1.75} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="modal__body">
            {cargando ? (
              // Alto reservado: la ventana no crece de golpe al llegar los lotes.
              <div className={inv.espera} role="status">
                <Loader2 size={20} className="animate-spin" aria-hidden />
                Cargando lotes…
              </div>
            ) : (
              <>
                {(lotes ?? []).length === 0 ? (
                  <div className={`${inv.espera} ${inv.esperaCorta}`}>
                    <p className={inv.esperaTitulo}>Este artículo todavía no tiene lotes</p>
                    <p className={inv.esperaTexto}>Registra el primero aquí abajo, o captura lote y caducidad al registrar una compra.</p>
                  </div>
                ) : (
                  <ul className={inv.renglones}>
                    {(lotes ?? []).map(l => (
                      <li key={l.id} className={`${inv.renglon} ${l.estado === "caducado" ? inv.renglonPeligro : ""}`}>
                        <Package size={16} strokeWidth={1.75} aria-hidden className={inv.renglonIcono} />
                        <div className={inv.renglonTextos}>
                          <div className={inv.renglonTitulo}>
                            {l.lotNumber ?? "Sin lote"}
                            {l.expiresAt && <span className={inv.renglonApagado}> · caduca {fmtFecha(l.expiresAt)}</span>}
                          </div>
                          <div className={inv.renglonDetalle}>
                            {l.remaining} {unit} restantes de {l.quantity}
                            {l.unitCost != null && ` · costo ${l.unitCost.toFixed(2)}/u`}
                          </div>
                        </div>
                        <div className={inv.renglonFin}>
                          <EstadoPill estado={l.estado} />
                          {l.estado === "caducado" && l.remaining > 0 && (
                            <button
                              type="button"
                              onClick={() => darDeBaja(l.id)}
                              className={`${inv.accion} ${inv.accionBorrar}`}
                              aria-label={`Dar de baja el lote ${l.lotNumber ?? "sin número"} (pérdida)`}
                              title="Dar de baja (pérdida)"
                            >
                              <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <div className={inv.altaRapida}>
                  <p className={inv.altaRapidaTitulo}>
                    Registrar lote nuevo <span className={inv.altaRapidaPista}>· suma a existencias</span>
                  </p>
                  <div className={inv.formLote}>
                    <div className="field-new">
                      <label className="field-new__label" htmlFor="lote-numero">Número de lote</label>
                      <input id="lote-numero" className="input-new" value={form.lotNumber} onChange={e => setForm(f => ({ ...f, lotNumber: e.target.value }))} placeholder="Opcional" />
                    </div>
                    <div className="field-new">
                      <label className="field-new__label" htmlFor="lote-caduca">Caduca</label>
                      <input id="lote-caduca" type="date" className="input-new" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
                    </div>
                    <div className="field-new">
                      <label className="field-new__label" htmlFor="lote-cantidad">Cantidad ({unit})</label>
                      <input id="lote-cantidad" type="number" min={0} step="0.001" inputMode="decimal" className={`input-new ${inv.cifra}`} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
                    </div>
                    <ButtonNew
                      variant="primary"
                      type="button"
                      onClick={registrarLote}
                      disabled={guardando}
                      icon={guardando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} strokeWidth={1.75} aria-hidden />}
                    >
                      Registrar
                    </ButtonNew>
                  </div>
                  {!form.expiresAt && (
                    <p className={inv.pista}>
                      <Info size={13} strokeWidth={1.75} aria-hidden />
                      Sin fecha de caducidad no entra en los avisos de &ldquo;por caducar&rdquo;.
                    </p>
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
