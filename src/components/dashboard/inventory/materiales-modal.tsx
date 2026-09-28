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
import { ButtonNew } from "@/components/ui/design-system/button-new";
// Diseño (ws1-t5): la ropa de la ventana y la maqueta de la lista. Antes los
// bordes pedían `--border-1`, que no existe: las filas salían sin borde.
import inv from "@/components/dashboard/cobros-inventario-rediseno/inventario.module.css";
import { ropaVentana } from "@/components/dashboard/cobros-inventario-rediseno/ventana";
import { useRedisenoActivo } from "@/components/dashboard/cobros-inventario-rediseno/rediseno-activo";

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
  procedureId, procedureName, onClose, rediseno,
}: {
  procedureId: string;
  procedureName: string;
  onClose: () => void;
  /**
   * ¿Diseño nuevo? Solo decide la ropa de la ventana. Esta ventana la abre
   * Procedimientos, que no es de este trabajo y no lo pasa: si no llega, se
   * mira si el panel está en el diseño nuevo (`useRedisenoActivo`).
   */
  rediseno?: boolean;
}) {
  const redisenoDetectado = useRedisenoActivo();
  const ropa = ropaVentana(rediseno ?? redisenoDetectado);
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
        <Dialog.Overlay className={ropa.velo} />
        {/* Ajuste 3 (ws1-t5) — ver la misma nota en lotes-modal.tsx: la caja
            se centra ella sola, y eso lo pone ahora la ropa (`ropaVentana`). */}
        <Dialog.Content className={ropa.caja} aria-describedby={undefined} onEscapeKeyDown={onClose}>
          <div className="modal__header">
            {/* B10 de la QA de ws1-t10: el título y el subtítulo son dos nodos de
                texto pegados ("Materiales" + span sin espacio de por medio), así
                que el nombre accesible salía "MaterialesQA Proc t10". El
                `aria-label` explícito no depende de cómo queden pegados los
                nodos visuales. */}
            <Dialog.Title className="modal__title" aria-label={`Materiales — ${procedureName}`}>
              <span className={inv.tituloTextos} aria-hidden>
                Materiales
                <span className={inv.tituloSub}>{procedureName}</span>
              </span>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label="Cerrar">
                <X size={16} strokeWidth={1.75} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="modal__body">
            <p className={inv.texto}>
              Qué insumos y cuánto gasta UNA realización de este procedimiento. Al registrar la
              sesión que lo use, se descuenta solo (por lote, primero el que caduca antes).
            </p>

            {cargando ? (
              // Alto reservado: la ventana no crece de golpe al llegar la receta.
              <div className={inv.espera} role="status">
                <Loader2 size={20} className="animate-spin" aria-hidden />
                Cargando receta…
              </div>
            ) : (
              <>
                {(lineas ?? []).length === 0 ? (
                  <div className={`${inv.espera} ${inv.esperaCorta}`}>
                    <p className={inv.esperaTitulo}>Sin receta capturada todavía</p>
                    <p className={inv.esperaTexto}>Agrega el primer insumo aquí abajo.</p>
                  </div>
                ) : (
                  <ul className={inv.renglones}>
                    {(lineas ?? []).map(l => (
                      <li key={l.itemId} className={inv.renglon}>
                        <div className={inv.renglonTextos}>
                          <div className={inv.renglonTitulo}>{l.itemName}</div>
                        </div>
                        <div className={inv.renglonFin}>
                          <span className={inv.renglonCifra}>{l.quantity} {l.unit}</span>
                          <button type="button" onClick={() => quitarLinea(l.itemId)} className={`${inv.accion} ${inv.accionBorrar}`} aria-label={`Quitar ${l.itemName}`} title="Quitar">
                            <Trash2 size={16} strokeWidth={1.75} aria-hidden />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <div className={inv.altaRapida}>
                  <div className={inv.formReceta}>
                    <div className="field-new">
                      <label className="field-new__label" htmlFor="receta-insumo">Insumo</label>
                      <select id="receta-insumo" className="input-new" value={nuevo.itemId} onChange={e => setNuevo(f => ({ ...f, itemId: e.target.value }))}>
                        <option value="">Elige…</option>
                        {disponibles.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                      </select>
                    </div>
                    <div className="field-new">
                      <label className="field-new__label" htmlFor="receta-cantidad">Cantidad</label>
                      <input id="receta-cantidad" type="number" min={0} step="0.001" inputMode="decimal" className={`input-new ${inv.cifra}`} value={nuevo.quantity} onChange={e => setNuevo(f => ({ ...f, quantity: e.target.value }))} />
                    </div>
                    <ButtonNew
                      variant="primary"
                      type="button"
                      onClick={agregarLinea}
                      disabled={guardando}
                      icon={guardando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} strokeWidth={1.75} aria-hidden />}
                    >
                      Agregar
                    </ButtonNew>
                  </div>
                </div>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
