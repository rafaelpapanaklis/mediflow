import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { AffiliateSeller, AffiliateStatus } from "@prisma/client";

/**
 * Contexto de sesión de un VENDEDOR (equipo de afiliados). El vendedor es un
 * actor externo creado por su afiliado padre; autentica vía Supabase Auth
 * (supabaseId) igual que el afiliado. sellerId/affiliateId SIEMPRE salen de la
 * sesión, NUNCA del request body — un vendedor no puede tocar a otro ni a otro
 * equipo. Espejo de getAffiliateContext() (src/lib/affiliate-auth.ts).
 *
 * Devuelve null si no hay sesión Supabase, el usuario no es vendedor, el
 * vendedor está inactivo, o el afiliado padre no existe. La aprobación del
 * padre NO se exige aquí (se expone en parentStatus para que el layout decida).
 */
export interface AffiliateSellerContext {
  sellerId: string;
  affiliateId: string; // padre
  seller: AffiliateSeller;
  parentStatus: AffiliateStatus; // estado del afiliado padre
  parentName: string;
  parentSlug: string; // para construir la URL /socio/<slug>?c=...
}

export async function getAffiliateSellerContext(): Promise<AffiliateSellerContext | null> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    // supabaseId es @unique → findUnique es exacto (sin ambigüedad de findFirst).
    const seller = await prisma.affiliateSeller.findUnique({
      where: { supabaseId: user.id },
    });
    if (!seller || !seller.isActive) return null;

    const parent = await prisma.affiliate.findUnique({
      where: { id: seller.affiliateId },
      select: { status: true, name: true, slug: true },
    });
    if (!parent) return null;

    return {
      sellerId: seller.id,
      affiliateId: seller.affiliateId,
      seller,
      parentStatus: parent.status,
      parentName: parent.name,
      parentSlug: parent.slug,
    };
  } catch {
    return null;
  }
}
