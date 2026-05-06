/**
 * Helpers para PatientShareLink — tokens públicos para compartir vista
 * clínica con paciente vía /share/p/[token].
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";

export const DEFAULT_SHARE_EXPIRES_DAYS = 60;

export const shareTokenCreateSchema = z.object({
  patientId: z.string().min(1),
  module: z.enum([
    "pediatrics",
    "endodontics",
    "periodontics",
    "implants",
    "orthodontics",
  ]),
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(365)
    .default(DEFAULT_SHARE_EXPIRES_DAYS),
});

export type ShareTokenCreateInput = z.infer<typeof shareTokenCreateSchema>;

/**
 * Token URL-safe de 32 bytes (≈43 chars base64url).
 */
export function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function computeExpiresAt(now: Date, expiresInDays: number): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + expiresInDays);
  return d;
}

/**
 * Valida si un token está vivo: no revocado y no expirado.
 */
export function isShareTokenLive(
  token: { revokedAt: Date | null; expiresAt: Date },
  now: Date,
): boolean {
  if (token.revokedAt) return false;
  if (token.expiresAt <= now) return false;
  return true;
}

export function buildShareUrl(baseUrl: string, token: string): string {
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${trimmed}/share/p/${token}`;
}
