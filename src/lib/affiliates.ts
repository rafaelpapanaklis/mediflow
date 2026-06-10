import { prisma } from "@/lib/prisma";

/**
 * Helpers de Afiliados / Referidos (fundación).
 *
 * Modelo afiliado-referido con comisión RECURRENTE:
 *  - El afiliado tiene un `referralCode` único.
 *  - La clínica se da de alta con ?ref=<referralCode> → se ata a ese afiliado.
 *  - Cada factura pagada (invoice.paid de Stripe) genera una AffiliateCommission.
 *
 * Todo aquí es server-only (usa Prisma). No exponer al cliente.
 */

// Alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L) para códigos legibles.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function randomCode(len: number = CODE_LENGTH): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Genera un referralCode único (no colisiona con ningún Affiliate existente).
 * Reintenta hasta 10 veces; si todas colisionan (prácticamente imposible),
 * cae a un código más largo.
 */
export async function generateReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode();
    const existing = await prisma.affiliate.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  return randomCode(CODE_LENGTH + 4);
}

/**
 * Resuelve un Affiliate APPROVED por su referralCode. Devuelve null si el code
 * es vacío, no existe, o el afiliado no está aprobado. Nunca lanza — pensado
 * para atribución best-effort en el alta (no debe romper el registro).
 */
export async function resolveApprovedAffiliateByCode(
  code: string | null | undefined,
): Promise<{ id: string; commissionPct: number; email: string } | null> {
  if (!code || typeof code !== "string") return null;
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  try {
    const affiliate = await prisma.affiliate.findUnique({
      where: { referralCode: normalized },
      select: { id: true, status: true, commissionPct: true, email: true },
    });
    if (!affiliate || affiliate.status !== "APPROVED") return null;
    // email expuesto para el chequeo anti self-referral del alta.
    return { id: affiliate.id, commissionPct: affiliate.commissionPct, email: affiliate.email };
  } catch {
    return null;
  }
}

/**
 * Comisión en MXN = monto pagado (MXN) × (commissionPct / 100), redondeado a
 * 2 decimales (centavos). Defensivo ante valores no finitos.
 */
export function calcCommissionMxn(amountMxn: number, commissionPct: number): number {
  if (!Number.isFinite(amountMxn) || !Number.isFinite(commissionPct)) return 0;
  return Math.round(amountMxn * (commissionPct / 100) * 100) / 100;
}
