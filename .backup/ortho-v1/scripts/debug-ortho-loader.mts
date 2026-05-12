// Versión inline del loader · evita resolver @-paths con tsx puro.
// Reproduce computeAttendancePct + readLatestCompliancePct + adapters
// críticos contra prod BD.
//
// Uso: $env:DATABASE_URL = "..."; npx tsx scripts/debug-ortho-loader.mts

import { PrismaClient } from "@prisma/client";

const PATIENT_ID = "cmouwaz1z0001v3qhqigop9nj";
const db = new PrismaClient();

async function main() {
  const p = await db.patient.findUnique({
    where: { id: PATIENT_ID },
    select: { clinicId: true, firstName: true, lastName: true },
  });
  if (!p) {
    console.error("Paciente no encontrado");
    process.exit(1);
  }
  console.log(`Paciente: ${p.firstName} ${p.lastName} · clinicId=${p.clinicId}`);

  // ── Plan ─────────────────────────────────────────────────────────────────
  const plan = await db.orthodonticTreatmentPlan.findFirst({
    where: { patientId: PATIENT_ID, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!plan) {
    console.error("Plan no encontrado");
    process.exit(1);
  }
  console.log(`Plan: ${plan.id} · status=${plan.status}`);

  // ── computeAttendancePct (replicado del loader) ──────────────────────────
  const controls = await db.orthodonticControlAppointment.findMany({
    where: { patientId: PATIENT_ID, clinicId: p.clinicId },
    orderBy: { scheduledAt: "desc" },
    take: 60,
  });
  const now = Date.now();
  const past = controls
    .filter(
      (c) => c.performedAt != null || c.scheduledAt.getTime() < now,
    )
    .sort((a, b) => {
      const aT = (a.performedAt ?? a.scheduledAt).getTime();
      const bT = (b.performedAt ?? b.scheduledAt).getTime();
      return bT - aT;
    })
    .slice(0, 12);
  const attendancePct =
    past.length === 0
      ? 100
      : Math.round(
          (past.filter((c) => c.attendance === "ATTENDED").length / past.length) *
            100,
        );
  console.log(`\n=== ATTENDANCE PCT ===`);
  console.log(`Total controls: ${controls.length}`);
  console.log(`Past (window 12): ${past.length}`);
  console.log(
    `ATTENDED in window: ${past.filter((c) => c.attendance === "ATTENDED").length}`,
  );
  console.log(`attendancePct = ${attendancePct}%`);

  // ── readLatestCompliancePct (replicado) ──────────────────────────────────
  const auditEntry = await db.auditLog.findFirst({
    where: {
      clinicId: p.clinicId,
      entityType: "OrthodonticTreatmentPlan",
      entityId: plan.id,
      action: "ortho.elastics.compliance.recorded",
    },
    orderBy: { createdAt: "desc" },
    select: { changes: true, createdAt: true },
  });
  const changes = auditEntry?.changes as
    | { _created?: { after?: { compliancePct?: number } } }
    | null
    | undefined;
  const elasticsCompliancePct =
    typeof changes?._created?.after?.compliancePct === "number"
      ? Math.round(changes._created.after.compliancePct)
      : 0;
  console.log(`\n=== ELASTICS COMPLIANCE PCT ===`);
  console.log(`Audit entry exists: ${!!auditEntry}`);
  console.log(`Audit createdAt: ${auditEntry?.createdAt?.toISOString() ?? "—"}`);
  console.log(`changes._created.after.compliancePct: ${changes?._created?.after?.compliancePct ?? "—"}`);
  console.log(`elasticsCompliancePct = ${elasticsCompliancePct}%`);

  // ── resolveNextAppointmentDoctor (replicado) ─────────────────────────────
  const nextCtrl = await db.orthodonticControlAppointment.findFirst({
    where: {
      clinicId: p.clinicId,
      patientId: PATIENT_ID,
      scheduledAt: { gte: new Date() },
      attendance: { not: "NO_SHOW" },
    },
    orderBy: { scheduledAt: "asc" },
    select: {
      attendedById: true,
      attendedBy: { select: { firstName: true, lastName: true } },
    },
  });
  console.log(`\n=== NEXT APPT DOCTOR ===`);
  console.log(`attendedById: ${nextCtrl?.attendedById ?? "null"}`);
  console.log(`attendedBy: ${nextCtrl?.attendedBy ? `${nextCtrl.attendedBy.firstName} ${nextCtrl.attendedBy.lastName}` : "—"}`);

  // ── PhotoSets adaptados ──────────────────────────────────────────────────
  const photoSets = await db.orthoPhotoSet.findMany({
    where: { patientId: PATIENT_ID },
    include: {
      photoFrontal: { select: { url: true } },
      photoProfile: { select: { url: true } },
      photoSmile: { select: { url: true } },
      photoIntraFrontal: { select: { url: true } },
      photoIntraLateralR: { select: { url: true } },
      photoIntraLateralL: { select: { url: true } },
      photoOcclusalUpper: { select: { url: true } },
      photoOcclusalLower: { select: { url: true } },
    },
    orderBy: { capturedAt: "asc" },
  });
  console.log(`\n=== PHOTO SETS ===`);
  for (const s of photoSets) {
    const slots = {
      photoFrontal: !!s.photoFrontal?.url,
      photoProfile: !!s.photoProfile?.url,
      photoSmile: !!s.photoSmile?.url,
      photoIntraFrontal: !!s.photoIntraFrontal?.url,
      photoIntraLateralR: !!s.photoIntraLateralR?.url,
      photoIntraLateralL: !!s.photoIntraLateralL?.url,
      photoOcclusalUpper: !!s.photoOcclusalUpper?.url,
      photoOcclusalLower: !!s.photoOcclusalLower?.url,
    };
    const cnt = Object.values(slots).filter(Boolean).length;
    console.log(`${s.setType} · setId=${s.id} · ${cnt}/8 fotos · firstUrl=${s.photoFrontal?.url ?? "—"}`);
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
