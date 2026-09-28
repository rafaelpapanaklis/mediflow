"use client";

// Ortodoncia — Ola 0 (ws1-t1): ranura del botón "Nueva hoja de control" en
// el panel de la cita (montada por RanuraCita, solo en citas de control de
// ortodoncia — TIPO_CITA_CONTROL_ORTO).
//
// Devuelve `null` hasta que la parte «Control y agenda» la llene abriendo
// `DrawerTreatmentCard` con `appointmentId` precargado (para que la hoja que
// se firme quede ligada a ESTA cita vía `ortho_treatment_cards.appointmentId`
// — sql/ortodoncia-nucleo.sql). Ver «MAPA DE PARTES» en REPORTE-ws1-t1.md.
export interface BotonHojaControlProps {
  appointmentId: string;
  treatmentPlanId: string;
}

export function BotonHojaControl(_props: BotonHojaControlProps) {
  return null;
}
