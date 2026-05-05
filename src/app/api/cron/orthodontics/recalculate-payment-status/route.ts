// Orthodontics — cron diario que recalcula payment status de todos los planes
// + encola INSTALLMENT_DUE_3_DAYS para los que vencen en 3 días. SPEC §8.1 + §8.7.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalculatePaymentStatus } from "@/app/actions/orthodontics/recalculatePaymentStatus";
import { isFailure } from "@/app/actions/orthodontics/result";
import { enqueueOrthoWhatsApp } from "@/lib/orthodontics/whatsapp-queue";

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
  // recalculatePaymentStatus internamente encola WA LIGHT/SEVERE si transita.
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

  // 3. INSTALLMENT_DUE_3_DAYS — instalments PENDING con dueDate en 3 días.
  const dayStart = new Date();
  dayStart.setDate(dayStart.getDate() + 3);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  const dueSoon = await prisma.orthoInstallment.findMany({
    where: {
      status: "PENDING",
      paidAt: null,
      dueDate: { gte: dayStart, lte: dayEnd },
    },
    select: {
      id: true,
      clinicId: true,
      paymentPlan: {
        select: { patient: { select: { phone: true } } },
      },
    },
    take: 500,
  });

  let dueRemindersEnqueued = 0;
  for (const inst of dueSoon) {
    const phone = inst.paymentPlan.patient.phone;
    if (!phone) continue;
    const r = await enqueueOrthoWhatsApp(prisma, {
      clinicId: inst.clinicId,
      templateKey: "INSTALLMENT_DUE_3_DAYS",
      scheduledFor: new Date(),
      patientPhone: phone,
    }).catch((e) => {
      console.error("[ortho cron] enqueue DUE_3_DAYS failed:", e);
      return { enqueued: false };
    });
    if (r.enqueued) dueRemindersEnqueued++;
  }

  return NextResponse.json({
    ok: true,
    overdueMarked: overdueResult.count,
    plansRecalculated: recalculated,
    plansFailed: failed,
    dueIn3DaysReminders: dueRemindersEnqueued,
    timestamp: new Date().toISOString(),
  });
}
