"use client";

// Ranura «Después de la consulta» del panel de la cita (Agenda nueva) — ws1-t10.
//
//  · «Indicaciones» abre el cuadro para elegir y mandar/imprimir las hojas.
//  · «Constancia de asistencia» abre el PDF (con la plantilla de la clínica).
//  · Al TERMINAR la consulta desde este mismo panel (el estado pasa a
//    «Completada» con el panel abierto), si los procedimientos de la cita
//    proponen alguna hoja, lo ofrece sin abrir nada: «¿Le das las indicaciones…?».
//
// Se pinta solo en los estados en que tiene sentido (el servidor exige lo mismo)
// y solo a quien puede trabajar la agenda (`agenda.edit`, como el servidor).

import { useEffect, useRef, useState } from "react";
import { ClipboardList, FileBadge } from "lucide-react";
import { admiteConstancia, admiteIndicaciones, seAcabaDeTerminar } from "@/lib/indicaciones/envio";
import { conValores, useTextosIndicaciones } from "@/lib/indicaciones/textos";
import type { ContextoCita } from "@/lib/indicaciones/tipos";
import ag from "@/components/dashboard/agenda-nueva/agenda-nueva.module.css";
import { DialogoIndicaciones } from "./dialogo-indicaciones";
import s from "./indicaciones.module.css";

interface Props {
  appointmentId: string;
  /** Estado normalizado de la cita (`CitaVista.estado`). */
  estado: string;
  /** `agenda.edit`: lo mismo que pide el servidor para emitir. */
  puedeEmitir: boolean;
}

/**
 * ¿Ya existe la biblioteca (SQL pegado)? Una pregunta por carga de página, compartida
 * por todas las citas que se abran. Sin ella, «Indicaciones» no se enseña (la
 * constancia sí: funciona con el texto de fábrica).
 */
let disponiblePromesa: Promise<boolean> | null = null;
function bibliotecaDisponible(): Promise<boolean> {
  if (!disponiblePromesa) {
    disponiblePromesa = fetch("/api/indicaciones/disponible")
      .then((r) => (r.ok ? r.json() : { disponible: false }))
      .then((d: { disponible?: unknown }) => d.disponible === true)
      .catch(() => {
        disponiblePromesa = null; // un fallo de red no la apaga para siempre
        return false;
      });
  }
  return disponiblePromesa;
}

export function RanuraIndicaciones({ appointmentId, estado, puedeEmitir }: Props) {
  const tx = useTextosIndicaciones();
  const [abierto, setAbierto] = useState(false);
  const [oferta, setOferta] = useState<ContextoCita | null>(null);
  const [disponible, setDisponible] = useState(false);
  const previo = useRef<{ id: string; estado: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    void bibliotecaDisponible().then((d) => vivo && setDisponible(d));
    return () => {
      vivo = false;
    };
  }, []);

  // La oferta: solo cuando el cambio a «Completada» ocurre con ESTA cita abierta.
  useEffect(() => {
    const antes = previo.current?.id === appointmentId ? previo.current.estado : null;
    previo.current = { id: appointmentId, estado };
    if (!puedeEmitir || !seAcabaDeTerminar(antes, estado)) return;
    let vivo = true;
    fetch(`/api/indicaciones/cita/${encodeURIComponent(appointmentId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<ContextoCita>) : null))
      .then((d) => {
        if (vivo && d && d.disponible && d.admiteIndicaciones && d.sugeridas.length > 0) setOferta(d);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [appointmentId, estado, puedeEmitir]);

  // Otra cita en el panel: la oferta era de la anterior.
  useEffect(() => {
    setOferta((o) => (o ? null : o));
    setAbierto(false);
  }, [appointmentId]);

  const conIndicaciones = disponible && admiteIndicaciones(estado);
  const conConstancia = admiteConstancia(estado);
  if (!puedeEmitir || (!conIndicaciones && !conConstancia)) return null;

  const nombreOfertado =
    oferta && oferta.sugeridas.length === 1
      ? oferta.indicaciones.find((h) => h.id === oferta.sugeridas[0])?.nombre ?? null
      : null;

  return (
    <div className={ag.panelSeccion}>
      <div className={ag.rotuloSeccion}>{tx.ranuraTitulo}</div>

      {oferta && !abierto && (
        <div className={ag.nota} style={{ marginTop: 10 }} role="status">
          <span className={ag.notaIcono}>
            <ClipboardList size={18} strokeWidth={2} />
          </span>
          <div className={s.ranuraOferta}>
            <span>
              <b>{tx.ofrecerTitulo}.</b>{" "}
              {nombreOfertado
                ? conValores(tx.ofrecerTexto, { nombre: nombreOfertado })
                : conValores(tx.ofrecerTextoVarias, { n: oferta.sugeridas.length })}
            </span>
            <div className={s.ranuraOfertaBotones}>
              <button type="button" className={ag.accionSecundaria} onClick={() => setAbierto(true)}>
                {tx.ofrecerSi}
              </button>
              <button type="button" className={ag.accionSecundaria} onClick={() => setOferta(null)}>
                {tx.ofrecerNo}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={s.ranuraBotones}>
        {conIndicaciones && (
          <button type="button" className={ag.accionSecundaria} onClick={() => setAbierto(true)}>
            <ClipboardList size={18} strokeWidth={2} />
            {tx.botonIndicaciones}
          </button>
        )}
        {conConstancia && (
          <button
            type="button"
            className={ag.accionSecundaria}
            title={tx.constanciaAyuda}
            onClick={() =>
              // Dentro del clic: si no, el bloqueador de ventanas lo frena.
              window.open(`/api/indicaciones/cita/${encodeURIComponent(appointmentId)}/constancia`, "_blank", "noopener")
            }
          >
            <FileBadge size={18} strokeWidth={2} />
            {tx.botonConstancia}
          </button>
        )}
      </div>

      {abierto && (
        <DialogoIndicaciones
          appointmentId={appointmentId}
          open
          inicial={oferta}
          onClose={() => {
            setAbierto(false);
            setOferta(null);
          }}
        />
      )}
    </div>
  );
}
