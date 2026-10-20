"use client";

/**
 * WS1-T5 (revisión t8, N-A1 y N3-A3) — CAMBIAR EL ESTADO DE UNA CITA EN LA
 * AGENDA DE SIEMPRE, con el «¿Seguro?» de sobreagendar.
 *
 * «Re-abrir» una cancelada cuyo hueco ya ocupa otra: con la bandera
 * `agenda-flexible` el servidor responde 409 `sobreagendable`; aquí se
 * pregunta y, con «Sí», se reenvía confirmada. Lo usan las TRES puertas de la
 * agenda de siempre que reabren: el botón de la tarjeta, su menú «…» y el
 * panel de detalle. Antes solo el panel preguntaba; la tarjeta y el menú
 * enseñaban «…hazlo desde la Agenda» estando ya en la Agenda.
 *
 * Cualquier otro cambio de estado pasa tal cual (el servidor nunca lo marca
 * `sobreagendable`). `cambiar` devuelve `null` si la persona dijo «Cancelar».
 */

import { useCallback, useState, type ReactNode, type SyntheticEvent } from "react";
import { useAgenda } from "./agenda-provider";
import { patchAppointmentStatus } from "@/lib/agenda/mutations";
import { enviarConAvisoDeSobreagenda, type AvisoSobreagenda } from "@/lib/agenda/agenda-flexible";
import { ConfirmarSobreagenda } from "@/components/dashboard/agenda-nueva/confirmar-sobreagenda";
import type { AgendaAppointmentDTO, AppointmentStatus } from "@/lib/agenda/types";

const parar = (e: SyntheticEvent) => e.stopPropagation();

export function useEstadoConAviso(): {
  cambiar: (cita: AgendaAppointmentDTO, destino: AppointmentStatus) => Promise<AgendaAppointmentDTO | null>;
  dialogo: ReactNode;
} {
  const { state } = useAgenda();
  const [pregunta, setPregunta] = useState<{ aviso: AvisoSobreagenda; responder: (si: boolean) => void } | null>(null);

  const cambiar = useCallback(
    (cita: AgendaAppointmentDTO, destino: AppointmentStatus) =>
      enviarConAvisoDeSobreagenda({
        enviar: (confirmacion) => patchAppointmentStatus(cita.id, destino, confirmacion),
        preguntar: (aviso) => new Promise<boolean>((responder) => setPregunta({ aviso, responder })),
        intento: { doctorId: cita.doctor?.id ?? null, resourceId: cita.resourceId },
        timeZone: state.timezone,
      }),
    [state.timezone],
  );

  // El diálogo va en un portal, pero sus eventos suben por el árbol de React
  // hasta quien lo monta: en la tarjeta, «Sí» la seleccionaría y Enter
  // arrancaría el arrastre con teclado de dnd-kit. Se cortan aquí.
  const dialogo = pregunta ? (
    <span style={{ display: "contents" }} onClick={parar} onPointerDown={parar} onKeyDown={parar}>
      <ConfirmarSobreagenda
        aviso={pregunta.aviso}
        onConfirmar={() => {
          pregunta.responder(true);
          setPregunta(null);
        }}
        onCancelar={() => {
          pregunta.responder(false);
          setPregunta(null);
        }}
      />
    </span>
  ) : null;

  return { cambiar, dialogo };
}
