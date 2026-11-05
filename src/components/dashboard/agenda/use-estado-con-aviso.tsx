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
 *
 * ws1-t11 (D9) — y con la cita «Sin doctor»: al marcar la llegada se pregunta
 * «¿Quién lo atiende?» (opcional) y al iniciar la consulta el doctor es
 * obligatorio; a un DOCTOR no se le pregunta (el servidor se la asigna al
 * iniciar). Es el MISMO diálogo y el mismo criterio que el panel de la agenda
 * nueva (`preguntaAntesDelEstado` / `usePedirDoctor`). Quien quiera preguntar
 * ANTES de su cambio optimista llama primero a `elegirDoctor` y le pasa la
 * respuesta a `cambiar`; si no, `cambiar` pregunta solo. Cancelar = no se
 * cambia nada (`null`).
 */

import { useCallback, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type SyntheticEvent } from "react";
import { useAgenda } from "./agenda-provider";
import { useQuienMira } from "./quien-mira";
import { preguntaAntesDelEstado, usePedirDoctor, type DoctorElegible } from "./elegir-doctor-cita";
import { patchAppointmentStatus } from "@/lib/agenda/mutations";
import { enviarConAvisoDeSobreagenda, type AvisoSobreagenda } from "@/lib/agenda/agenda-flexible";
import { ConfirmarSobreagenda } from "@/components/dashboard/agenda-nueva/confirmar-sobreagenda";
import type { AgendaAppointmentDTO, AppointmentStatus } from "@/lib/agenda/types";

const parar = (e: SyntheticEvent) => e.stopPropagation();

/** Lo que respondió «¿Quién lo atiende?»: `{}` = no hacía falta preguntar o se dejó «Sin doctor». */
export interface EleccionDeDoctor {
  doctorId?: string;
}

export function useEstadoConAviso(): {
  /** `eleccion` = lo que ya respondió `elegirDoctor`; sin ella, se pregunta aquí si hace falta. */
  cambiar: (
    cita: AgendaAppointmentDTO,
    destino: AppointmentStatus,
    eleccion?: EleccionDeDoctor,
  ) => Promise<AgendaAppointmentDTO | null>;
  /** `null` = la persona canceló: no se cambia nada. */
  elegirDoctor: (cita: AgendaAppointmentDTO, destino: AppointmentStatus) => Promise<EleccionDeDoctor | null>;
  dialogo: ReactNode;
} {
  const { state } = useAgenda();
  const { userRole } = useQuienMira();
  const { pedir, dialogo: dialogoDoctor } = usePedirDoctor();
  const [pregunta, setPregunta] = useState<{ aviso: AvisoSobreagenda; responder: (si: boolean) => void } | null>(null);
  const tocoElFondo = useRef(false);

  /** A quién se le puede dar la cita: quien recibe citas (las opciones de «Nueva cita»). */
  const doctoresElegibles = useMemo<DoctorElegible[]>(
    () => state.doctors.filter((d) => d.activeInAgenda !== false).map((d) => ({ id: d.id, nombre: d.displayName })),
    [state.doctors],
  );

  const elegirDoctor = useCallback(
    async (cita: AgendaAppointmentDTO, destino: AppointmentStatus): Promise<EleccionDeDoctor | null> => {
      const modo = preguntaAntesDelEstado({ destino, citaDoctorId: cita.doctor?.id ?? null, role: userRole });
      if (!modo) return {};
      const r = await pedir({ modo, paciente: cita.patient?.name ?? null, doctores: doctoresElegibles });
      if (!r) return null;
      return r.doctorId ? { doctorId: r.doctorId } : {};
    },
    [userRole, pedir, doctoresElegibles],
  );

  const cambiar = useCallback(
    async (cita: AgendaAppointmentDTO, destino: AppointmentStatus, eleccion?: EleccionDeDoctor) => {
      const elegido = eleccion ?? (await elegirDoctor(cita, destino));
      if (!elegido) return null;
      return enviarConAvisoDeSobreagenda({
        enviar: (confirmacion) =>
          patchAppointmentStatus(
            cita.id,
            destino,
            confirmacion,
            elegido.doctorId ? { doctorId: elegido.doctorId } : undefined,
          ),
        preguntar: (aviso) => new Promise<boolean>((responder) => setPregunta({ aviso, responder })),
        intento: { doctorId: elegido.doctorId ?? cita.doctor?.id ?? null, resourceId: cita.resourceId },
        timeZone: state.timezone,
      });
    },
    [state.timezone, elegirDoctor],
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
  const dialogoSobreagenda = pregunta ? (
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

  // «¿Quién lo atiende?» (ws1-t11): mismo corte de eventos que arriba, por la misma razón (en la
  // tarjeta, un clic lo seleccionaría y Enter o un toque arrancarían el arrastre). Se cierra con
  // «Cancelar» o Esc.
  const dialogo =
    dialogoSobreagenda || dialogoDoctor ? (
      <>
        {dialogoSobreagenda}
        {dialogoDoctor ? (
          <span style={{ display: "contents" }} onClick={parar} onKeyDown={parar} onPointerDown={parar}>
            {dialogoDoctor}
          </span>
        ) : null}
      </>
    ) : null;

  return { cambiar, elegirDoctor, dialogo };
}
