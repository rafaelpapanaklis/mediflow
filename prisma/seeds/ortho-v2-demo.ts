// Seed Ortodoncia v2 · caso completo demo Gabriela Hernández Ruiz.
//
// Idempotente: usa upsert/createMany skipDuplicates para que se pueda correr
// múltiples veces sin error. Asume que el paciente Gabriela ya existe
// (patientId hardcodeado de prod).
//
// Para correr:
//   npx tsx prisma/seeds/ortho-v2-demo.ts
//
// Requiere que la migration 20260512170000_ortho_v2_rewrite ya se haya
// aplicado en la BD destino (Supabase Studio o migrate deploy).

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// Constantes hardcodeadas del paciente demo
const GABRIELA_PATIENT_ID = "cmouwaz1z0001v3qhqigop9nj";
const CASE_CODE = "ORT-2026-001";

async function main() {
  // Verificar paciente existe
  const patient = await db.patient.findUnique({
    where: { id: GABRIELA_PATIENT_ID },
    select: { id: true, clinicId: true, primaryDoctorId: true, firstName: true, lastName: true },
  });
  if (!patient) {
    console.error(
      `Paciente Gabriela (${GABRIELA_PATIENT_ID}) no existe — corre primero el seed base.`,
    );
    process.exit(1);
  }
  if (!patient.primaryDoctorId) {
    console.error("Paciente sin primaryDoctorId — asigna doctor antes de seedear el caso.");
    process.exit(1);
  }
  console.log(`✓ Paciente: ${patient.firstName} ${patient.lastName}`);

  // 1. OrthoCase
  const caso = await db.orthoCase.upsert({
    where: { patientId: GABRIELA_PATIENT_ID },
    create: {
      clinicId: patient.clinicId,
      patientId: GABRIELA_PATIENT_ID,
      caseCode: CASE_CODE,
      status: "ACTIVE",
      currentPhase: "LEVELING",
      primaryDoctorId: patient.primaryDoctorId,
      startedAt: new Date("2025-09-08"),
      estimatedEnd: new Date("2027-03-15"),
    },
    update: {
      status: "ACTIVE",
      currentPhase: "LEVELING",
    },
  });
  console.log(`✓ OrthoCase ${caso.caseCode}`);

  // 2. OrthoDiagnosis
  await db.orthoDiagnosis.upsert({
    where: { caseId: caso.id },
    create: {
      caseId: caso.id,
      angleClass: "II_DIV1",
      subCaninoR: "II_DIV1",
      subCaninoL: "II_DIV1",
      overjetMm: 6,
      overbiteMm: 4,
      openBite: "NONE",
      crossBite: "NONE",
      crowdingMaxMm: 3,
      crowdingMandMm: 5,
      diastemas: [
        { teeth: [11, 21], mm: 1.5 },
        { teeth: [31, 41], mm: 0.8 },
      ] as never,
      midlineDeviation: -1.5,
      facialProfile: "CONVEX",
      skeletalPattern: "MESO",
      skeletalIssues: ["Clase II esqueletal leve"],
      tmjFindings: { noise: true, pain: false, deflexionMm: 0, openingMm: 46 } as never,
      habits: ["Respirador bucal", "Bruxismo"],
      narrative:
        "Paciente femenino 14 años · alergia Penicilina · motivo de consulta estético (alineación). Clase II División 1 con resalte 6mm, sobremordida 4mm. Apiñamiento mandibular moderado. Mesofacial, perfil convexo, Clase II esqueletal leve. ATM ruido bilateral sin dolor.",
      updatedBy: patient.primaryDoctorId,
    },
    update: {},
  });
  console.log("✓ OrthoDiagnosis");

  // 3. OrthoTreatmentPlan
  const plan = await db.orthoTreatmentPlan.upsert({
    where: { caseId: caso.id },
    create: {
      caseId: caso.id,
      appliances: ["METAL", "SELF_LIG"],
      extractions: [],
      elastics: { class: "II", hours: "18 hrs/día", side: "Bilateral" } as never,
      expanders: {} as never,
      tads: {} as never,
      objectives: [
        "Alineación completa de arcadas",
        "Corrección Clase II a Clase I",
        "Cerrar overjet a 2-3mm",
        "Cerrar diastemas 11-21 y 31-41",
      ],
      notes: "Iniciar con .014 NiTi sup/inf, control mensual. Elásticos Clase II desde cierre.",
      iprPlan: { "15-14": 0.3, "14-13": 0.3, "22-23": 0.2 } as never,
      acceptedAt: new Date("2025-09-01"),
      acceptedBy: patient.primaryDoctorId,
    },
    update: {},
  });
  console.log("✓ OrthoTreatmentPlan");

  // 4. ArchPlanned (7 arcos)
  const arches = [
    { order: 1, phase: "ALIGNMENT" as const, material: "NITI" as const, gauge: ".014", durationW: 6, status: "PAST" as const },
    { order: 2, phase: "ALIGNMENT" as const, material: "NITI" as const, gauge: ".016", durationW: 8, status: "PAST" as const },
    { order: 3, phase: "LEVELING" as const, material: "NITI" as const, gauge: ".016", durationW: 10, status: "CURRENT" as const },
    { order: 4, phase: "LEVELING" as const, material: "SS" as const, gauge: ".018", durationW: 8, status: "FUTURE" as const },
    { order: 5, phase: "SPACE_CLOSE" as const, material: "SS" as const, gauge: ".019 x .025", durationW: 12, status: "FUTURE" as const },
    { order: 6, phase: "DETAIL" as const, material: "TMA" as const, gauge: ".017 x .025", durationW: 8, status: "FUTURE" as const },
    { order: 7, phase: "FINISHING" as const, material: "BETA_TI" as const, gauge: ".019 x .025", durationW: 6, status: "FUTURE" as const },
  ];
  for (const a of arches) {
    await db.archPlanned.upsert({
      where: { planId_order: { planId: plan.id, order: a.order } },
      create: { planId: plan.id, ...a },
      update: { status: a.status },
    });
  }
  console.log(`✓ 7 ArchPlanned`);

  // 5. PhotoSets T0 + T1
  for (const stage of ["T0", "T1"] as const) {
    const date = stage === "T0" ? new Date("2025-06-15") : new Date("2025-10-15");
    await db.photoSet.upsert({
      where: { caseId_stageCode: { caseId: caso.id, stageCode: stage } },
      create: {
        caseId: caso.id,
        stageCode: stage,
        capturedAt: date,
        createdBy: patient.primaryDoctorId,
      },
      update: {},
    });
  }
  console.log("✓ 2 PhotoSets (T0, T1)");

  // 6. TreatmentCards (7 cards históricas)
  const cardsData = [
    { date: "2025-06-15", type: "FOLLOWUP" as const, p: "Primera consulta. Aceptación plan." },
    { date: "2025-07-02", type: "FOLLOWUP" as const, p: "Aceptación financiero." },
    { date: "2025-07-18", type: "INSTALLATION" as const, p: "Instalación brackets bimaxilar." },
    { date: "2025-08-15", type: "CONTROL" as const, p: "Control mensual. Cambio a .014 NiTi. Compliance 88%." },
    { date: "2025-08-22", type: "EMERGENCY" as const, p: "Bracket 34 caído. Recolocado." },
    { date: "2025-09-17", type: "CONTROL" as const, p: "Compliance 78%. Continuar .014." },
    { date: "2025-10-15", type: "CONTROL" as const, p: "Recolocar 24. Cambio a .016 NiTi. Compliance 82%." },
  ];
  for (const c of cardsData) {
    const exists = await db.treatmentCard.findFirst({
      where: { caseId: caso.id, visitDate: new Date(c.date), visitType: c.type },
    });
    if (exists) continue;
    await db.treatmentCard.create({
      data: {
        caseId: caso.id,
        visitDate: new Date(c.date),
        visitType: c.type,
        activations: [],
        elasticUse: { type: "II", prescribedHours: "18 hrs/día", reportedCompliance: 82 } as never,
        bracketsLost: c.type === "EMERGENCY" ? [34] : [],
        iprDoneDelta: {} as never,
        soap: {
          s: "Sin molestias.",
          o: "Higiene buena.",
          a: "Progreso adecuado.",
          p: c.p,
        } as never,
        homeInstr: "Elásticos 18 hrs · cera ortodóntica si molestia · cepillo interdental.",
        signedOffAt: new Date(c.date),
        createdBy: patient.primaryDoctorId,
      },
    });
  }
  console.log(`✓ ${cardsData.length} TreatmentCards`);

  // 7. FinancialPlan
  const fp = await db.financialPlan.upsert({
    where: { caseId: caso.id },
    create: {
      caseId: caso.id,
      total: 50000,
      downPayment: 8000,
      months: 18,
      monthly: 2333,
      startDate: new Date("2025-09-01"),
      scenarios: [
        { id: "A", label: "12 meses", mod: "plan", total: 50000, downPayment: 15000, months: 12, apr: 0 },
        { id: "B", label: "18 meses · ACTIVO", mod: "plan", total: 50000, downPayment: 8000, months: 18, apr: 0, active: true },
        { id: "C", label: "24 meses", mod: "credito", total: 50000, downPayment: 5000, months: 24, apr: 12 },
      ] as never,
      activeScenarioId: "B",
    },
    update: {},
  });
  console.log("✓ FinancialPlan");

  // 8. Installments (18 cuotas, 6 PAID, 1 PENDING, 11 FUTURE)
  for (let i = 1; i <= 18; i++) {
    const status = i <= 6 ? "PAID" : i === 7 ? "PENDING" : "FUTURE";
    const dueDate = new Date(fp.startDate);
    dueDate.setMonth(dueDate.getMonth() + i - 1);
    await db.installment.upsert({
      where: { financialId_number: { financialId: fp.id, number: i } },
      create: {
        financialId: fp.id,
        number: i,
        amount: 2333,
        dueDate,
        status: status as never,
        paidAt: status === "PAID" ? dueDate : null,
      },
      update: { status: status as never },
    });
  }
  console.log("✓ 18 Installments");

  // 9. RetentionPlan
  await db.retentionPlan.upsert({
    where: { caseId: caso.id },
    create: {
      caseId: caso.id,
      retUpper: "ESSIX",
      retLower: "FIXED_3_3",
      fixedGauge: ".0195",
      regimen:
        "Año 1: 24/7. Año 2-3: nocturno. Año 4: 3x/semana. Año 5+: 2x/semana.",
      checkpoints: [
        new Date("2026-10-18"),
        new Date("2027-01-18"),
        new Date("2027-07-18"),
        new Date("2028-07-18"),
        new Date("2029-07-18"),
      ],
      checkpointsDone: {} as never,
      referralCode: "GABY26",
      referralReward: { kind: "month_free", label: "1 mes gratis" } as never,
      referralsCount: 3,
    },
    update: {},
  });
  console.log("✓ RetentionPlan · código GABY26");

  // 10. Documents (3 consentimientos)
  for (const d of [
    { kind: "CONSENT" as const, title: "Consentimiento informado ortodoncia" },
    { kind: "CONSENT" as const, title: "Autorización fotografías clínicas" },
    { kind: "CONSENT" as const, title: "Asentimiento de menor (≥12 años)" },
  ]) {
    const exists = await db.orthoDocument.findFirst({
      where: { caseId: caso.id, title: d.title },
    });
    if (exists) continue;
    await db.orthoDocument.create({
      data: {
        caseId: caso.id,
        kind: d.kind,
        title: d.title,
        url: `https://demo.mediflow.mx/docs/gaby/${d.title.toLowerCase().replace(/\s+/g, "-")}.pdf`,
        signedAt: new Date("2025-07-18"),
        createdBy: patient.primaryDoctorId,
      },
    });
  }
  console.log("✓ 3 OrthoDocuments");

  // 11. CommunicationLog (5 WhatsApp samples)
  const msgs = [
    { direction: "OUT", body: "Hola Gabriela 👋 confirmamos tu cita mañana 10:30 con Dr. Méndez. Recuerda traer tus elásticos.", date: "2025-10-15T14:30:00" },
    { direction: "IN", body: "Confirmado, ahí estaré gracias", date: "2025-10-15T17:42:00" },
    { direction: "OUT", body: "Tu próxima mensualidad #8 vence el 30 oct · monto $2,333.", date: "2025-10-15T19:00:00" },
    { direction: "OUT", body: "¿Estás usando tus elásticos las horas prescritas? Responde SÍ / NO / A VECES", date: "2025-10-20T09:00:00" },
    { direction: "IN", body: "A veces, se me olvidan en la noche", date: "2025-10-20T12:14:00" },
  ];
  for (const m of msgs) {
    const exists = await db.communicationLog.findFirst({
      where: { caseId: caso.id, body: m.body },
    });
    if (exists) continue;
    await db.communicationLog.create({
      data: {
        caseId: caso.id,
        channel: "whatsapp",
        direction: m.direction,
        body: m.body,
        sentAt: new Date(m.date),
      },
    });
  }
  console.log(`✓ ${msgs.length} CommunicationLog`);

  console.log("\n✅ Seed completo · Gabriela Hernández Ruiz · case ACTIVE en fase LEVELING (arco 3/7)");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await db.$disconnect();
  process.exit(1);
});
