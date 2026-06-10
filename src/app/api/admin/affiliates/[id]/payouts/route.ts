import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { sendAffiliatePayoutPaidEmail } from "@/lib/affiliate-emails";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

/**
 * POST /api/admin/affiliates/[id]/payouts — marca TODAS las comisiones
 * "pending" del afiliado como "paid" (paidAt = now) y dispara el email de
 * payout (fire-and-forget, respeta notifyPayout).
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  return NextResponse.json({ paid: count, totalMxn });
}
