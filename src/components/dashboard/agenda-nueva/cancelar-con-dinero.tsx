"use client";

// «Cancelar cita»: el diálogo ÚNICO de las tres puertas que cancelan (panel de la Agenda, pestaña Citas de la
// ficha y «Editar cita» del expediente — ws1-t1, C-86 de la auditoría de uso).
//
// Pregunta tres cosas y nada más:
//   1. El dinero (H15, decisión de Rafael: opción A — ws1-t4). Si la factura de la cita tiene dinero pagado,
//      avisa «Esta cita tiene $X pagados» y, a quien tiene permiso de cobro, le pregunta qué hacer con él:
//      (a) dejarlo como saldo a favor para su próxima cita, o (b) marcarlo para reembolso (DaleControl no mueve
//      dinero: se devuelve fuera). Quien no tiene permiso ve el aviso y el dinero queda «pendiente de decidir».
//      Reglas en src/lib/anticipos/cita-cancelada-core.ts; el servidor vuelve a decidir quién puede elegir.
//   2. El aviso al paciente: casilla «Avisar al paciente» MARCADA si la clínica tiene «Al cancelar» encendido
//      con WhatsApp conectado; si no, una línea que dice que al paciente no le llega nada. Reglas en
//      src/lib/agenda/aviso-al-cancelar.ts.
//   3. El motivo (opcional), que queda en el expediente.
//
// Antes la ficha cancelaba con un `confirm()` del navegador («Quedara en estado CANCELLED…») por DELETE, sin
// preguntar por el dinero ni por el aviso, y decía «Cita cancelada» aunque el paciente no se enterara.

import { useCallback, useRef, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Label } from "@/components/ui/label";
import { avisoDeDinero } from "@/lib/anticipos/cita-cancelada-core";
import {
  TEXTO_CASILLA_CANCELAR,
  campoDelAvisoCancelar,
  estadoDelAvisoCancelar,
  lineaSinAvisoAlCancelar,
  resumenTrasCancelar,
  type EstadoAvisoCancelar,
} from "@/lib/agenda/aviso-al-cancelar";

export interface DineroDeLaCitaDTO {
  pagado: number;
  factura?: string;
  puedeDecidir?: boolean;
  motivoNoAFavor?: string | null;
}

/** El cuerpo de PATCH /api/appointments/:id/status para cancelar. */
export interface CuerpoCancelarCita {
  status: "CANCELLED";
  reason?: string;
  dineroCita?: "a_favor" | "reembolso";
  notifyPatient?: false;
}

export interface RespuestaCancelarCita {
  confirmed: boolean;
  cuerpo?: CuerpoCancelarCita;
  /** Quien canceló desmarcó «Avisar al paciente». */
  avisoCallado?: boolean;
}

interface Pregunta {
  dinero: DineroDeLaCitaDTO | null;
  aviso: EstadoAvisoCancelar;
  detalle?: ReactNode;
}

const ESPERA_MAXIMA_MS = 4000;

async function pedirJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), ESPERA_MAXIMA_MS);
  try {
    const r = await fetch(url, { credentials: "include", signal: ctrl.signal });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * PATCH /status a CANCELLED con lo que eligió el diálogo, y el mensaje de qué pasó (cita, dinero y aviso).
 * Lanza `{ status, error, reason }` si el servidor dice que no.
 */
export async function cancelarCitaEnServidor(
  citaId: string,
  r: RespuestaCancelarCita,
): Promise<Record<string, any>> {
  const res = await fetch(`/api/appointments/${citaId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(r.cuerpo ?? { status: "CANCELLED" }),
  });
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, ...cuerpo };
  const resumen = resumenTrasCancelar(cuerpo, !!r.avisoCallado);
  if (resumen.tono === "error") toast.error(resumen.texto, { duration: 9000 });
  else if (resumen.tono === "info") toast(resumen.texto, { duration: 9000 });
  else toast.success(resumen.texto);
  return cuerpo;
}

export function useCancelarCita() {
  const [pregunta, setPregunta] = useState<Pregunta | null>(null);
  const [eleccion, setEleccion] = useState<"a_favor" | "reembolso" | "">("");
  const [motivo, setMotivo] = useState("");
  const [avisar, setAvisar] = useState(true);
  const resolver = useRef<((r: RespuestaCancelarCita) => void) | null>(null);

  /** Pregunta el dinero de la cita y el ajuste del aviso a la vez, y abre el diálogo. */
  const preguntar = useCallback(async (citaId: string, detalle?: ReactNode) => {
    const [dinero, clinica] = await Promise.all([
      pedirJson(`/api/appointments/${citaId}/dinero-cita`) as Promise<DineroDeLaCitaDTO | null>,
      pedirJson("/api/clinic/me"),
    ]);
    const d = dinero && dinero.pagado > 0 ? dinero : null;
    setPregunta({ dinero: d, aviso: estadoDelAvisoCancelar(clinica), detalle });
    setEleccion(d?.puedeDecidir && !d.motivoNoAFavor ? "a_favor" : d?.puedeDecidir ? "reembolso" : "");
    setMotivo("");
    setAvisar(true);
    return new Promise<RespuestaCancelarCita>((res) => {
      resolver.current = res;
    });
  }, []);

  const cerrar = (r: RespuestaCancelarCita) => {
    resolver.current?.(r);
    resolver.current = null;
    setPregunta(null);
  };

  const info = pregunta?.dinero ?? null;
  const puedeDecidir = !!info?.puedeDecidir;
  const listo = !info || !puedeDecidir || eleccion !== "";
  const lineaSinAviso = pregunta ? lineaSinAvisoAlCancelar(pregunta.aviso) : null;

  const confirmar = () => {
    if (!pregunta) return;
    const reason = motivo.trim() || undefined;
    const campoAviso = campoDelAvisoCancelar(pregunta.aviso, avisar);
    cerrar({
      confirmed: true,
      cuerpo: {
        status: "CANCELLED",
        ...(reason ? { reason } : {}),
        ...(info && puedeDecidir && eleccion ? { dineroCita: eleccion } : {}),
        ...campoAviso,
      },
      avisoCallado: campoAviso.notifyPatient === false,
    });
  };

  const elemento = (
    <Dialog open={!!pregunta} onOpenChange={(o) => { if (!o) cerrar({ confirmed: false }); }}>
      <DialogContent className="max-w-md bg-card text-foreground border border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground font-bold">¿Cancelar esta cita?</DialogTitle>
        </DialogHeader>
        {pregunta && (
          <div className="space-y-3 text-sm px-6">
            <p className="text-muted-foreground">
              {pregunta.detalle ? <>{pregunta.detalle} </> : null}
              Su horario queda libre y se anulan sus recordatorios pendientes. En el expediente se conserva como
              «Cancelada».
            </p>

            {info && (
              <>
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
                        <strong>Dejarlo como saldo a favor</strong> del paciente para su próxima cita. La factura se
                        cancela y el dinero se descuenta solo de su siguiente factura.
                        {info.motivoNoAFavor ? <span className="block text-xs mt-1">{info.motivoNoAFavor}</span> : null}
                      </span>
                    </label>
                    <label className="flex gap-2 rounded-md border border-border px-3 py-2 cursor-pointer">
                      <input type="radio" name="dinero-cita" checked={eleccion === "reembolso"} onChange={() => setEleccion("reembolso")} />
                      <span>
                        <strong>Marcarlo para reembolso.</strong> DaleControl no mueve dinero: devuélveselo por Mercado
                        Pago o en efectivo y después regístralo en la factura con «Reembolsar».
                      </span>
                    </label>
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    No tienes permiso de cobro para decidir qué pasa con este dinero. La cita se cancela y el dinero se
                    queda como está, marcado «pendiente de decidir» en la factura para que lo resuelva quien cobra.
                  </p>
                )}
              </>
            )}

            {pregunta.aviso === "encendido" ? (
              <label className="flex items-center gap-2 cursor-pointer" data-aviso-cancelar="casilla">
                <input
                  type="checkbox"
                  checked={avisar}
                  onChange={(e) => setAvisar(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: "var(--brand)", flex: "none", margin: 0 }}
                />
                <span>{TEXTO_CASILLA_CANCELAR}</span>
              </label>
            ) : lineaSinAviso ? (
              <p className="text-xs text-muted-foreground" data-aviso-cancelar={pregunta.aviso ?? ""}>
                {lineaSinAviso}
              </p>
            ) : null}

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
          <ButtonNew variant="danger" disabled={!listo} onClick={confirmar}>
            Cancelar la cita
          </ButtonNew>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { preguntar, elemento };
}
