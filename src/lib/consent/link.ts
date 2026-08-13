// Vigencia de la liga pública de firma (`/consentimiento/[token]`).
//
// Dos operaciones distintas que es fácil confundir:
//
//   · REGENERAR (`regenerateConsentLink`) — token NUEVO. Invalida la liga que
//     ya se le mandó al paciente, y eso es justo lo que se busca cuando la
//     anterior venció o se compartió por error.
//
//   · REFRESCAR (`ensureConsentLinkFresh`) — MISMO token, se estira la fecha.
//     Es lo que hace el envío por WhatsApp: mandar una liga muerta sería el
//     equivalente a no mandar nada, y cambiar el token en ese momento rompería
//     la liga que el paciente quizá ya tiene abierta.
//
// SERVER ONLY (Prisma). El clinicId lo pone el caller desde la sesión.

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

/** Días de vigencia de una liga de firma. */
export const CONSENT_LINK_DAYS = 7;

export function consentLinkExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + CONSENT_LINK_DAYS * 24 * 60 * 60 * 1000);
}

export function newConsentToken(): string {
  return randomBytes(20).toString("hex");
}

/** URL pública absoluta de una liga de firma. */
export function consentPublicUrl(token: string, origin?: string | null): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || origin || "").replace(/\/+$/, "");
  return `${base}/consentimiento/${token}`;
}

/**
 * Token nuevo + vigencia nueva. Solo tiene sentido en un consentimiento
 * PENDIENTE: uno firmado no vuelve a firmarse, así que cambiarle el token solo
 * rompería la copia que tenga el paciente.
 *
 * Devuelve el token nuevo, o null si la fila no cumple las condiciones (no
 * existe, es de otra clínica, está firmada, revocada o borrada).
 */
export async function regenerateConsentLink(
  id: string,
  clinicId: string,
): Promise<{ token: string; expiresAt: Date } | null> {
  const token = newConsentToken();
  const expiresAt = consentLinkExpiry();
  // updateMany con TODAS las condiciones en el where: así la comprobación y la
  // escritura son la misma operación y no hay hueco entre "está pendiente" y
  // "escribo el token".
  const res = await prisma.consentForm.updateMany({
    where: { id, clinicId, deletedAt: null, signedAt: null, revokedAt: null },
    data: { token, expiresAt },
  });
  return res.count === 1 ? { token, expiresAt } : null;
}

/**
 * Estira la vigencia si ya venció, conservando el token. Se usa justo antes de
 * mandarle la liga al paciente. No toca nada si la liga sigue viva.
 */
export async function ensureConsentLinkFresh(
  id: string,
  clinicId: string,
  expiresAt: Date,
): Promise<Date> {
  if (expiresAt.getTime() > Date.now()) return expiresAt;
  const fresh = consentLinkExpiry();
  await prisma.consentForm.updateMany({
    where: { id, clinicId, deletedAt: null },
    data: { expiresAt: fresh },
  });
  return fresh;
}
