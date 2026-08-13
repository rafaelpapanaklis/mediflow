// Contrato ÚNICO del consentimiento informado entre servidor y panel.
//
// Lo consumen: GET /api/consent (lista del tab), la carga inicial del server
// component de la ficha y el propio tab. Tener el mapper aquí evita que el
// estado ("Vencido" vs "Pendiente") se calcule distinto en cada superficie —
// que es exactamente como el badge y el botón acaban contradiciéndose.
//
// PURO: sin Prisma ni React. Recibe una fila ya leída y devuelve el DTO.

export type ConsentStatus = "PENDING" | "EXPIRED" | "SIGNED" | "REVOKED";

export interface ConsentDTO {
  id: string;
  patientId: string;
  procedure: string;
  procedureKey: string | null;
  /** Token de la liga pública `/consentimiento/[token]` (staff, no viaja al paciente). */
  token: string;
  expiresAt: string;
  createdAt: string;
  status: ConsentStatus;

  doctorId: string | null;
  signerName: string | null;
  signerRelation: string | null;

  viewedAt: string | null;
  signedAt: string | null;
  hasPatientSignature: boolean;

  witness1Name: string | null;
  witness1SignedAt: string | null;
  witness2Name: string | null;
  witness2SignedAt: string | null;
  witnessCount: number;

  doctorSignedAt: string | null;
  hasDoctorSignature: boolean;

  revokedAt: string | null;
  revokedReason: string | null;
}

/** Forma mínima de la fila que necesita el mapper (subconjunto de ConsentForm). */
export interface ConsentRowLike {
  id: string;
  patientId: string;
  procedure: string;
  procedureKey?: string | null;
  token: string;
  expiresAt: Date | string;
  createdAt: Date | string;
  doctorId?: string | null;
  signerName?: string | null;
  signerRelation?: string | null;
  viewedAt?: Date | string | null;
  signedAt?: Date | string | null;
  signatureUrl?: string | null;
  witness1Name?: string | null;
  witness1SignatureUrl?: string | null;
  witness1SignedAt?: Date | string | null;
  witness2Name?: string | null;
  witness2SignatureUrl?: string | null;
  witness2SignedAt?: Date | string | null;
  doctorSignedAt?: Date | string | null;
  doctorSignatureUrl?: string | null;
  revokedAt?: Date | string | null;
  revokedReason?: string | null;
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * Estado visible de un consentimiento.
 *
 * El orden importa: una carta revocada sigue estando firmada, y una firmada
 * cuyo enlace ya venció NO está "vencida" — lo que vence es la liga para
 * firmarla, no el documento. Invertir el orden pondría "Vencido" sobre cartas
 * perfectamente válidas.
 */
export function consentStatus(
  row: { signedAt?: Date | string | null; revokedAt?: Date | string | null; expiresAt: Date | string },
  now: Date = new Date(),
): ConsentStatus {
  if (row.revokedAt) return "REVOKED";
  if (row.signedAt) return "SIGNED";
  const exp = row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt);
  if (!isNaN(exp.getTime()) && exp.getTime() < now.getTime()) return "EXPIRED";
  return "PENDING";
}

/**
 * Fila → DTO del panel.
 *
 * Las URLs de las firmas NO viajan: el panel solo necesita saber SI existen
 * (para la columna de completitud); las imágenes se ven en el PDF, que se
 * genera on-demand con signed URLs de vida corta.
 */
export function toConsentDTO(row: ConsentRowLike, now: Date = new Date()): ConsentDTO {
  const witnessCount = [row.witness1SignedAt, row.witness2SignedAt].filter(Boolean).length;
  return {
    id: row.id,
    patientId: row.patientId,
    procedure: row.procedure,
    procedureKey: row.procedureKey ?? null,
    token: row.token,
    expiresAt: iso(row.expiresAt) ?? "",
    createdAt: iso(row.createdAt) ?? "",
    status: consentStatus(row, now),

    doctorId: row.doctorId ?? null,
    signerName: row.signerName ?? null,
    signerRelation: row.signerRelation ?? null,

    viewedAt: iso(row.viewedAt),
    signedAt: iso(row.signedAt),
    hasPatientSignature: Boolean(row.signatureUrl),

    witness1Name: row.witness1Name ?? null,
    witness1SignedAt: iso(row.witness1SignedAt),
    witness2Name: row.witness2Name ?? null,
    witness2SignedAt: iso(row.witness2SignedAt),
    witnessCount,

    doctorSignedAt: iso(row.doctorSignedAt),
    hasDoctorSignature: Boolean(row.doctorSignatureUrl),

    revokedAt: iso(row.revokedAt),
    revokedReason: row.revokedReason ?? null,
  };
}

/**
 * Campos que el mapper necesita. Se pasa como `select` en cada query.
 *
 * `content` NO está a propósito: la carta entera son varios KB por fila y el
 * panel no la pinta (para leerla está el PDF). Traerla al cliente solo engorda
 * el payload de la ficha con texto que nadie mira.
 */
export const CONSENT_DTO_SELECT = {
  id: true,
  patientId: true,
  procedure: true,
  procedureKey: true,
  token: true,
  expiresAt: true,
  createdAt: true,
  doctorId: true,
  signerName: true,
  signerRelation: true,
  viewedAt: true,
  signedAt: true,
  signatureUrl: true,
  witness1Name: true,
  witness1SignatureUrl: true,
  witness1SignedAt: true,
  witness2Name: true,
  witness2SignatureUrl: true,
  witness2SignedAt: true,
  doctorSignedAt: true,
  doctorSignatureUrl: true,
  revokedAt: true,
  revokedReason: true,
} as const;
