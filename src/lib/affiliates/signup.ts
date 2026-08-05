import { prisma } from "@/lib/prisma";
import { generateReferralCode } from "@/lib/affiliates";
import {
  sendAffiliateApplicationAdminEmail,
  sendAffiliateApplicationReceivedEmail,
} from "@/lib/affiliate-emails";

/**
 * Núcleo COMPARTIDO del alta de afiliado. Lo usan las dos puertas de entrada:
 *
 *   1. /api/afiliados/auth/register → correo nuevo: crea el usuario en Supabase
 *      Auth y luego llama aquí.
 *   2. /api/afiliados/auth/link     → correo que YA existe en Supabase Auth
 *      (típicamente el dueño de una clínica): NO crea usuario, reutiliza el
 *      supabaseId de una sesión ya verificada en el servidor y llama aquí.
 *
 * Vive en un solo lugar a propósito: el slug, el referralCode, el status
 * PENDING y los dos correos tienen que salir idénticos por ambas puertas.
 */

/** Métodos de pago aceptados (free-form pero validado contra catálogo fijo). */
export const VALID_PAYOUT_METHODS = new Set(["SPEI", "PAYPAL", "OTHER"]);

/** Devuelve el método si está en el catálogo, o "" si no (→ se guarda null). */
export function normalizePayoutMethod(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return VALID_PAYOUT_METHODS.has(v) ? v : "";
}

/** Slug legible derivado del nombre del afiliado. */
export function slugifyAffiliate(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "afiliado"
  );
}

/** Slug único: reintenta con sufijo aleatorio si ya está tomado. */
async function uniqueSlug(name: string): Promise<string> {
  let slug = slugifyAffiliate(name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await prisma.affiliate.findUnique({ where: { slug } });
    if (!existing) break;
    const suffix = Math.random().toString(36).slice(2, 6);
    slug = `${slugifyAffiliate(name)}-${suffix}`;
  }
  return slug;
}

/**
 * Crea el `Affiliate` (status PENDING por default) + su `AffiliateUser`
 * apuntando a `supabaseId`, en UNA transacción. Devuelve el id del afiliado.
 *
 * NO toca Supabase Auth: el usuario ya existe cuando se llama a esto. Quien
 * llama decide qué hacer si esto lanza (el register hace rollback del usuario
 * que ÉL acaba de crear; el link no tiene nada que revertir).
 */
export async function createAffiliateAccount(opts: {
  name: string;
  email: string; // ya normalizado a lowercase
  supabaseId: string;
  payoutMethod: string; // "" → null
  payoutDetails: string; // "" → null
}): Promise<string> {
  const slug = await uniqueSlug(opts.name);
  const referralCode = await generateReferralCode();

  return prisma.$transaction(async (tx) => {
    const affiliate = await tx.affiliate.create({
      data: {
        name: opts.name,
        slug,
        email: opts.email,
        referralCode,
        payoutMethod: opts.payoutMethod || null,
        payoutDetails: opts.payoutDetails || null,
        // status usa el default PENDING; commissionPct usa el default (20).
      },
    });

    await tx.affiliateUser.create({
      data: {
        affiliateId: affiliate.id,
        supabaseId: opts.supabaseId,
        isActive: true,
      },
    });

    return affiliate.id;
  });
}

/**
 * Avisos por correo del alta. Fire-and-forget (mismo patrón que el resto del
 * programa): las funciones ya llevan su try/catch interno y jamás tiran, y el
 * `.catch()` cubre además el rechazo de la promesa. Un fallo de Resend no puede
 * tumbar un registro que ya quedó guardado.
 */
export function sendAffiliateSignupEmails(opts: {
  affiliateId: string;
  name: string;
  email: string;
  payoutMethod: string;
}): void {
  if (opts.affiliateId) {
    void sendAffiliateApplicationAdminEmail({
      affiliateId: opts.affiliateId,
      name: opts.name,
      email: opts.email,
      payoutMethod: opts.payoutMethod || null,
    }).catch(() => {});
  }
  void sendAffiliateApplicationReceivedEmail({ name: opts.name, email: opts.email }).catch(() => {});
}
