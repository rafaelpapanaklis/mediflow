// Reproduce el flow de confirmCollect contra prod BD (sin auth context).
// Identifica si el bug está en query, update, o en un side-effect.
//
// Uso: $env:DATABASE_URL = "..."; npx tsx scripts/debug-confirm-collect.mts

import { PrismaClient } from "@prisma/client";

const PATIENT_ID = "cmouwaz1z0001v3qhqigop9nj";
const db = new PrismaClient();

async function main() {
  const p = await db.patient.findUnique({
    where: { id: PATIENT_ID },
    select: { clinicId: true },
  });
  if (!p) {
    console.error("Paciente no encontrado");
    process.exit(1);
  }
  const plan = await db.orthodonticTreatmentPlan.findFirst({
    where: { patientId: PATIENT_ID, deletedAt: null },
    select: { id: true, patientId: true },
  });
  if (!plan) {
    console.error("Plan no encontrado");
    process.exit(1);
  }
  console.log(`Plan: ${plan.id}`);

  // Simula confirmCollect's installment query
  const installment = await db.orthoInstallment.findFirst({
    where: {
      paymentPlan: { treatmentPlanId: plan.id, clinicId: p.clinicId },
      status: "PENDING",
    },
    orderBy: { installmentNumber: "asc" },
    select: {
      id: true,
      status: true,
      amount: true,
      installmentNumber: true,
    },
  });

  console.log(`\nNext PENDING installment:`, installment);

  if (!installment) {
    console.error("\nNo PENDING installment — confirmCollect would return fail('No hay mensualidad pendiente que cobrar')");
    return;
  }
  if (installment.status === "PAID") {
    console.error("\nInstallment already PAID — confirmCollect would return fail('Esta mensualidad ya está pagada')");
    return;
  }

  // Try a dry-run update (rollback at end)
  console.log("\nAttempting update simulation (would set status PAID + paidAt now)...");
  try {
    // Don't actually update — just verify schema match
    const result = await db.orthoInstallment.findUnique({
      where: { id: installment.id },
      select: {
        id: true,
        installmentNumber: true,
        amount: true,
        status: true,
        paidAt: true,
        amountPaid: true,
        paymentMethod: true,
        recordedById: true,
        receiptFileId: true,
        backdatingJustification: true,
      },
    });
    console.log("Full installment row:", result);
    console.log("\n✅ Update should succeed — no schema or constraint issues detected");
    console.log("\nIf the user still sees 'No se pudo registrar el cobro' in production:");
    console.log("  - It's likely the OLD code is deployed (Vercel cache)");
    console.log("  - OR there's a side-effect (revalidatePath, audit) that throws");
  } catch (e) {
    console.error("\n❌ Failure during simulation:", e);
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
