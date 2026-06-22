import { isAdminAuthed } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSellerStatsForAffiliate } from "@/lib/affiliates/seller-stats";


/**
 * GET /api/admin/affiliates/[id]/sellers — lista el EQUIPO de vendedores del
 * afiliado con sus datos de pago (payoutMethod/payoutDetails = CLABE) y montos
 * de comisión (pendiente/pagado) + clínicas atribuidas. Auth admin por cookie.
 *
 * Defensivo: si las tablas affiliate_seller_* aún no existen (SQL sin correr),
 * degrada a { sellers: [] } sin romper (ver lesson_ortho_schema_drift).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [sellers, stats] = await Promise.all([
      prisma.affiliateSeller.findMany({
        where: { affiliateId: params.id },
        orderBy: { createdAt: "asc" },
      }),
      getSellerStatsForAffiliate(params.id),
    ]);

    return NextResponse.json({
      sellers: sellers.map((s) => {
        const st = stats.get(s.id);
        return {
          id: s.id,
          name: s.name,
          email: s.email,
          phone: s.phone,
          commissionPct: s.commissionPct,
          isActive: s.isActive,
          payoutMethod: s.payoutMethod,
          payoutDetails: s.payoutDetails,
          pendingMxn: st?.pendingMxn ?? 0,
          paidMxn: st?.paidMxn ?? 0,
          clinics: st?.clinics ?? 0,
        };
      }),
    });
  } catch {
    // tabla nueva inexistente → equipo vacío (degrada sin romper)
    return NextResponse.json({ sellers: [] });
  }
}
