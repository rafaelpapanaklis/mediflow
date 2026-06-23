import { getAdminSession } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendAffiliateSellerPayoutPaidEmail } from "@/lib/affiliate-emails";
import { logAdminGlobalEvent } from "@/lib/admin-audit";


/**
 * POST /api/admin/affiliates/sellers/[sellerId]/payouts — marca TODAS las
 * comisiones "pending" del vendedor como "paid" (paidAt = now) y dispara el
 * email de payout al vendedor (fire-and-forget). Espejo del payout de afiliado.
 */
export async function POST(req: NextRequest, { params }: { params: { sellerId: string } }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pending = await prisma.affiliateSellerCommission.aggregate({
    where: { sellerId: params.sellerId, status: "pending" },
    _sum: { commissionMxn: true },
    _count: { _all: true },
  });
  const count = pending._count._all;
  if (count === 0) return NextResponse.json({ paid: 0, totalMxn: 0 });

  const totalMxn = Math.round((pending._sum.commissionMxn ?? 0) * 100) / 100;

  await prisma.affiliateSellerCommission.updateMany({
    where: { sellerId: params.sellerId, status: "pending" },
    data: { status: "paid", paidAt: new Date() },
  });

  // Email al vendedor (fire-and-forget — la respuesta no espera el envío).
  void sendAffiliateSellerPayoutPaidEmail({ sellerId: params.sellerId, totalMxn, count }).catch(() => {});

  logAdminGlobalEvent({
    req, admin: admin.user, entity: "affiliate-payout", entityId: params.sellerId,
    action: "payout", after: { paid: count, totalMxn, kind: "seller" },
  });

  return NextResponse.json({ paid: count, totalMxn });
}
