// ─────────────────────────────────────────────────────────────────────────────
// Quién firma la carta de consentimiento: menores de edad y bloque de firmas.
//
// Dos reglas que hasta ahora vivían repartidas (o no vivían en ningún sitio):
//
//   · Un MENOR no consiente por sí mismo. La carta la firma su madre, padre o
//     tutor (NOM-004-SSA3-2012 numeral 10.1.1.3). El modal tenía la casilla
//     «Firma un representante legal», pero era manual: si el doctor no la
//     marcaba, la carta salía con el niño como firmante y el servidor la
//     aceptaba. Aquí se decide con la fecha de nacimiento, y lo usan el modal
//     (para marcarla sola) y POST /api/consent (para no crearla sin tutor).
//
//   · El BLOQUE DE FIRMAS del PDF depende de si la carta ya se firmó o se
//     imprime para firmar a mano. Una carta firmada a distancia no lleva
//     testigos, y pintar dos líneas vacías haría pensar que faltan; pero una
//     carta SIN firmar que se imprime para el papel sí necesita esas líneas
//     (NOM-004 10.1.1.7), porque en el consultorio los testigos firman con
//     bolígrafo y no hay otro sitio donde hacerlo.
//
// PURO: sin Prisma, sin React, sin red. Lo importan el cliente, el route y el
// generador del PDF, y así las tres superficies aplican el mismo criterio.
// ─────────────────────────────────────────────────────────────────────────────

import { calculateAge } from "@/lib/pediatrics/age";
import type { ConsentSignatureBlock } from "@/lib/pdf/consent-document";

/** Mayoría de edad en México (Constitución, art. 34). */
export const ADULT_AGE = 18;

/**
 * Edad en años cumplidos, o null si no hay fecha de nacimiento válida.
 * Acepta Date o ISO string porque `Patient.dob` llega de las dos formas según
 * la superficie (Prisma en el servidor, JSON serializado en el cliente).
 */
export function ageYears(dob: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!dob) return null;
  const d = dob instanceof Date ? dob : new Date(dob);
  if (isNaN(d.getTime())) return null;
  if (d.getTime() > now.getTime()) return null;
  return calculateAge(d, now).years;
}

/** ¿El paciente es menor de edad? Sin fecha de nacimiento no se afirma nada. */
export function isMinor(dob: Date | string | null | undefined, now: Date = new Date()): boolean {
  const years = ageYears(dob, now);
  return years !== null && years < ADULT_AGE;
}

/**
 * Mensaje de error si la carta de un menor no trae representante legal.
 * `null` cuando la combinación es válida (adulto, o menor con firmante).
 *
 * Es texto de la API, en español como el resto de sus errores.
 */
export function minorSignerError(
  dob: Date | string | null | undefined,
  signerName: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const years = ageYears(dob, now);
  if (years === null || years >= ADULT_AGE) return null;
  if ((signerName ?? "").trim()) return null;
  return `El paciente tiene ${years} ${years === 1 ? "año" : "años"}: la carta debe firmarla su madre, padre o tutor. Indica el nombre y el parentesco del representante legal.`;
}

/** Lo que el generador del PDF sabe de la carta para armar sus firmas. */
export interface SignatureBlocksInput {
  patientName: string;
  signerName: string | null;
  signerRelation: string | null;
  doctorName: string;
  signedAt: Date | null;
  doctorSignedAt: Date | null;
  witness1Name: string | null;
  witness1SignedAt: Date | null;
  witness2Name: string | null;
  witness2SignedAt: Date | null;
  /** Imágenes ya resueltas a data URL (null = sin imagen). */
  patientSig: string | null;
  doctorSig: string | null;
  witness1Sig: string | null;
  witness2Sig: string | null;
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/**
 * Bloques de firma del PDF, en orden: quien consiente, el profesional y los
 * testigos.
 *
 * Testigos:
 *   · carta FIRMADA → solo los que existen (nombre o imagen). Sin testigos, sin
 *     líneas: una firma a distancia no los lleva y dos huecos parecerían un
 *     olvido.
 *   · carta SIN FIRMAR (se imprime para firmar en papel) → siempre dos líneas
 *     en blanco, con nombre y fecha por llenar. Es la única versión del
 *     documento que va a pasar por un bolígrafo.
 */
export function buildSignatureBlocks(input: SignatureBlocksInput): ConsentSignatureBlock[] {
  const represented = Boolean((input.signerName ?? "").trim());
  const blocks: ConsentSignatureBlock[] = [
    {
      role: represented ? "Representante legal" : "Paciente",
      name: represented
        ? `${input.signerName}${input.signerRelation ? ` (${input.signerRelation})` : ""}`
        : input.patientName,
      dataUrl: input.patientSig,
      signedAt: iso(input.signedAt),
    },
    {
      role: "Estomatólogo responsable",
      name: input.doctorName,
      dataUrl: input.doctorSig,
      signedAt: iso(input.doctorSignedAt),
    },
  ];

  const forPaper = !input.signedAt;
  const witnesses: Array<[string, string | null, string | null, Date | null]> = [
    ["Testigo 1", input.witness1Name, input.witness1Sig, input.witness1SignedAt],
    ["Testigo 2", input.witness2Name, input.witness2Sig, input.witness2SignedAt],
  ];
  for (const [role, name, sig, at] of witnesses) {
    if (forPaper || name || sig) {
      blocks.push({ role, name: name ?? "", dataUrl: sig, signedAt: iso(at) });
    }
  }
  return blocks;
}
