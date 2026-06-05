import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { Affiliate, AffiliateStatus } from "@prisma/client";

/**
 * Contexto de sesión de un usuario AFILIADO. El afiliado es un actor externo
 * global (sin clinicId) que autentica vía Supabase Auth, igual que el
 * laboratorio. affiliateId SIEMPRE sale de la sesión, NUNCA del request body.
 * Devuelve null si no hay sesión Supabase o el usuario no es de afiliado.
 *
 * Espejo de getDentalLabContext() (src/lib/lab-auth.ts).
 */
export interface AffiliateContext {
  affiliateUserId: string;
  affiliateId: string;
  affiliate: Affiliate;
  status: AffiliateStatus;
}

export async function getAffiliateContext(): Promise<AffiliateContext | null> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const au = await prisma.affiliateUser.findFirst({
      where: { supabaseId: user.id, isActive: true },
      include: { affiliate: true },
      orderBy: { createdAt: "asc" },
    });
    if (!au) return null;

    return {
      affiliateUserId: au.id,
      affiliateId: au.affiliateId,
      affiliate: au.affiliate,
      status: au.affiliate.status,
    };
  } catch {
    return null;
  }
}
