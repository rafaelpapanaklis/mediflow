"use client";

import type { AgendaAppointmentDTO } from "@/lib/agenda/types";
import { esCitaControlOrto } from "@/lib/orthodontics/agenda-constants";

// Ortodoncia — Ola 0 (ws1-t1): única ranura del panel de la cita
// (agenda-nueva/panel-cita.tsx). Se autocalifica sola: solo tendría algo que
// mostrar cuando la cita es un control de ortodoncia
// (TIPO_CITA_CONTROL_ORTO); en cualquier otra cita ni entra al resto.
//
// Hoy devuelve `null` SIEMPRE. Sus dos hijos ya existen —
// `ResumenCobranza` (../cobranza/ResumenCobranza.tsx) y `BotonHojaControl`
// (./BotonHojaControl.tsx)— pero `AgendaAppointmentDTO` todavía no trae el
// `treatmentPlanId` que necesitan: el control de ortodoncia hoy no tiene FK
// a `Appointment` (por eso `ortho_treatment_cards.appointmentId`,
// sql/ortodoncia-nucleo.sql). Resolver ese dato y montar los dos hijos aquí
// es trabajo de la parte «Control y agenda» — ver «MAPA DE PARTES» en
// REPORTE-ws1-t1.md. No se inventa el dato mientras tanto.
export interface RanuraCitaProps {
  dto: Pick<AgendaAppointmentDTO, "id" | "reason">;
}

export function RanuraCita({ dto }: RanuraCitaProps) {
  if (!esCitaControlOrto(dto.reason ?? null)) return null;
  return null;
}
