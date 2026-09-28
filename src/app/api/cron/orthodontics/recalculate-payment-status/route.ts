// Orthodontics — cron diario que recalcula payment status de todos los planes
// + encola INSTALLMENT_DUE_3_DAYS para los que vencen en 3 días. SPEC §8.1 + §8.7.
//
// ws1-t2 (Ola 1, «Tablero y alertas») — arreglo de dos bugs medidos en el
// alcance (fila L1, alcance-ortodoncia.html): «el proceso nocturno marca las
// vencidas pero no puede avisar, y el aviso de "vence en 3 días" sale con
// número y monto en cero».
//
// 1) «No puede avisar»: la versión anterior llamaba a la server action
//    `recalculatePaymentStatus`, que exige sesión (`getOrthoActionContext` →
//    `getAuthContext`). Un cron autentica con CRON_SECRET, no con sesión de
//    usuario: CADA llamada fallaba con "No autenticado" y `failed++` subía a
//    la cuenta de installments afectados, sin recalcular NUNCA nada. Este
//    archivo es el ÚNICO cron de los ~25 del repo que llamaba a una action en
//    vez de a Prisma directo (comprobado grep sobre src/app/api/cron/*/route.ts,
//    27-sep-2026) — se alinea aquí con el resto. La action se queda intacta
//    para el botón manual "Recalcular ahora" (sí corre con sesión).
// 2) «#0 por $0»: `enqueueOrthoWhatsApp` nunca guardaba `payload`, así que
//    `queue-worker.ts` (num()/str() con fallback 0/"") mandaba los templates
//    con los argumentos en cero. Se arregla pasando el `payload` real
//    (whatsapp-queue.ts, additivo). El envío sigue APAGADO
//    (`ORTHO_WHATSAPP_ENQUEUE_ENABLED = false`, bloque S13 de la Ola 0): esto
//    deja la plomería correcta para cuando alguien la reactive, sin mandar
//    WhatsApp nuevo — eso es de "Paciente y WhatsApp" (ws1-t8).
//
// No hace `auditOrtho` (pide un `ctx` con `userId` que un cron no tiene) —
// mismo criterio que el resto de los crons del repo, ninguno audita.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computePaymentStatus } from "@/lib/orthodontics/payment-status";
import { enqueueOrthoWhatsApp } from "@/lib/orthodontics/whatsapp-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  // Fail-closed: sin CRON_SECRET en el entorno, "Bearer undefined" pasaría
  // el check de auth de abajo.
  if (!process.env.CRON_SECRET) {
    console.error("[ortho cron] CRON_SECRET no configurado");
    return NextResponse.json({ ok: false, error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const ahora = new Date();

  // 1. Marca como OVERDUE las mensualidades vencidas sin pago.
  const overdueResult = await prisma.orthoInstallment.updateMany({
    where: {
      status: "PENDING",
      paidAt: null,
      dueDate: { lt: ahora },
    },
    data: { status: "OVERDUE" },
  });

  // 2. Recalcula status de planes que tienen al menos una OVERDUE — directo
  // con Prisma (sin pasar por la action con sesión, ver comentario de arriba).
  const affected = await prisma.orthoPaymentPlan.findMany({
    where: { installments: { some: { status: "OVERDUE" } } },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      status: true,
      initialDownPayment: true,
      totalAmount: true,
      installments: {
        select: { installmentNumber: true, amount: true, dueDate: true, status: true, paidAt: true, amountPaid: true },
      },
    },
    take: 1000,
  });

  let recalculated = 0;
  let failed = 0;
  for (const plan of affected) {
    try {
      const totalPaidFromInstallments = plan.installments.reduce((sum, i) => {
        if (i.status === "PAID" && i.amountPaid) return sum + Number(i.amountPaid);
        if (i.status === "WAIVED") return sum + Number(i.amount);
        return sum;
      }, 0);
      const newPaidAmount = totalPaidFromInstallments + Number(plan.initialDownPayment);
      const newPendingAmount = Math.max(Number(plan.totalAmount) - newPaidAmount, 0);

      const statusResult = computePaymentStatus(
        plan.installments.map((i) => ({
          amount: Number(i.amount),
          dueDate: i.dueDate,
          status: i.status,
          paidAt: i.paidAt,
        })),
        ahora,
      );

      const updated = await prisma.orthoPaymentPlan.update({
        where: { id: plan.id },
        data: {
          paidAmount: newPaidAmount,
          pendingAmount: newPendingAmount,
          status: statusResult.status,
          statusUpdatedAt: ahora,
        },
        select: { id: true, patientId: true },
      });

      const transitionedToDelay =
        (plan.status !== "LIGHT_DELAY" && statusResult.status === "LIGHT_DELAY") ||
        (plan.status !== "SEVERE_DELAY" && statusResult.status === "SEVERE_DELAY");
      if (transitionedToDelay) {
        const oldestOverdue = plan.installments
          .filter((i) => i.status === "OVERDUE" || i.status === "PENDING")
          .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
        if (oldestOverdue) {
          const patient = await prisma.patient.findUnique({
            where: { id: updated.patientId },
            select: { phone: true },
          });
          if (patient?.phone) {
            await enqueueOrthoWhatsApp(prisma, {
              clinicId: plan.clinicId,
              templateKey:
                statusResult.status === "SEVERE_DELAY" ? "INSTALLMENT_OVERDUE_SEVERE" : "INSTALLMENT_OVERDUE_LIGHT",
              scheduledFor: ahora,
              patientPhone: patient.phone,
              payload: {
                installmentNumber: oldestOverdue.installmentNumber,
                daysOverdue: statusResult.daysOverdue,
                pendingMxn: Math.round(newPendingAmount),
              },
            }).catch((e) => {
              console.error("[ortho cron] WA enqueue (delay) failed (no bloquea):", e);
            });
          }
        }
      }

      recalculated++;
    } catch (e) {
      failed++;
      console.error("[ortho cron] recalc failed for", plan.id, e);
    }
  }

  // 3. INSTALLMENT_DUE_3_DAYS — instalments PENDING con dueDate en 3 días.
  const dayStart = new Date(ahora);
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
      installmentNumber: true,
      amount: true,
      dueDate: true,
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
      scheduledFor: ahora,
      patientPhone: phone,
      payload: {
        installmentNumber: inst.installmentNumber,
        fecha: inst.dueDate.toISOString().slice(0, 10),
        amountMxn: Math.round(Number(inst.amount)),
      },
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
    timestamp: ahora.toISOString(),
  });
}
