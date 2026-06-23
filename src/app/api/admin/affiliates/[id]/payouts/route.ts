import { getAdminSession } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendAffiliatePayoutPaidEmail } from "@/lib/affiliate-emails";
import { logAdminGlobalEvent } from "@/lib/admin-audit";


/**
 * POST /api/admin/affiliates/[id]/payouts — marca TODAS las comisiones
 * "pending" del afiliado como "paid" (paidAt = now) y dispara el email de
 * payout (fire-and-forget, respeta notifyPayout).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pending = await prisma.affiliateCommission.aggregate({
    where: { affiliateId: params.id, status: "pending" },
    _sum: { commissionMxn: true },
    _count: { _all: true },
  });
  const count = pending._count._all;
  if (count === 0) return NextResponse.json({ paid: 0, totalMxn: 0 });

  const totalMxn = Math.round((pending._sum.commissionMxn ?? 0) * 100) / 100;

  await prisma.affiliateCommission.updateMany({
    where: { affiliateId: params.id, status: "pending" },
    data: { status: "paid", paidAt: new Date() },
  });

  // Email al afiliado (fire-and-forget — la respuesta no espera el envío).
  void sendAffiliatePayoutPaidEmail({ affiliateId: params.id, totalMxn, count }).catch(() => {});

  logAdminGlobalEvent({
    req, admin: admin.user, entity: "affiliate-payout", entityId: params.id,
    action: "payout", after: { paid: count, totalMxn },
  });

  return NextResponse.json({ paid: count, totalMxn });
}
