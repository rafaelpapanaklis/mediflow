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

// La raya, la lista de faltantes y sus sitios de captura son COMUNES a todos los
// documentos del paciente (la nota de evolución avisa de lo mismo): viven en
// `@/lib/patient-documents/faltantes`. Aquí se conservan los nombres de
// siempre para que la carta, su PDF y sus pruebas no cambien.
import {
  RAYA_PARA_LLENAR,
  datosFaltantes,
  valorCapturado,
  valorORaya,
  type DatoFaltante,
  type DatoFaltanteClave,
  type DatosDelDocumento,
  type LugarDeCaptura,
} from "@/lib/patient-documents/faltantes";

/** Raya para llenar a mano. La misma en el texto de la carta y en el PDF. */
export const CONSENT_BLANK = RAYA_PARA_LLENAR;

/** Valor capturado, o "" si no hay nada que imprimir. */
export const consentValue = valorCapturado;

/** Valor capturado, o la raya. Lo que va DESPUÉS de una etiqueta. */
export const consentValueOrBlank = valorORaya;

export type ConsentMissingKey = DatoFaltanteClave;
export type ConsentFixPlace = LugarDeCaptura;
export type ConsentMissingItem = DatoFaltante;
export type ConsentDataCheckInput = DatosDelDocumento;

/** Los datos que le faltan a la carta. Ver `datosFaltantes`. */
export const missingConsentData = datosFaltantes;

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
