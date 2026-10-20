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

import { useCallback, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type SyntheticEvent } from "react";
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
  const tocoElFondo = useRef(false);

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
  //
  // (revisión t8, N4-A2) Cortar el `pointerdown` también le quita a Radix el
  // «clic en el fondo cierra» (lo detecta en `document`, adonde ya no llega).
  // Se hace aquí lo mismo que haría Radix: un `pointerdown` fuera del
  // contenido del diálogo (en el velo) es «Cancelar». Dejarlo subir no vale:
  // pasaría por la tarjeta y la rejilla antes de llegar a `document`.
  //
  // (revisión t8, N5-A1) En pantalla táctil no se cierra en el `pointerdown`:
  // el velo desaparecería antes de levantar el dedo y el `click` que el
  // navegador manda después caería en lo de abajo (seleccionaría la tarjeta o
  // volvería a pulsar «Re-abrir»). Como Radix, se anota el toque y se cierra
  // en ese `click`, que todavía cae en el velo. Solo el botón principal.
  const cancelar = () => {
    pregunta?.responder(false);
    setPregunta(null);
  };
  const fuera = (e: SyntheticEvent) => e.target instanceof Element && !e.target.closest('[role="dialog"]');
  const dialogo = pregunta ? (
    <span
      style={{ display: "contents" }}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        const toco = tocoElFondo.current;
        tocoElFondo.current = false;
        if (toco && fuera(e)) cancelar();
      }}
      onKeyDown={parar}
      onPointerDown={(e: PointerEvent) => {
        e.stopPropagation();
        tocoElFondo.current = false;
        if (e.button !== 0 || !fuera(e)) return;
        if (e.pointerType === "touch") tocoElFondo.current = true;
        else cancelar();
      }}
    >
      <ConfirmarSobreagenda
        aviso={pregunta.aviso}
        onConfirmar={() => {
          pregunta.responder(true);
          setPregunta(null);
        }}
        onCancelar={cancelar}
      />
    </span>
  ) : null;

  return { cambiar, dialogo };
}
