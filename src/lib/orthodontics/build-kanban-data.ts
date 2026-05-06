// Orthodontics — query agregada para el kanban a nivel clínica. SPEC §6.2.
// Devuelve `OrthoKanbanCard[]` listo para `groupCardsByPhase`.

import { differenceInMonths } from "date-fns";
import { prisma } from "@/lib/prisma";
import type { OrthoKanbanCard } from "@/lib/types/orthodontics";
import { progressPct } from "./kanban-helpers";
import { summarizeCompliance } from "./compliance-helpers";
import { computePaymentStatus } from "./payment-status";
import { PHASE_ORDER } from "./phase-machine";

export async function buildKanbanData(clinicId: string): Promise<OrthoKanbanCard[]> {
  const plans = await prisma.orthodonticTreatmentPlan.findMany({
    where: {
      clinicId,
      deletedAt: null,
      status: { in: ["PLANNED", "IN_PROGRESS", "RETENTION", "ON_HOLD"] },
    },
    include: {
      patient: { select: { firstName: true, lastName: true } },
      phases: { orderBy: { orderIndex: "asc" } },
      paymentPlan: {
        include: {
          installments: {
            select: { amount: true, dueDate: true, status: true, paidAt: true },
          },
        },
      },
      controls: {
        orderBy: { scheduledAt: "desc" },
        take: 3,
        select: { attendance: true, scheduledAt: true, performedAt: true },
      },
    },
    take: 500,
  });

  const cards: OrthoKanbanCard[] = plans.map((p) => {
    const monthInTreatment = p.installedAt
      ? Math.max(0, differenceInMonths(new Date(), p.installedAt))
      : 0;
    const currentPhase =
      p.phases.find((ph) => ph.status === "IN_PROGRESS")?.phaseKey ?? PHASE_ORDER[0]!;
    const compliance = summarizeCompliance(
      p.controls.map((c) => ({
        attendance: c.attendance,
        scheduledAt: c.scheduledAt,
        performedAt: c.performedAt,
      })),
    );
    const paymentSummary = p.paymentPlan
      ? computePaymentStatus(
          p.paymentPlan.installments.map((i) => ({
            amount: Number(i.amount),
            dueDate: i.dueDate,
            status: i.status,
            paidAt: i.paidAt,
          })),
        )
      : { status: "ON_TIME" as const, daysOverdue: 0, amountOverdue: 0 };
    return {
      treatmentPlanId: p.id,
      patientId: p.patientId,
      patientName: `${p.patient.firstName} ${p.patient.lastName}`.trim(),
      monthInTreatment,
      estimatedDurationMonths: p.estimatedDurationMonths,
      progressPct: progressPct(monthInTreatment, p.estimatedDurationMonths),
      currentPhaseKey: currentPhase,
      technique: p.technique,
      compliance,
      paymentStatus: paymentSummary.status,
      amountOverdueMxn: Math.round(paymentSummary.amountOverdue),
      daysOverdue: paymentSummary.daysOverdue,
    };
  });

  return cards;
}
