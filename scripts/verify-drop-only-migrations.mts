// Verifica el estado en prod de las 3 migraciones marcadas "drop_only"
// por scripts/diagnose-prisma-migrations.mts (no introspectables solo
// con CREATE TABLE/TYPE/COLUMN/VALUE).
//
// Uso:
//   $env:DATABASE_URL = "postgresql://..."
//   npx tsx scripts/verify-drop-only-migrations.mts

import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();

  console.log("=== 20260425130000_drop_legacy_appt_columns ===");
  const legacyCols = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appointments'
      AND column_name IN ('date', 'startTime', 'endTime', 'durationMins')
  `;
  console.log(`  Legacy columns still present: ${legacyCols.length === 0 ? "NONE (applied)" : legacyCols.map((c) => c.column_name).join(", ") + " (NOT applied)"}`);

  const defaults = await prisma.$queryRaw<
    { column_name: string; column_default: string | null }[]
  >`
    SELECT column_name, column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appointments'
      AND column_name IN ('startsAt', 'endsAt')
  `;
  for (const d of defaults) {
    console.log(`  ${d.column_name}: default=${d.column_default ?? "NULL"} ${d.column_default === null ? "(applied — default dropped)" : "(NOT applied)"}`);
  }

  console.log("\n=== 20260430000000_perf_indexes ===");
  const expectedIndexes = [
    "patients_clinicId_status_idx",
    "patients_clinicId_createdAt_idx",
    "patients_primaryDoctorId_idx",
    "medical_records_clinicId_patientId_visitDate_idx",
    "medical_records_clinicId_doctorId_idx",
    "invoices_clinicId_status_createdAt_idx",
    "invoices_patientId_idx",
    "invoices_clinicId_balance_partial_idx",
    "payments_invoiceId_idx",
    "prescriptions_medicalRecordId_idx",
    "prescriptions_clinicId_issuedAt_idx",
    "patient_files_clinicId_patientId_createdAt_idx",
    "patient_files_patientId_category_idx",
    "treatment_plans_clinicId_patientId_status_idx",
    "treatment_sessions_treatmentId_idx",
  ];
  const existingIndexes = (
    await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY(${expectedIndexes}::text[])
    `
  ).map((r) => r.indexname);
  const existingSet = new Set(existingIndexes);
  let presentCount = 0;
  for (const idx of expectedIndexes) {
    const present = existingSet.has(idx);
    if (present) presentCount++;
    if (!present) console.log(`  MISSING: ${idx}`);
  }
  console.log(
    `  ${presentCount}/${expectedIndexes.length} indexes present ${presentCount === expectedIndexes.length ? "(applied)" : "(partial)"}`
  );

  console.log("\n=== 20260504210000_drop_implant_traceability_trigger ===");
  const trig = await prisma.$queryRaw<{ tgname: string }[]>`
    SELECT tgname FROM pg_trigger
    WHERE tgname = 'protect_implant_traceability_trg'
      AND tgrelid = '"implants"'::regclass::oid
  `;
  console.log(
    `  Trigger protect_implant_traceability_trg: ${trig.length === 0 ? "NOT present (applied)" : "STILL PRESENT (NOT applied)"}`
  );

  const fn = await prisma.$queryRaw<{ proname: string }[]>`
    SELECT proname FROM pg_proc
    WHERE proname = 'protect_implant_traceability'
      AND pronamespace = 'public'::regnamespace::oid
  `;
  console.log(
    `  Function protect_implant_traceability: ${fn.length === 0 ? "NOT present (applied)" : "STILL PRESENT (NOT applied)"}`
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
