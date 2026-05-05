// Orthodontics — cron diario que recalcula payment status de todos los planes.
// SPEC §8.1.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalculatePaymentStatus } from "@/app/actions/orthodontics/recalculatePaymentStatus";
import { isFailure } from "@/app/actions/orthodontics/result";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  // 1. Marca como OVERDUE las mensualidades vencidas sin pago.
  const overdueResult = await prisma.orthoInstallment.updateMany({
    where: {
      status: "PENDING",
      paidAt: null,
      dueDate: { lt: new Date() },
    },
    data: { status: "OVERDUE" },
  });

  // 2. Recalcula status de planes que tienen al menos una OVERDUE.
  const affected = await prisma.orthoPaymentPlan.findMany({
    where: { installments: { some: { status: "OVERDUE" } } },
    select: { id: true },
    take: 1000,
  });

  let recalculated = 0;
  let failed = 0;
  for (const plan of affected) {
    const result = await recalculatePaymentStatus({ paymentPlanId: plan.id });
    if (isFailure(result)) {
      failed++;
      console.error("[ortho cron] recalc failed for", plan.id, result.error);
    } else {
      recalculated++;
    }
  }

  return NextResponse.json({
    ok: true,
    overdueMarked: overdueResult.count,
    plansRecalculated: recalculated,
    plansFailed: failed,
    timestamp: new Date().toISOString(),
  });
}
