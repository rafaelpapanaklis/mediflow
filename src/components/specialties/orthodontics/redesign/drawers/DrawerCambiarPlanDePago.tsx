"use client";
// Ortodoncia — Cobro (ws1-t1, Ola 1): F7, cambiar el plan a mitad del
// tratamiento. Reusa `FormaDePagoFactura` (el mismo bloque de "Forma de
// pago" del editor de facturas y de Presupuestos — ni el dibujo ni la
// aritmética se reinventan) para editar enganche/mensualidades/frecuencia
// de la factura YA CREADA. Guarda con `guardarCondiciones` de siempre (PUT
// /api/invoices/[id]/condiciones) y deja rastro con `auditarCambioDePlan`
// (ese endpoint no audita — hallazgo F7 del reporte de alcance).
//
// El PRECIO no se edita aquí: los conceptos de una factura ya confirmada
// solo se editan en borrador (regla del propio PATCH /api/invoices/[id]).
// Cambiar el precio a mitad de tratamiento es una factura nueva/ajuste, no
// esto.
//
// ws1-t11 (fallo 4 de la revisión final): lo COBRADO no se reescribe. Una
// factura pagada completa no cambia de plan (el cajón lo dice y no ofrece
// guardar) y, con pagos parciales sobre un plan a plazos, lo cobrado queda
// fijo como enganche y solo se reparte lo pendiente. La regla es la del
// servidor (lib/invoices/cambio-de-plan), que rechaza igual si algo se cuela.

import { useState } from "react";
import { Save, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { fmtMoney } from "../atoms/format";
import { FormaDePagoFactura } from "@/components/dashboard/factura-ficha-rediseno/forma-de-pago";
import { guardarCondiciones } from "@/components/dashboard/factura-ficha-rediseno/extras";
import { condicionesPorDefecto, type CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { cobradoDeLaFactura, facturaSaldada } from "@/lib/invoices/cambio-de-plan";
import { auditarCambioDePlan } from "@/app/actions/orthodontics/cobro/auditarCambioDePlan";
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";

export interface DrawerCambiarPlanDePagoProps {
  treatmentPlanId: string;
  invoiceId: string;
  total: number;
  /** `Invoice.paid` y `Invoice.status` de la factura del plan. */
  pagado: number;
  status: string | null;
  condicionesActuales: CondicionesPago | null;
  onClose: () => void;
  onGuardado: () => void;
}

export function DrawerCambiarPlanDePago(props: DrawerCambiarPlanDePagoProps) {
  const cajonRef = useCajon<HTMLElement>(props.onClose);
  const factura = { total: props.total, pagado: props.pagado, status: props.status };
  const saldada = facturaSaldada(factura);
  const cobrado = cobradoDeLaFactura(factura);
  const guardadas = props.condicionesActuales ?? condicionesPorDefecto();
  // Con pagos parciales, lo cobrado ES el enganche: el plan nuevo solo reparte
  // lo pendiente. (El servidor lo exige cuando ya había plan a plazos; aquí
  // también cuando era de un pago, para no repartir lo cobrado entre cuotas.)
  const engancheFijo = !saldada && cobrado > 0;
  const fijar = (c: CondicionesPago): CondicionesPago =>
    engancheFijo && c.modo === "plazos" ? { ...c, enganche: cobrado } : c;
  const original = fijar(guardadas);
  const [cond, setCondLibre] = useState<CondicionesPago>(original);
  const setCond = (c: CondicionesPago) => setCondLibre(fijar(c));
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sinCambios = JSON.stringify(cond) === JSON.stringify(original);

  async function guardar() {
    if (saldada || sinCambios || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await guardarCondiciones(props.invoiceId, cond);
      if (!r.ok) { setError(r.error ?? "No se pudo guardar el nuevo plan"); return; }
      await auditarCambioDePlan({
        treatmentPlanId: props.treatmentPlanId,
        motivo: motivo.trim() || "Sin motivo anotado",
        antes: guardadas,
        despues: cond,
      });
      props.onGuardado();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <div className={orto.velo} onClick={props.onClose} aria-hidden />
      <aside
        ref={cajonRef}
        tabIndex={-1}
        className={orto.cajon}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-cambiar-plan-title"
      >
        <header className={orto.cajonCabeza}>
          <div>
            <div className={orto.cajonCeja}>Cambiar el plan de pago</div>
            <h3 id="drawer-cambiar-plan-title" className={orto.cajonTitulo}>
              Nuevas condiciones de pago
            </h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}>
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="text-xs text-[color:var(--pr-texto-3)]">
            Precio total del tratamiento: <span className="tabular-nums font-semibold text-[color:var(--pr-texto)]">{fmtMoney(props.total)}</span> (no se edita aquí).
          </div>

          {saldada ? (
            <div className={`${orto.aviso} ${orto.avisoAlerta}`} data-plan-pagado>
              <span className={orto.avisoTexto}>
                Esta factura ya está pagada completa ({fmtMoney(cobrado)}): su plan de pago no se puede cambiar. Lo que ya se cobró no se reescribe.
              </span>
            </div>
          ) : (
          <>
          {engancheFijo ? (
            <div className={`${orto.aviso} ${orto.avisoAlerta}`} data-plan-parcial>
              <span className={orto.avisoTexto}>
                Ya se cobraron <strong className="tabular-nums">{fmtMoney(cobrado)}</strong>: eso no se toca y queda como enganche. El plan nuevo solo reparte lo pendiente, <strong className="tabular-nums">{fmtMoney(Math.max(0, props.total - cobrado))}</strong>.
              </span>
            </div>
          ) : null}

          <FormaDePagoFactura cond={cond} total={props.total} onChange={setCond} engancheFijo={engancheFijo && cond.modo === "plazos"} />

          <div>
            <label className="block text-xs font-semibold text-[color:var(--pr-texto-2)] mb-1">Motivo del cambio (queda en la bitácora)</label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              placeholder="Ej. el paciente pidió alargar el plazo a 30 meses"
              className={`${orto.entrada} w-full`}
            />
          </div>
          </>
          )}

          {error ? (
            <div className="bg-[color:var(--pr-peligro-suave)] border border-[color:var(--orto-peligro-borde)] rounded-[10px] p-3 text-xs text-[color:var(--pr-peligro)]">{error}</div>
          ) : null}
        </div>

        <footer className={orto.cajonPie}>
          <Btn variant="ghost" size="md" onClick={props.onClose}>{saldada ? "Cerrar" : "Cancelar"}</Btn>
          {saldada ? null : (
          <Btn variant="emerald" size="md" icon={<Save className="w-3.5 h-3.5" aria-hidden />} onClick={guardar} disabled={sinCambios || guardando}>
            {guardando ? "Guardando..." : "Guardar nuevo plan"}
          </Btn>
          )}
        </footer>
      </aside>
    </>
  );
}
