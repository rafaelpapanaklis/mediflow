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
  /**
   * El paciente tiene un caso PLANEADO (PLANNED, sin instalar) y ninguno en curso. Su tratante también se
   * propone (revisión de ws1-t10: «Agendar» de un caso planeado abría con el primer doctor de la lista).
   */
  casoPlaneado?: boolean;
  /** `treatingDoctorId` del caso, o null. */
  tratanteId: string | null | undefined;
  /** Los doctores que se pueden elegir en la ventana. */
  doctoresIds: ReadonlyArray<string>;
  /** El doctor elegido ahora. */
  doctorActual: string;
}

/** ¿Hay un caso (en curso o planeado) cuyo tratante cuente? */
function hayCaso(e: EntradaDoctorTratante): boolean {
  return Boolean(e.casoActivo || e.casoPlaneado);
}

/** ¿Aplica la regla? Solo con motivo de control, caso en curso o planeado y un tratante que se pueda elegir. */
function aplica(e: EntradaDoctorTratante): e is EntradaDoctorTratante & { tratanteId: string } {
  return Boolean(hayCaso(e) && e.tratanteId && esMotivoDeControlOrto(e.motivo) && e.doctoresIds.includes(e.tratanteId));
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

/**
 * ws1-t10: control de un caso cuyo tratante NO puede recibir citas (no aparece en la agenda o ya no está
 * activo): la ventana agenda con otro profesional y lo dice, en vez de mandar al tratante y que el servidor
 * conteste doctor_not_found.
 */
export function tratanteFueraDeLaAgenda(e: EntradaDoctorTratante): boolean {
  return Boolean(
    hayCaso(e) && e.tratanteId && esMotivoDeControlOrto(e.motivo) && !e.doctoresIds.includes(e.tratanteId),
  );
}

export function fraseTratanteFueraDeLaAgenda(nombreTratante: string | null): string {
  const quien = nombreTratante ? `El doctor tratante de este caso (${nombreTratante})` : "El doctor tratante de este caso";
  return `${quien} no aparece en la agenda, así que el control se agenda con otro profesional. Si atiende, enciende «Aparece en la agenda» en su cuenta de Equipo.`;
}
