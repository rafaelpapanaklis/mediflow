// Fase 0 — verifica que SOLO Gabriela tiene data en tablas ortho viejas.
// Si hay otros pacientes, ABORTA y reporta a Rafael.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const totals: Record<string, { count: number; patients: Set<string> }> = {};

  async function tally(name: string, rows: { patientId?: string | null }[]) {
    const ids = new Set<string>();
    for (const r of rows) if (r.patientId) ids.add(r.patientId);
    totals[name] = { count: rows.length, patients: ids };
  }

  await tally("orthodonticTreatmentPlan", await db.orthodonticTreatmentPlan.findMany({ select: { patientId: true } }));
  await tally("orthodonticDiagnosis", await db.orthodonticDiagnosis.findMany({ select: { patientId: true } }));
  // orthodonticPhase no tiene patientId — join via treatmentPlan
  const phases = await db.orthodonticPhase.findMany({ select: { treatmentPlan: { select: { patientId: true } } } });
  totals.orthodonticPhase = { count: phases.length, patients: new Set(phases.map((p) => p.treatmentPlan.patientId)) };
  await tally("orthodonticControlAppointment", await db.orthodonticControlAppointment.findMany({ select: { patientId: true } }));
  await tally("orthodonticConsent", await db.orthodonticConsent.findMany({ select: { patientId: true } }));
  await tally("orthodonticDigitalRecord", await db.orthodonticDigitalRecord.findMany({ select: { patientId: true } }));
  await tally("orthoPhotoSet", await db.orthoPhotoSet.findMany({ select: { patientId: true } }));
  await tally("orthoWireStep", await db.orthoWireStep.findMany({ select: { patientId: true } }));
  await tally("orthoTreatmentCard", await db.orthoTreatmentCard.findMany({ select: { patientId: true } }));
  await tally("orthoTAD", await db.orthoTAD.findMany({ select: { patientId: true } }));
  await tally("orthoNpsSchedule", await db.orthoNpsSchedule.findMany({ select: { patientId: true } }));
  await tally("orthoReferralCode", await db.orthoReferralCode.findMany({ select: { patientId: true } }));
  await tally("orthoSignAtHomePackage", await db.orthoSignAtHomePackage.findMany({ select: { patientId: true } }));
  // Models without patientId direct:
  const paymentPlans = await db.orthoPaymentPlan.findMany({ select: { patientId: true } });
  totals.orthoPaymentPlan = { count: paymentPlans.length, patients: new Set(paymentPlans.map((p) => p.patientId)) };

  let totalRows = 0;
  let totalPatients = new Set<string>();
  for (const [, v] of Object.entries(totals)) {
    totalRows += v.count;
    v.patients.forEach((p) => totalPatients.add(p));
  }

  console.log("=== Inventory ortho v1 data ===\n");
  console.log("Table".padEnd(38), "Rows".padStart(6), "Unique patients");
  console.log("-".repeat(80));
  for (const [name, v] of Object.entries(totals)) {
    console.log(name.padEnd(38), String(v.count).padStart(6), v.patients.size);
  }
  console.log("-".repeat(80));
  console.log("TOTAL".padEnd(38), String(totalRows).padStart(6), totalPatients.size, "unique patients");

  if (totalPatients.size > 1) {
    console.log("\nPatients with ortho data:");
    for (const pid of totalPatients) {
      const pt = await db.patient.findUnique({ where: { id: pid }, select: { firstName: true, lastName: true, patientNumber: true } });
      console.log(`  - ${pt?.firstName} ${pt?.lastName} (${pt?.patientNumber}) · id=${pid}`);
    }
    console.log("\n❌ ABORT: more than 1 patient has ortho v1 data. Demolition would lose other patients' data. Report to Rafael.");
    process.exit(2);
  }

  if (totalPatients.size === 1) {
    const pid = totalPatients.values().next().value!;
    const pt = await db.patient.findUnique({ where: { id: pid }, select: { firstName: true, lastName: true, patientNumber: true } });
    console.log(`\n✅ OK: solo 1 paciente con data — ${pt?.firstName} ${pt?.lastName} (${pt?.patientNumber}). Demolition segura.`);
  } else {
    console.log("\n⚠️  Sin data en tablas v1 — la demolition no impacta data.");
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
