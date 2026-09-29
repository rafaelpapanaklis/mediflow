"use client";

// «Cancelar cita» cuando su factura tiene dinero pagado (H15, decisión de
// Rafael: opción A — ws1-t4). Avisa «Esta cita tiene $X pagados» y, a quien
// tiene permiso de cobro, le pregunta qué hacer con él:
//   (a) dejarlo como saldo a favor del paciente para su próxima cita, o
//   (b) marcarlo para reembolso (DaleControl no mueve dinero: se devuelve
//       fuera, por Mercado Pago o en efectivo).
// Quien no tiene permiso ve el aviso y la cita se cancela dejando el dinero
// como está, «pendiente de decidir». Las reglas, en
// src/lib/anticipos/cita-cancelada-core.ts; el servidor vuelve a decidir
// quién puede elegir, esto solo pregunta.

import { useCallback, useRef, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Label } from "@/components/ui/label";
import { avisoDeDinero } from "@/lib/anticipos/cita-cancelada-core";

export interface DineroDeLaCitaDTO {
  pagado: number;
  factura?: string;
  puedeDecidir?: boolean;
  motivoNoAFavor?: string | null;
}

export interface RespuestaCancelarConDinero {
  confirmed: boolean;
  reason?: string;
  dineroCita?: "a_favor" | "reembolso";
}

export function useCancelarConDinero() {
  const [info, setInfo] = useState<DineroDeLaCitaDTO | null>(null);
  const [eleccion, setEleccion] = useState<"a_favor" | "reembolso" | "">("");
  const [motivo, setMotivo] = useState("");
  const resolver = useRef<((r: RespuestaCancelarConDinero) => void) | null>(null);

  const preguntar = useCallback((d: DineroDeLaCitaDTO) => {
    setInfo(d);
    setEleccion(d.puedeDecidir && !d.motivoNoAFavor ? "a_favor" : d.puedeDecidir ? "reembolso" : "");
    setMotivo("");
    return new Promise<RespuestaCancelarConDinero>((res) => { resolver.current = res; });
  }, []);

  const cerrar = (r: RespuestaCancelarConDinero) => {
    resolver.current?.(r);
    resolver.current = null;
    setInfo(null);
  };

  const puedeDecidir = !!info?.puedeDecidir;
  const listo = !puedeDecidir || eleccion !== "";

  const elemento = (
    <Dialog open={!!info} onOpenChange={(o) => { if (!o) cerrar({ confirmed: false }); }}>
      <DialogContent className="max-w-md bg-card text-foreground border border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground font-bold">¿Cancelar esta cita?</DialogTitle>
        </DialogHeader>
        {info && (
          <div className="space-y-3 text-sm px-6">
            <p role="alert" className="rounded-md border border-border bg-muted/40 px-3 py-2 font-semibold">
              {avisoDeDinero(info.pagado)}
              {info.factura ? <span className="font-normal text-muted-foreground"> (factura {info.factura})</span> : null}
            </p>

            {puedeDecidir ? (
              <div role="radiogroup" aria-label="Qué hacer con el dinero" className="space-y-2">
                <label className={`flex gap-2 rounded-md border border-border px-3 py-2 ${info.motivoNoAFavor ? "opacity-60" : "cursor-pointer"}`}>
                  <input
                    type="radio"
                    name="dinero-cita"
                    disabled={!!info.motivoNoAFavor}
                    checked={eleccion === "a_favor"}
                    onChange={() => setEleccion("a_favor")}
                  />
                  <span>
                    <strong>Dejarlo como saldo a favor</strong> del paciente para su próxima cita. La factura se cancela
                    y el dinero se descuenta solo de su siguiente factura.
                    {info.motivoNoAFavor ? <span className="block text-xs mt-1">{info.motivoNoAFavor}</span> : null}
                  </span>
                </label>
                <label className="flex gap-2 rounded-md border border-border px-3 py-2 cursor-pointer">
                  <input type="radio" name="dinero-cita" checked={eleccion === "reembolso"} onChange={() => setEleccion("reembolso")} />
                  <span>
                    <strong>Marcarlo para reembolso.</strong> DaleControl no mueve dinero: devuélveselo por Mercado Pago o
                    en efectivo y después regístralo en la factura con «Reembolsar».
                  </span>
                </label>
              </div>
            ) : (
              <p className="text-muted-foreground">
                No tienes permiso de cobro para decidir qué pasa con este dinero. La cita se cancela y el dinero se queda
                como está, marcado «pendiente de decidir» en la factura para que lo resuelva quien cobra.
              </p>
            )}

            <div className="space-y-1">
              <Label htmlFor="cancelar-cita-motivo">Motivo de la cancelación (opcional)</Label>
              <textarea
                id="cancelar-cita-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                maxLength={300}
                placeholder="Ej.: el paciente pidió reagendar"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <ButtonNew variant="ghost" onClick={() => cerrar({ confirmed: false })}>No cancelar</ButtonNew>
          <ButtonNew
            variant="danger"
            disabled={!listo}
            onClick={() =>
              cerrar({
                confirmed: true,
                reason: motivo.trim() || undefined,
                dineroCita: puedeDecidir && eleccion ? eleccion : undefined,
              })
            }
          >
            Cancelar la cita
          </ButtonNew>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { preguntar, elemento };
}
