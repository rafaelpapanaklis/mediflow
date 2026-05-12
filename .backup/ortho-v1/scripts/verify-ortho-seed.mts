// Smoke check de los 4 bugs (1-4) sobre la BD de Gabriela.
// Uso: $env:DATABASE_URL = "..."; npx tsx scripts/verify-ortho-seed.mts

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const patient = await db.patient.findFirst({
    where: { patientNumber: "ORT-DEMO-GABY" },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!patient) {
    console.error("Paciente Gabriela no encontrado");
    process.exit(1);
  }
  console.log(`Paciente: ${patient.firstName} ${patient.lastName} · ${patient.id}`);

  // BUG 1 — stats hero
  const controls = await db.orthodonticControlAppointment.findMany({
    where: { patientId: patient.id },
    select: { scheduledAt: true, performedAt: true, attendance: true, monthInTreatment: true },
    orderBy: { scheduledAt: "asc" },
  });
  console.log(`\nBUG 1 — Controles: ${controls.length}`);
  const attended = controls.filter((c) => c.attendance === "ATTENDED" && c.performedAt).length;
  const noShow = controls.filter((c) => c.attendance === "NO_SHOW").length;
  const future = controls.filter(
    (c) => c.scheduledAt.getTime() > Date.now(),
  ).length;
  console.log(`  ATTENDED (perf): ${attended}`);
  console.log(`  NO_SHOW: ${noShow}`);
  console.log(`  Future: ${future}`);
  const past = controls.filter(
    (c) => c.performedAt != null || c.scheduledAt.getTime() < Date.now(),
  );
  const pct = past.length > 0
    ? Math.round((past.filter((c) => c.attendance === "ATTENDED").length / past.length) * 100)
    : 100;
  console.log(`  Asistencia (pasados): ${pct}%  (espera ≈ 92-93)`);

  const compl = await db.auditLog.findFirst({
    where: {
      action: "ortho.elastics.compliance.recorded",
      entityType: "OrthodonticTreatmentPlan",
    },
    orderBy: { createdAt: "desc" },
    select: { changes: true },
  });
  const complPct =
    (compl?.changes as any)?._created?.after?.compliancePct ?? null;
  console.log(`  Compliance elásticos: ${complPct}%  (espera 78)`);

  // BUG 2 — próxima cita
  const nextCtrl = controls.find(
    (c) => c.scheduledAt.getTime() > Date.now() && c.attendance !== "NO_SHOW",
  );
  console.log(`\nBUG 2 — Próxima cita:`);
  console.log(
    `  scheduledAt: ${nextCtrl?.scheduledAt?.toISOString() ?? "—"}  (espera 2026-05-13T16:30Z)`,
  );

  // BUG 3 — foto-sets
  const sets = await db.orthoPhotoSet.findMany({
    where: { patientId: patient.id },
    select: {
      id: true,
      setType: true,
      capturedAt: true,
      photoFrontalId: true,
      photoProfileId: true,
      photoSmileId: true,
      photoIntraFrontalId: true,
      photoIntraLateralRId: true,
      photoIntraLateralLId: true,
      photoOcclusalUpperId: true,
      photoOcclusalLowerId: true,
    },
    orderBy: { capturedAt: "asc" },
  });
  console.log(`\nBUG 3 — Foto-sets: ${sets.length}`);
  for (const s of sets) {
    const cnt = [
      s.photoFrontalId,
      s.photoProfileId,
      s.photoSmileId,
      s.photoIntraFrontalId,
      s.photoIntraLateralRId,
      s.photoIntraLateralLId,
      s.photoOcclusalUpperId,
      s.photoOcclusalLowerId,
    ].filter(Boolean).length;
    console.log(
      `  ${s.setType} · ${s.capturedAt.toISOString().slice(0, 10)} · ${cnt}/8 fotos`,
    );
  }

  // BUG 4 — installments
  const plan = await db.orthoPaymentPlan.findFirst({
    where: { patientId: patient.id },
    select: {
      id: true,
      totalAmount: true,
      paidAmount: true,
      pendingAmount: true,
      installmentCount: true,
      installmentAmount: true,
    },
  });
  if (plan) {
    console.log(`\nBUG 4 — PaymentPlan:`);
    console.log(
      `  total ${Number(plan.totalAmount)} · paid ${Number(plan.paidAmount)} · pending ${Number(plan.pendingAmount)}`,
    );
    console.log(`  count ${plan.installmentCount} · amount ${Number(plan.installmentAmount)}`);
    const insts = await db.orthoInstallment.findMany({
      where: { paymentPlanId: plan.id },
      select: { installmentNumber: true, amount: true, status: true, dueDate: true },
      orderBy: { installmentNumber: "asc" },
    });
    let sum = 0;
    let paidSum = 0;
    for (const i of insts) {
      sum += Number(i.amount);
      if (i.status === "PAID") paidSum += Number(i.amount);
      console.log(
        `   #${i.installmentNumber} · $${Number(i.amount)} · ${i.status} · due ${i.dueDate.toISOString().slice(0, 10)}`,
      );
    }
    console.log(
      `  Sum installments: $${sum} (espera 33336 ≈ ${Number(plan.totalAmount)})`,
    );
    console.log(`  Sum PAID: $${paidSum} (espera 16668)`);
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
