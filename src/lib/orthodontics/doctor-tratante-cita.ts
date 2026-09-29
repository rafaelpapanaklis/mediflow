// «Nueva cita» de la Agenda: control de ortodoncia → doctor tratante del caso (ws1-t8,
// punto 3 de la auditoría de conexiones). PURO y seguro en el cliente. Desde Controles, la
// ficha y el bot el control ya se agenda con el tratante; la Agenda lo dejaba en el doctor
// de la columna. Aquí se PROPONE (se puede cambiar) y se AVISA si se elige otro.

import { TIPO_CITA_CONTROL_ORTO } from "./agenda-constants";

function comparable(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
}

/** ¿El motivo escrito o elegido es el de control de ortodoncia? */
export function esMotivoDeControlOrto(motivo: string): boolean {
  return comparable(motivo) === comparable(TIPO_CITA_CONTROL_ORTO);
}

export interface EntradaDoctorTratante {
  motivo: string;
  /** El paciente tiene un caso en curso. */
  casoActivo: boolean;
  /** `treatingDoctorId` del caso, o null. */
  tratanteId: string | null | undefined;
  /** Los doctores que se pueden elegir en la ventana. */
  doctoresIds: ReadonlyArray<string>;
  /** El doctor elegido ahora. */
  doctorActual: string;
}

/** ¿Aplica la regla? Solo con motivo de control, caso activo y un tratante que se pueda elegir. */
function aplica(e: EntradaDoctorTratante): e is EntradaDoctorTratante & { tratanteId: string } {
  return Boolean(e.casoActivo && e.tratanteId && esMotivoDeControlOrto(e.motivo) && e.doctoresIds.includes(e.tratanteId));
}

/**
 * El doctor que hay que poner: el tratante, si aplica y el elegido es otro; si no, `null`
 * (no tocar nada).
 */
export function doctorAProponer(e: EntradaDoctorTratante): string | null {
  return aplica(e) && e.doctorActual !== e.tratanteId ? e.tratanteId : null;
}

/** ¿Hay que avisar que el doctor elegido no es el tratante del caso? */
export function avisarOtroDoctor(e: EntradaDoctorTratante): boolean {
  return aplica(e) && Boolean(e.doctorActual) && e.doctorActual !== e.tratanteId;
}
