// Implants — duraciones sugeridas de cita por tipo de procedimiento.
// Spec §8.1.
//
// El sistema de Appointment usa estos defaults cuando el doctor
// selecciona el motivo de la cita. La elección del tipo de cita es
// libre — esto solo precarga la duración inicial; el doctor puede
// modificarla.

export type ImplantAppointmentTypeKey =
  | "PLANEACION"
  | "CIRUGIA_1"
  | "CIRUGIA_2_3"
  | "ELEVACION_SENO"
  | "ALL_ON_4"
  | "DESCUBRIMIENTO_2A_FASE"
  | "TOMA_IMPRESION"
  | "PRUEBA_PROTESIS"
  | "COLOCACION_FINAL"
  | "MANTENIMIENTO";

export type ImplantAppointmentType = {
  key: ImplantAppointmentTypeKey;
  label: string;
  durationMinutes: number;
};

export const IMPLANT_APPOINTMENT_TYPES: Readonly<
  Record<ImplantAppointmentTypeKey, ImplantAppointmentType>
> = {
  PLANEACION:              { key: "PLANEACION",              label: "Consulta de planeación implantológica", durationMinutes: 60 },
  CIRUGIA_1:               { key: "CIRUGIA_1",               label: "Cirugía de colocación — 1 implante",     durationMinutes: 90 },
  CIRUGIA_2_3:             { key: "CIRUGIA_2_3",             label: "Cirugía de colocación — 2 a 3 implantes", durationMinutes: 120 },
  ELEVACION_SENO:          { key: "ELEVACION_SENO",          label: "Elevación de seno + implante",            durationMinutes: 180 },
  ALL_ON_4:                { key: "ALL_ON_4",                label: "All-on-4 (1 arcada)",                     durationMinutes: 240 },
  DESCUBRIMIENTO_2A_FASE:  { key: "DESCUBRIMIENTO_2A_FASE",  label: "Descubrimiento 2ª fase",                  durationMinutes: 45 },
  TOMA_IMPRESION:          { key: "TOMA_IMPRESION",          label: "Toma de impresión",                       durationMinutes: 45 },
  PRUEBA_PROTESIS:         { key: "PRUEBA_PROTESIS",         label: "Prueba de prótesis",                      durationMinutes: 30 },
  COLOCACION_FINAL:        { key: "COLOCACION_FINAL",        label: "Colocación final",                        durationMinutes: 45 },
  MANTENIMIENTO:           { key: "MANTENIMIENTO",           label: "Mantenimiento periimplantario",           durationMinutes: 45 },
};

/**
 * Sugiere duración a partir de un texto libre en `reason` de la cita.
 * Heurística por keywords. Útil para `/api/implants/context?reason=...`.
 * Devuelve null si no detecta keywords implantológicos.
 */
export function suggestImplantAppointmentDuration(reason: string): number | null {
  const r = reason.toLowerCase();
  if (/all[-\s]?on[-\s]?4|allon4|hibrid/.test(r)) return IMPLANT_APPOINTMENT_TYPES.ALL_ON_4.durationMinutes;
  if (/elevaci[oó]n.*seno|seno.*max/.test(r)) return IMPLANT_APPOINTMENT_TYPES.ELEVACION_SENO.durationMinutes;
  if (/segunda fase|2a fase|descubrimiento/.test(r)) return IMPLANT_APPOINTMENT_TYPES.DESCUBRIMIENTO_2A_FASE.durationMinutes;
  if (/prueba.*pr[oó]tesis|prueba.*corona/.test(r)) return IMPLANT_APPOINTMENT_TYPES.PRUEBA_PROTESIS.durationMinutes;
  if (/colocaci[oó]n.*final|entrega.*pr[oó]tesis|cementado/.test(r)) return IMPLANT_APPOINTMENT_TYPES.COLOCACION_FINAL.durationMinutes;
  if (/toma.*impresi[oó]n|impresi[oó]n/.test(r)) return IMPLANT_APPOINTMENT_TYPES.TOMA_IMPRESION.durationMinutes;
  if (/cirug[ií]a.*\b2\b|2.*implant|3.*implant|dos.*implant|tres.*implant/.test(r)) return IMPLANT_APPOINTMENT_TYPES.CIRUGIA_2_3.durationMinutes;
  if (/cirug[ií]a.*implante|colocaci[oó]n.*implante|coloca.*implante/.test(r)) return IMPLANT_APPOINTMENT_TYPES.CIRUGIA_1.durationMinutes;
  if (/planeaci[oó]n.*implante|consulta.*implant/.test(r)) return IMPLANT_APPOINTMENT_TYPES.PLANEACION.durationMinutes;
  if (/mantenimiento.*peri|control.*implante|recall.*implante/.test(r)) return IMPLANT_APPOINTMENT_TYPES.MANTENIMIENTO.durationMinutes;
  if (/implante|implantol/.test(r)) return IMPLANT_APPOINTMENT_TYPES.PLANEACION.durationMinutes;
  return null;
}
