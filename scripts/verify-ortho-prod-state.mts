// Diagnóstico exhaustivo del estado prod del paciente Gabriela.
// Reporta tabla DELTA contra mockup verbatim para cada tabla relevante.
//
// Uso: $env:DATABASE_URL = "..."; npx tsx scripts/verify-ortho-prod-state.mts

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const PATIENT_ID = "cmouwaz1z0001v3qhqigop9nj";

interface Row {
  table: string;
  field: string;
  bd: string;
  expected: string;
  delta: "OK" | "MISMATCH" | "MISSING";
}
const rows: Row[] = [];

function add(
  table: string,
  field: string,
  bd: unknown,
  expected: string,
  matcher?: (bdStr: string) => boolean,
) {
  const bdStr = bd === null || bd === undefined ? "—" : String(bd);
  let delta: Row["delta"] = "OK";
  if (bdStr === "—") delta = "MISSING";
  else if (matcher) delta = matcher(bdStr) ? "OK" : "MISMATCH";
  else if (bdStr !== expected) delta = "MISMATCH";
  rows.push({ table, field, bd: bdStr, expected, delta });
}

async function main() {
  // ── 1. ortho_treatment_plans ─────────────────────────────────────────────
  const plan = await db.orthodonticTreatmentPlan.findFirst({
    where: { patientId: PATIENT_ID, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  console.log(
    `[plan] ${plan?.id ?? "NOT FOUND"} · status=${plan?.status} · phase=?`,
  );
  if (!plan) {
    console.error("Sin plan ortodóntico — abortar.");
    process.exit(1);
  }
  const phaseRows = await db.orthodonticPhase.findMany({
    where: { treatmentPlanId: plan.id },
    orderBy: { orderIndex: "asc" },
  });
  const phaseInProgress = phaseRows.find((p) => p.status === "IN_PROGRESS");
  add("treatment_plan", "totalCostMxn", Number(plan.totalCostMxn), "33340");
  add(
    "treatment_plan",
    "estimatedDurationMonths",
    plan.estimatedDurationMonths,
    "22",
  );
  add(
    "treatment_plan",
    "currentPhase (de phases.IN_PROGRESS)",
    phaseInProgress?.phaseKey ?? "—",
    "LEVELING",
  );
  add(
    "treatment_plan",
    "prescriptionSlot",
    plan.prescriptionSlot,
    "MBT_022",
  );
  add(
    "treatment_plan",
    "technique",
    plan.technique,
    "SELF_LIGATING_METAL",
  );

  // ── 2. controls (visitas atendidas + próxima) ────────────────────────────
  const controls = await db.orthodonticControlAppointment.findMany({
    where: { patientId: PATIENT_ID },
    orderBy: { scheduledAt: "asc" },
  });
  const attended = controls.filter(
    (c) => c.attendance === "ATTENDED" && c.performedAt,
  ).length;
  const noShow = controls.filter((c) => c.attendance === "NO_SHOW").length;
  const past = controls.filter(
    (c) => c.performedAt != null || c.scheduledAt.getTime() < Date.now(),
  );
  const attendancePct =
    past.length > 0
      ? Math.round(
          (past.filter((c) => c.attendance === "ATTENDED").length / past.length) *
            100,
        )
      : 100;
  add("control_appointments", "count(ATTENDED+performed)", attended, "14");
  add("control_appointments", "count(NO_SHOW)", noShow, "1");
  add("control_appointments", "attendancePct (calculado)", `${attendancePct}%`, "92-93%");

  const future = controls.find(
    (c) =>
      c.scheduledAt.getTime() > Date.now() &&
      c.attendance !== "NO_SHOW",
  );
  add(
    "control_appointments",
    "next.scheduledAt",
    future?.scheduledAt?.toISOString() ?? "—",
    "2026-05-13T16:30:00.000Z (10:30 CDT)",
  );

  // ── 3. ortho_photo_sets ──────────────────────────────────────────────────
  const sets = await db.orthoPhotoSet.findMany({
    where: { patientId: PATIENT_ID },
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
      photoFrontal: { select: { url: true } },
    },
    orderBy: { capturedAt: "asc" },
  });
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
    add(
      "photo_sets",
      `${s.setType} fotos count`,
      `${cnt}/8`,
      "8/8",
    );
    add(
      "photo_sets",
      `${s.setType} firstPhoto.url`,
      s.photoFrontal?.url
        ? s.photoFrontal.url.slice(0, 60) + "…"
        : "—",
      "URL no vacía",
      (v) => v !== "—" && v.length > 5,
    );
  }
  if (!sets.find((s) => s.setType === "T0"))
    add("photo_sets", "T0 set", "—", "set existe", () => false);
  if (!sets.find((s) => s.setType === "T1"))
    add("photo_sets", "T1 set", "—", "set existe", () => false);

  // ── 4. ortho_payment_plan + installments ─────────────────────────────────
  const paymentPlan = await db.orthoPaymentPlan.findFirst({
    where: { patientId: PATIENT_ID },
  });
  if (paymentPlan) {
    add(
      "payment_plan",
      "totalAmount",
      Number(paymentPlan.totalAmount),
      "33340",
    );
    add(
      "payment_plan",
      "paidAmount",
      Number(paymentPlan.paidAmount),
      "16668",
    );
    add(
      "payment_plan",
      "installmentCount",
      paymentPlan.installmentCount,
      "8",
    );
    add(
      "payment_plan",
      "installmentAmount",
      Number(paymentPlan.installmentAmount),
      "4167",
    );
    const insts = await db.orthoInstallment.findMany({
      where: { paymentPlanId: paymentPlan.id },
      orderBy: { installmentNumber: "asc" },
    });
    add(
      "installments",
      "count",
      insts.length,
      "8",
    );
    add(
      "installments",
      "PAID count",
      insts.filter((i) => i.status === "PAID").length,
      "4",
    );
    add(
      "installments",
      "PENDING count",
      insts.filter((i) => i.status === "PENDING").length,
      "4",
    );
    add(
      "installments",
      "sum amounts",
      insts.reduce((a, i) => a + Number(i.amount), 0),
      "33336",
    );
  }

  // ── 5. patient_flow ──────────────────────────────────────────────────────
  const flow = await db.patientFlow.findFirst({
    where: { patientId: PATIENT_ID, exitedAt: null },
    orderBy: { enteredAt: "desc" },
  });
  add("patient_flow", "status", flow?.status, "WAITING");
  add("patient_flow", "chair", flow?.chair, "Sillón 2");
  add(
    "patient_flow",
    "enteredAt (hora HH:MM)",
    flow?.enteredAt
      ? `${String(flow.enteredAt.getUTCHours()).padStart(2, "0")}:${String(
          flow.enteredAt.getUTCMinutes(),
        ).padStart(2, "0")}`
      : "—",
    "16:18 UTC (10:18 CDT)",
    (v) => /^\d{2}:\d{2}/.test(v),
  );

  // ── 6. inboxMessage WHATSAPP ─────────────────────────────────────────────
  const threads = await db.inboxThread.findMany({
    where: { patientId: PATIENT_ID, channel: "WHATSAPP" },
    include: { messages: true },
  });
  const totalMsgs = threads.reduce((a, t) => a + t.messages.length, 0);
  add("inbox_messages", "WHATSAPP threads", threads.length, "1");
  add("inbox_messages", "WHATSAPP messages count", totalMsgs, "3");
  if (totalMsgs > 0) {
    const allMsgs = threads
      .flatMap((t) => t.messages)
      .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    add(
      "inbox_messages",
      "first OUT direction",
      allMsgs[0]?.direction,
      "OUT",
    );
    add(
      "inbox_messages",
      "second IN direction",
      allMsgs[1]?.direction,
      "IN",
    );
  }

  // ── 7. ortho_quote_scenarios ─────────────────────────────────────────────
  const scenarios = await db.orthoQuoteScenario.findMany({
    where: { treatmentPlanId: plan.id },
  });
  add("quote_scenarios", "count", scenarios.length, "≥3 (mockup G5 Open Choice)");

  // ── 8. ortho_retention_regimens ──────────────────────────────────────────
  const regimen = await db.orthoRetentionRegimen.findFirst({
    where: { treatmentPlanId: plan.id },
  });
  add(
    "retention_regimens",
    "exists",
    regimen ? "yes" : "no",
    "yes (al avanzar a Retention) o no (todavía LEVELING)",
    (v) => true,
  );

  // ── 9. ortho_nps_schedules ───────────────────────────────────────────────
  const nps = await db.orthoNpsSchedule.findMany({
    where: { treatmentPlanId: plan.id },
  });
  add(
    "nps_schedules",
    "count",
    nps.length,
    "≥0 (no aplica hasta debond)",
    () => true,
  );

  // ── 10. ortho_referral_codes ─────────────────────────────────────────────
  const ref = await db.orthoReferralCode.findFirst({
    where: { treatmentPlanId: plan.id },
  });
  add(
    "referral_codes",
    "code",
    ref?.code ?? "—",
    "GABY26",
  );

  // ── 11. doctor de la próxima cita (Rafael reportó "doctor = paciente") ─
  if (future?.attendedById) {
    const doctor = await db.user.findUnique({
      where: { id: future.attendedById },
      select: { firstName: true, lastName: true, role: true },
    });
    add(
      "control_appointments.next.doctor",
      "name",
      doctor ? `${doctor.firstName} ${doctor.lastName}` : "—",
      "Doctor real (no nombre del paciente)",
      (v) => !v.includes("Gabriela") && !v.includes("Hernández"),
    );
    add(
      "control_appointments.next.doctor",
      "role",
      doctor?.role ?? "—",
      "DOCTOR",
    );
  } else {
    add(
      "control_appointments.next.attendedById",
      "value",
      "null",
      "doctor asignado",
      () => false,
    );
  }

  // ── 12. compliance audit log ─────────────────────────────────────────────
  const compl = await db.auditLog.findFirst({
    where: {
      action: "ortho.elastics.compliance.recorded",
      entityType: "OrthodonticTreatmentPlan",
      entityId: plan.id,
    },
    orderBy: { createdAt: "desc" },
  });
  add(
    "audit_log.elastics_compliance",
    "compliancePct",
    (compl?.changes as any)?._created?.after?.compliancePct ?? "—",
    "78",
  );

  // ── Render tabla ─────────────────────────────────────────────────────────
  const widths = {
    table: Math.max(20, ...rows.map((r) => r.table.length)),
    field: Math.max(28, ...rows.map((r) => r.field.length)),
    bd: Math.max(12, ...rows.map((r) => r.bd.length)),
    expected: Math.max(12, ...rows.map((r) => r.expected.length)),
  };
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
  console.log(
    `\n${pad("TABLE", widths.table)} | ${pad("FIELD", widths.field)} | ${pad(
      "BD",
      widths.bd,
    )} | ${pad("EXPECTED", widths.expected)} | DELTA`,
  );
  console.log("-".repeat(widths.table + widths.field + widths.bd + widths.expected + 25));
  let mismatchCount = 0;
  let missingCount = 0;
  for (const r of rows) {
    if (r.delta === "MISMATCH") mismatchCount++;
    if (r.delta === "MISSING") missingCount++;
    const tag = r.delta === "OK" ? "✅" : r.delta === "MISMATCH" ? "❌" : "⚠️ ";
    console.log(
      `${pad(r.table, widths.table)} | ${pad(r.field, widths.field)} | ${pad(
        r.bd,
        widths.bd,
      )} | ${pad(r.expected, widths.expected)} | ${tag} ${r.delta}`,
    );
  }
  console.log(
    `\n${rows.length} rows · ${rows.filter((r) => r.delta === "OK").length} OK · ${mismatchCount} MISMATCH · ${missingCount} MISSING`,
  );

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
