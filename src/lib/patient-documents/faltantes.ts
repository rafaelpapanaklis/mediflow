// ─────────────────────────────────────────────────────────────────────────────
// Los datos que un documento del paciente lleva y que hoy NO están capturados.
//
// Es común a TODOS los documentos del paciente (nota de evolución, carta de
// consentimiento): los dos imprimen clínica, doctor y paciente, y a los dos les
// faltan las mismas cosas. Medido contra producción el 19-sep-2026: 0 de 15
// clínicas tienen dirección y 1 de 15 logo. El aviso sale casi siempre; es el
// caso normal, no un error.
//
// Dos reglas, y viven aquí para que la pantalla, el PDF y el aviso no puedan
// contradecirse:
//   · un hueco se imprime como su ETIQUETA con una raya para llenar a mano.
//     Nunca "undefined", nunca "N/A", nunca un valor inventado;
//   · lo que falta se AVISA antes de firmar, con el sitio donde se captura. Es
//     un aviso, no un bloqueo.
//
// PURO: sin Prisma, sin React y sin red. Lo importan el cliente y el servidor.
// ─────────────────────────────────────────────────────────────────────────────

/** Raya para llenar a mano. La misma en pantalla, en el texto y en el PDF. */
export const RAYA_PARA_LLENAR = "______";

/** Valor capturado, o "" si no hay nada que imprimir. */
export function valorCapturado(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** Valor capturado, o la raya. Lo que va DESPUÉS de una etiqueta. */
export function valorORaya(value: string | null | undefined): string {
  return valorCapturado(value) || RAYA_PARA_LLENAR;
}

/** Un dato que el documento lleva y que hoy no está capturado. */
export type DatoFaltanteClave =
  | "clinicAddress"
  | "clinicLogo"
  | "doctorLicense"
  | "doctorSpecialty"
  | "patientCurp";

/** Dónde se captura: Configuración, Equipo o la ficha del paciente. */
export type LugarDeCaptura = "settings" | "team" | "patient";

export interface DatoFaltante {
  key: DatoFaltanteClave;
  fixIn: LugarDeCaptura;
}

export interface DatosDelDocumento {
  clinicAddress?: string | null;
  clinicLogoUrl?: string | null;
  /** `User.cedulaProfesional`. */
  doctorLicense?: string | null;
  /** `User.especialidad` (la de Equipo) — NO `User.specialty`, que es el módulo del panel. */
  doctorSpecialty?: string | null;
  patientCurp?: string | null;
  /**
   * `Patient.curpStatus`. Un paciente marcado FOREIGN no tiene CURP que
   * capturar: avisar de que "falta" mandaría a la recepción a buscar un dato
   * que no existe.
   */
  patientCurpStatus?: string | null;
}

const LUGAR: Record<DatoFaltanteClave, LugarDeCaptura> = {
  clinicAddress: "settings",
  clinicLogo: "settings",
  doctorLicense: "team",
  doctorSpecialty: "team",
  patientCurp: "patient",
};

/**
 * Los datos que faltan, en el orden en que se leen en el documento (clínica,
 * doctor, paciente). Lista vacía = documento completo.
 *
 * La cédula de especialidad NO cuenta como faltante: solo la tiene quien cursó
 * una especialidad, y pedírsela a un odontólogo general sería un aviso falso
 * que enseña a ignorar el aviso.
 */
export function datosFaltantes(input: DatosDelDocumento): DatoFaltante[] {
  const faltan: DatoFaltanteClave[] = [];
  if (!valorCapturado(input.clinicAddress)) faltan.push("clinicAddress");
  if (!valorCapturado(input.clinicLogoUrl)) faltan.push("clinicLogo");
  if (!valorCapturado(input.doctorLicense)) faltan.push("doctorLicense");
  if (!valorCapturado(input.doctorSpecialty)) faltan.push("doctorSpecialty");
  if (!valorCapturado(input.patientCurp) && input.patientCurpStatus !== "FOREIGN") {
    faltan.push("patientCurp");
  }
  return faltan.map((key) => ({ key, fixIn: LUGAR[key] }));
}

/** La pantalla del panel donde se captura ese dato. */
export function hrefDeCaptura(lugar: LugarDeCaptura, patientId: string): string {
  if (lugar === "settings") return "/dashboard/settings";
  if (lugar === "team") return "/dashboard/team";
  return `/dashboard/patients/${encodeURIComponent(patientId)}`;
}
