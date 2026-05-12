// Fase 0 cierre — borra los 2 OrthodonticDiagnosis orphans (Sergio + Andrés)
// para dejar la BD prod con SOLO Gabriela en data ortho v1 antes de demoler.
// Reporta IDs deleted. Idempotente: si ya no están, no rompe.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const TARGETS = [
  { patientNumber: "00008", expectedDxId: "92e5c6c6-6dca-4a56-b677-fde2ac5de20d" },
  { patientNumber: "00009", expectedDxId: "34e2c6c7-43ad-4be5-a373-428302917523" },
];

async function main() {
  console.log("=== Delete ortho orphan diagnoses ===\n");

  for (const t of TARGETS) {
    const patient = await db.patient.findFirst({
      where: { patientNumber: t.patientNumber },
      select: { id: true, firstName: true, lastName: true, patientNumber: true },
    });

    if (!patient) {
      console.log(`⚠️  Patient #${t.patientNumber} not found — skip.`);
      continue;
    }

    const dxes = await db.orthodonticDiagnosis.findMany({
      where: { patientId: patient.id },
      select: { id: true },
    });

    if (dxes.length === 0) {
      console.log(`✓ ${patient.firstName} ${patient.lastName} (#${patient.patientNumber}) — sin diagnoses, ya borrado.`);
      continue;
    }

    // Sanity: el SPEC dijo "solo diagnosis orphan" → si hay plan, ABORTA
    const plan = await db.orthodonticTreatmentPlan.findFirst({
      where: { patientId: patient.id },
      select: { id: true },
    });
    if (plan) {
      console.error(`❌ ${patient.firstName} ${patient.lastName} TIENE PLAN — no es orphan. ABORT.`);
      process.exit(2);
    }

    const result = await db.orthodonticDiagnosis.deleteMany({
      where: { patientId: patient.id },
    });

    console.log(
      `🗑️  ${patient.firstName} ${patient.lastName} (#${patient.patientNumber}) · patientId=${patient.id}`,
    );
    for (const dx of dxes) {
      console.log(`     deleted dx id=${dx.id}${dx.id === t.expectedDxId ? " ✓ esperado" : " ⚠️ id distinto al esperado"}`);
    }
    console.log(`     total deleted: ${result.count}`);
  }

  console.log("\n=== Done ===");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await db.$disconnect();
  process.exit(1);
});
