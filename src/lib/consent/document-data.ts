// ─────────────────────────────────────────────────────────────────────────────
// Los DATOS de identificación de la carta de consentimiento, y cuáles faltan.
//
// La carta lleva: paciente (nombre, CURP, ID), doctor (nombre, cédula
// profesional, cédula de especialidad, especialidad) y clínica (nombre,
// dirección, logo). Medido contra producción el 19-sep-2026: 0 de 15 clínicas
// tienen dirección, 1 de 15 logo, 12 de 35 del staff cédula, 7 de 35
// especialidad y 70 de 228 pacientes CURP. O sea: casi todas las cartas salen
// con huecos, y eso hay que tratarlo como el caso normal, no como el raro.
//
// Dos reglas, y las dos viven aquí para que el texto, el PDF y el aviso del
// panel no puedan contradecirse:
//   · un hueco se imprime como su ETIQUETA con una raya para llenar a mano.
//     Nunca "undefined", nunca "N/A", nunca un valor inventado;
//   · lo que falta se AVISA antes de generar, con el sitio donde se captura.
//     Es un aviso, no un bloqueo: una carta incompleta sigue siendo mejor que
//     ninguna.
//
// PURO: sin Prisma, sin React y sin red. Lo importan el cliente y el servidor.
// ─────────────────────────────────────────────────────────────────────────────

/** Raya para llenar a mano. La misma en el texto de la carta y en el PDF. */
export const CONSENT_BLANK = "______";

/** Valor capturado, o "" si no hay nada que imprimir. */
export function consentValue(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** Valor capturado, o la raya. Lo que va DESPUÉS de una etiqueta. */
export function consentValueOrBlank(value: string | null | undefined): string {
  return consentValue(value) || CONSENT_BLANK;
}

/** Un dato que el documento lleva y que hoy no está capturado. */
export type ConsentMissingKey =
  | "clinicAddress"
  | "clinicLogo"
  | "doctorLicense"
  | "doctorSpecialty"
  | "patientCurp";

/** Dónde se captura: Configuración, Equipo o la ficha del paciente. */
export type ConsentFixPlace = "settings" | "team" | "patient";

export interface ConsentMissingItem {
  key: ConsentMissingKey;
  fixIn: ConsentFixPlace;
}

export interface ConsentDataCheckInput {
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

const FIX_PLACE: Record<ConsentMissingKey, ConsentFixPlace> = {
  clinicAddress: "settings",
  clinicLogo: "settings",
  doctorLicense: "team",
  doctorSpecialty: "team",
  patientCurp: "patient",
};

/**
 * Los datos que faltan, en el orden en que se leen en la carta (clínica,
 * doctor, paciente). Lista vacía = documento completo.
 *
 * La cédula de especialidad NO cuenta como faltante: solo la tiene quien cursó
 * una especialidad, y pedírsela a un odontólogo general sería un aviso falso
 * que enseña a ignorar el aviso.
 */
export function missingConsentData(input: ConsentDataCheckInput): ConsentMissingItem[] {
  const missing: ConsentMissingKey[] = [];
  if (!consentValue(input.clinicAddress)) missing.push("clinicAddress");
  if (!consentValue(input.clinicLogoUrl)) missing.push("clinicLogo");
  if (!consentValue(input.doctorLicense)) missing.push("doctorLicense");
  if (!consentValue(input.doctorSpecialty)) missing.push("doctorSpecialty");
  if (!consentValue(input.patientCurp) && input.patientCurpStatus !== "FOREIGN") {
    missing.push("patientCurp");
  }
  return missing.map((key) => ({ key, fixIn: FIX_PLACE[key] }));
}

/** Un renglón "Etiqueta: valor" del bloque de identificación. */
export interface ConsentLabeledLine {
  label: string;
  /** Valor capturado o la raya (`CONSENT_BLANK`). Nunca vacío. */
  value: string;
}

export interface ConsentDoctorCredentials {
  doctorLicense?: string | null;
  /** `User.cedulaEspecialidad`. */
  doctorSpecialtyLicense?: string | null;
  doctorSpecialty?: string | null;
}

/**
 * Las credenciales del doctor, etiquetadas.
 *
 * Cédula profesional y especialidad van SIEMPRE (con raya si faltan). La cédula
 * de especialidad solo cuando existe: con las dos capturadas se imprimen las
 * dos, cada una con su etiqueta, para que nadie tenga que adivinar cuál es cuál.
 */
export function doctorCredentialLines(doctor: ConsentDoctorCredentials): ConsentLabeledLine[] {
  const lines: ConsentLabeledLine[] = [
    { label: "Cédula profesional", value: consentValueOrBlank(doctor.doctorLicense) },
  ];
  const specialtyLicense = consentValue(doctor.doctorSpecialtyLicense);
  if (specialtyLicense) {
    lines.push({ label: "Cédula de especialidad", value: specialtyLicense });
  }
  lines.push({ label: "Especialidad", value: consentValueOrBlank(doctor.doctorSpecialty) });
  return lines;
}

export interface ConsentPatientIdentity {
  patientCurp?: string | null;
  /** `Patient.patientNumber`, el folio que da el panel. NUNCA el `id` interno. */
  patientNumber?: string | null;
}

/** CURP e ID del paciente, etiquetados. Los dos van siempre. */
export function patientIdentityLines(patient: ConsentPatientIdentity): ConsentLabeledLine[] {
  return [
    { label: "CURP", value: consentValueOrBlank(patient.patientCurp).toUpperCase() },
    { label: "ID del paciente", value: consentValueOrBlank(patient.patientNumber) },
  ];
}
