// Orthodontics — seed con 3 pacientes mock para QA y demos. SPEC §12 + §14.
//
// Run: npx tsx prisma/seeds/orthodontics-mock.ts
//
// Idempotente: usa upsert por patient.patientNumber + delete-cascade orto
// previo. Detecta la primera clínica DENTAL con módulo `orthodontics` activo
// y el primer DOCTOR de esa clínica.
//
// IMPORTANTE: paidAmount = initialDownPayment + sum(installments PAID).
// El trigger SQL recalc_payment_plan_status también lo recalcula al INSERT
// pero acá lo seteamos correcto desde el inicio para evitar races con el
// trigger durante la creación del seed.

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const clinic = await db.clinic.findFirst({
    where: {
      category: "DENTAL",
      clinicModules: { some: { status: "active", module: { key: "orthodontics" } } },
    },
    select: { id: true, name: true },
  });
  if (!clinic) {
    console.error(
      "[ortho-mock] No clínica DENTAL con módulo 'orthodontics' activo. " +
        "Asegúrate de aplicar la migración + crear el Module + activar ClinicModule.",
    );
    process.exit(1);
  }

  const doctor = await db.user.findFirst({
    where: { clinicId: clinic.id, role: "DOCTOR", isActive: true },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!doctor) {
    console.error("[ortho-mock] No DOCTOR activo en la clínica.");
    process.exit(1);
  }
  const clinicId = clinic.id;
  const doctorId = doctor.id;
  console.log(
    `[ortho-mock] Sembrando en clínica "${clinic.name}" con doctor ${doctor.firstName} ${doctor.lastName}.`,
  );

  // ─── CASO 1 — Andrea Reyes Domínguez (28, brackets, mes 8, LEVELING) ───
  const andrea = await upsertPatient(clinicId, {
    patientNumber: "ORT-2024-001",
    firstName: "Andrea",
    lastName: "Reyes Domínguez",
    dob: new Date("1996-07-15"),
    phone: "+529992345678",
    email: "andrea.reyes+ortho@mediflow.test",
  });
  await seedAndrea(clinicId, andrea.id, doctorId);

  // ─── CASO 2 — Sofía Hernández (12, mixta tardía, PLANNED) ───
  const sofia = await upsertPatient(clinicId, {
    patientNumber: "ORT-2024-002",
    firstName: "Sofía",
    lastName: "Hernández Vargas",
    dob: new Date("2013-05-20"),
    phone: "+529993456789",
  });
  await seedSofia(clinicId, sofia.id, doctorId);

  // ─── CASO 3 — Mauricio López (32, alineadores Smileco, mes 3) ───
  const mauricio = await upsertPatient(clinicId, {
    patientNumber: "ORT-2024-003",
    firstName: "Mauricio",
    lastName: "López Aguirre",
    dob: new Date("1992-11-08"),
    phone: "+529994567890",
    email: "mauricio.lopez+ortho@mediflow.test",
  });
  await seedMauricio(clinicId, mauricio.id, doctorId);

  console.log(
    "[ortho-mock] OK: 3 pacientes sembrados (Andrea LEVELING, Sofía PLANNED, Mauricio ALIGNMENT).",
  );
}

interface PatientSeed {
  patientNumber: string;
  firstName: string;
  lastName: string;
  dob: Date;
  phone?: string;
  email?: string;
}

async function upsertPatient(clinicId: string, p: PatientSeed) {
  const existing = await db.patient.findFirst({
    where: { clinicId, patientNumber: p.patientNumber },
    select: { id: true },
  });
  if (existing) {
    // Borra registros orto previos para mantener idempotencia.
    await db.orthodonticConsent.deleteMany({ where: { patientId: existing.id } });
    await db.orthodonticDigitalRecord.deleteMany({ where: { patientId: existing.id } });
    await db.orthodonticControlAppointment.deleteMany({ where: { patientId: existing.id } });
    await db.orthoPhotoSet.deleteMany({ where: { patientId: existing.id } });
    await db.orthoInstallment.deleteMany({
      where: { paymentPlan: { patientId: existing.id } },
    });
    await db.orthoPaymentPlan.deleteMany({ where: { patientId: existing.id } });
    await db.orthodonticPhase.deleteMany({
      where: { treatmentPlan: { patientId: existing.id } },
    });
    await db.orthodonticTreatmentPlan.deleteMany({
      where: { patientId: existing.id },
    });
    await db.orthodonticDiagnosis.deleteMany({ where: { patientId: existing.id } });
    return existing;
  }
  return db.patient.create({
    data: {
      clinicId,
      patientNumber: p.patientNumber,
      firstName: p.firstName,
      lastName: p.lastName,
      dob: p.dob,
      phone: p.phone ?? null,
      email: p.email ?? null,
      gender: "OTHER",
    },
    select: { id: true },
  });
}

const PHASES = [
  "ALIGNMENT",
  "LEVELING",
  "SPACE_CLOSURE",
  "DETAILS",
  "FINISHING",
  "RETENTION",
] as const;

async function seedAndrea(clinicId: string, patientId: string, doctorId: string) {
  const dx = await db.orthodonticDiagnosis.create({
    data: {
      patientId,
      clinicId,
      diagnosedById: doctorId,
      diagnosedAt: new Date("2024-03-12"),
      angleClassRight: "CLASS_II_DIV_1",
      angleClassLeft: "CLASS_II_DIV_1",
      overbiteMm: 4.0,
      overbitePercentage: 35,
      overjetMm: 6.0,
      midlineDeviationMm: 1.5,
      crossbite: false,
      openBite: false,
      crowdingUpperMm: 4.0,
      crowdingLowerMm: 1.5,
      etiologyDental: true,
      habits: ["DIGITAL_SUCKING"],
      habitsDescription: "Succión digital cesada en infancia (~6 años).",
      dentalPhase: "PERMANENT",
      clinicalSummary:
        "Paciente femenina de 28 años con maloclusión clase II división 1 bilateral, " +
        "overjet aumentado 6mm, overbite profundo 4mm/35%, apiñamiento moderado superior 4mm. " +
        "Plan: extracción de premolares 14 y 24, brackets metálicos por 18 meses con anclaje moderado.",
    },
  });

  const plan = await db.orthodonticTreatmentPlan.create({
    data: {
      diagnosisId: dx.id,
      patientId,
      clinicId,
      technique: "METAL_BRACKETS",
      estimatedDurationMonths: 18,
      startDate: new Date("2024-04-15"),
      installedAt: new Date("2024-04-15"),
      totalCostMxn: 47200,
      anchorageType: "MODERATE",
      extractionsRequired: true,
      extractionsTeethFdi: [14, 24],
      treatmentObjectives: "AESTHETIC_AND_FUNCTIONAL",
      patientGoals: "Mejorar la mordida y la estética. Trabajo en atención al cliente.",
      retentionPlanText:
        "Retenedor fijo lingual 3-3 inferior + retenedor removible Hawley superior. " +
        "24h por 6 meses, luego nocturno permanente.",
      status: "IN_PROGRESS",
    },
  });

  await db.orthodonticPhase.createMany({
    data: PHASES.map((phaseKey, idx) => ({
      treatmentPlanId: plan.id,
      clinicId,
      phaseKey,
      orderIndex: idx,
      status:
        idx === 0
          ? ("COMPLETED" as const)
          : idx === 1
            ? ("IN_PROGRESS" as const)
            : ("NOT_STARTED" as const),
      startedAt:
        idx === 0
          ? new Date("2024-04-15")
          : idx === 1
            ? new Date("2024-10-15")
            : null,
      completedAt: idx === 0 ? new Date("2024-10-15") : null,
      expectedEndAt: idx === 1 ? new Date("2025-02-15") : null,
    })),
  });

  // Plan de pagos: 4000 enganche + 18 × 2400 = 47200. 7 pagadas (jul-jun 2024).
  // paidAmount = 4000 + 7*2400 = 20,800. pendingAmount = 47200 - 20800 = 26,400.
  const paidInstallments = 7;
  const installmentAmount = 2400;
  const initialDownPayment = 4000;
  const totalAmount = 47200;
  const paidAmount = initialDownPayment + paidInstallments * installmentAmount;
  const pendingAmount = totalAmount - paidAmount;
  const payPlan = await db.orthoPaymentPlan.create({
    data: {
      treatmentPlanId: plan.id,
      patientId,
      clinicId,
      totalAmount,
      initialDownPayment,
      installmentAmount,
      installmentCount: 18,
      startDate: new Date("2024-04-15"),
      endDate: new Date("2025-09-15"),
      paymentDayOfMonth: 15,
      paidAmount,
      pendingAmount,
      status: "ON_TIME",
      preferredPaymentMethod: "DEBIT_CARD",
    },
  });

  for (let i = 1; i <= 18; i++) {
    const dueDate = new Date("2024-05-15");
    dueDate.setMonth(dueDate.getMonth() + (i - 1));
    const paid = i <= paidInstallments;
    await db.orthoInstallment.create({
      data: {
        paymentPlanId: payPlan.id,
        clinicId,
        installmentNumber: i,
        amount: installmentAmount,
        dueDate,
        status: paid ? "PAID" : "PENDING",
        paidAt: paid ? new Date(dueDate.getTime() + 86_400_000) : null,
        amountPaid: paid ? installmentAmount : null,
        paymentMethod: paid ? "DEBIT_CARD" : null,
        recordedById: paid ? doctorId : null,
      },
    });
  }

  // 8 controles: mes 7 NO_SHOW, resto ATTENDED.
  for (let m = 1; m <= 8; m++) {
    await db.orthodonticControlAppointment.create({
      data: {
        treatmentPlanId: plan.id,
        patientId,
        clinicId,
        scheduledAt: new Date(2024, 3 + m, 15),
        performedAt: m === 7 ? null : new Date(2024, 3 + m, 15),
        monthInTreatment: m,
        attendance: m === 7 ? "NO_SHOW" : "ATTENDED",
        attendedById: m === 7 ? null : doctorId,
        hygieneScore: m === 7 ? null : 85,
        bracketsLoose: 0,
        bracketsBroken: 0,
        appliancesIntact: m === 7 ? null : true,
        adjustments: m === 6 ? ["WIRE_CHANGE"] : m === 8 ? ["ELASTIC_CHANGE", "WIRE_CHANGE"] : ["ELASTIC_CHANGE"],
        paymentStatusSnapshot: "ON_TIME",
      },
    });
  }

  await db.orthodonticConsent.createMany({
    data: [
      {
        treatmentPlanId: plan.id,
        patientId,
        clinicId,
        consentType: "TREATMENT",
        signedAt: new Date("2024-04-10"),
        signerName: "Andrea Reyes Domínguez",
        signerRelationship: "self",
      },
      {
        treatmentPlanId: plan.id,
        patientId,
        clinicId,
        consentType: "FINANCIAL",
        signedAt: new Date("2024-04-10"),
        signerName: "Andrea Reyes Domínguez",
        signerRelationship: "self",
      },
      {
        treatmentPlanId: plan.id,
        patientId,
        clinicId,
        consentType: "PHOTO_USE",
        signedAt: new Date("2024-04-10"),
        signerName: "Andrea Reyes Domínguez",
        signerRelationship: "self",
        notes:
          "Autoriza casos de estudio interno + materiales educativos sin nombre. NO autoriza redes sociales identificable.",
      },
    ],
  });
}

async function seedSofia(clinicId: string, patientId: string, doctorId: string) {
  const dx = await db.orthodonticDiagnosis.create({
    data: {
      patientId,
      clinicId,
      diagnosedById: doctorId,
      diagnosedAt: new Date("2025-01-15"),
      angleClassRight: "CLASS_III",
      angleClassLeft: "CLASS_III",
      overbiteMm: 1.0,
      overbitePercentage: 8,
      overjetMm: -1.0,
      crossbite: true,
      crossbiteDetails: "Mordida cruzada anterior incisivos superiores 11 y 21.",
      crowdingUpperMm: 2.0,
      crowdingLowerMm: 0.5,
      etiologySkeletal: true,
      etiologyFunctional: true,
      habits: ["TONGUE_THRUSTING", "MOUTH_BREATHING"],
      habitsDescription:
        "Deglución atípica desde los 6 años. Respirador bucal observado en consulta inicial.",
      dentalPhase: "MIXED_LATE",
      clinicalSummary:
        "Paciente femenina de 12 años en dentición mixta tardía con maloclusión clase III esquelética leve " +
        "y mordida cruzada anterior. Plan en dos fases: ortopedia (expansor maxilar) por 9 meses, seguido de " +
        "brackets metálicos por 15 meses al alcanzar dentición permanente.",
    },
  });

  const plan = await db.orthodonticTreatmentPlan.create({
    data: {
      diagnosisId: dx.id,
      patientId,
      clinicId,
      technique: "METAL_BRACKETS",
      techniqueNotes:
        "Fase 1 ortopédica con expansor maxilar Hyrax (9 meses) → Fase 2 brackets metálicos (15 meses). Total 24 meses.",
      estimatedDurationMonths: 24,
      startDate: new Date("2025-02-01"),
      installedAt: null,
      totalCostMxn: 52000,
      anchorageType: "MODERATE",
      extractionsRequired: false,
      treatmentObjectives: "AESTHETIC_AND_FUNCTIONAL",
      retentionPlanText:
        "Retenedor removible Hawley superior + retenedor fijo lingual 3-3 inferior tras finalizar Fase 2.",
      status: "PLANNED",
    },
  });

  await db.orthodonticPhase.createMany({
    data: PHASES.map((phaseKey, idx) => ({
      treatmentPlanId: plan.id,
      clinicId,
      phaseKey,
      orderIndex: idx,
      status: "NOT_STARTED" as const,
    })),
  });

  // Plan pagos: 6000 + 24×1900 = 51,600 (~52000 dentro del 1% margen).
  // paidAmount = 6000 (solo enganche, ninguna installment pagada).
  await db.orthoPaymentPlan.create({
    data: {
      treatmentPlanId: plan.id,
      patientId,
      clinicId,
      totalAmount: 52000,
      initialDownPayment: 6000,
      installmentAmount: 1900,
      installmentCount: 24,
      startDate: new Date("2025-02-05"),
      endDate: new Date("2027-01-05"),
      paymentDayOfMonth: 5,
      paidAmount: 6000,
      pendingAmount: 46000,
      status: "ON_TIME",
      preferredPaymentMethod: "BANK_TRANSFER",
    },
  });

  await db.orthodonticConsent.createMany({
    data: [
      {
        treatmentPlanId: plan.id,
        patientId,
        clinicId,
        consentType: "TREATMENT",
        signedAt: new Date("2025-01-20"),
        signerName: "María Vargas López",
        signerRelationship: "tutor",
      },
      {
        treatmentPlanId: plan.id,
        patientId,
        clinicId,
        consentType: "MINOR_ASSENT",
        signedAt: new Date("2025-01-20"),
        signerName: "Sofía Hernández Vargas",
        signerRelationship: "self",
      },
      {
        treatmentPlanId: plan.id,
        patientId,
        clinicId,
        consentType: "FINANCIAL",
        signedAt: new Date("2025-01-20"),
        signerName: "María Vargas López",
        signerRelationship: "tutor",
      },
      {
        treatmentPlanId: plan.id,
        patientId,
        clinicId,
        consentType: "PHOTO_USE",
        signedAt: new Date("2025-01-20"),
        signerName: "María Vargas López",
        signerRelationship: "tutor",
        notes:
          "Autoriza ÚNICAMENTE casos de estudio interno. NO autoriza materiales educativos ni redes sociales.",
      },
    ],
  });
}

async function seedMauricio(clinicId: string, patientId: string, doctorId: string) {
  const dx = await db.orthodonticDiagnosis.create({
    data: {
      patientId,
      clinicId,
      diagnosedById: doctorId,
      diagnosedAt: new Date("2024-08-25"),
      angleClassRight: "CLASS_I",
      angleClassLeft: "CLASS_I",
      overbiteMm: 2.5,
      overbitePercentage: 20,
      overjetMm: 2.0,
      crowdingLowerMm: 2.0,
      etiologyDental: true,
      habits: [],
      dentalPhase: "PERMANENT",
      clinicalSummary:
        "Paciente masculino de 32 años con maloclusión clase I y apiñamiento leve inferior 2mm. " +
        "Caso ideal para alineadores transparentes. Plan: 22 sets de alineadores Smileco por 12 meses con " +
        "IPR planeado en sectores 23-24 y 33-34.",
    },
  });

  const plan = await db.orthodonticTreatmentPlan.create({
    data: {
      diagnosisId: dx.id,
      patientId,
      clinicId,
      technique: "CLEAR_ALIGNERS",
      techniqueNotes: "Smileco — set de 22 alineadores. Cambio cada 14 días.",
      estimatedDurationMonths: 12,
      startDate: new Date("2024-09-10"),
      installedAt: new Date("2024-09-10"),
      totalCostMxn: 38000,
      anchorageType: "MINIMUM",
      extractionsRequired: false,
      iprRequired: true,
      treatmentObjectives: "AESTHETIC_AND_FUNCTIONAL",
      patientGoals:
        "Mejorar la estética sin que se note el tratamiento. Trabajo en ventas, contacto frecuente con clientes.",
      retentionPlanText:
        "Retenedor termoplástico tipo Essix superior e inferior. 24h por 4 meses, luego nocturno permanente.",
      status: "IN_PROGRESS",
    },
  });

  await db.orthodonticPhase.createMany({
    data: PHASES.map((phaseKey, idx) => ({
      treatmentPlanId: plan.id,
      clinicId,
      phaseKey,
      orderIndex: idx,
      status: idx === 0 ? ("IN_PROGRESS" as const) : ("NOT_STARTED" as const),
      startedAt: idx === 0 ? new Date("2024-09-10") : null,
      expectedEndAt: idx === 0 ? new Date("2025-01-10") : null,
    })),
  });

  // 8000 + 12×2500 = 38000. 3 pagadas. paidAmount = 8000 + 3*2500 = 15500.
  const paidInstallments = 3;
  const installmentAmount = 2500;
  const initialDownPayment = 8000;
  const totalAmount = 38000;
  const paidAmount = initialDownPayment + paidInstallments * installmentAmount;
  const pendingAmount = totalAmount - paidAmount;
  const payPlan = await db.orthoPaymentPlan.create({
    data: {
      treatmentPlanId: plan.id,
      patientId,
      clinicId,
      totalAmount,
      initialDownPayment,
      installmentAmount,
      installmentCount: 12,
      startDate: new Date("2024-09-10"),
      endDate: new Date("2025-08-10"),
      paymentDayOfMonth: 10,
      paidAmount,
      pendingAmount,
      status: "ON_TIME",
      preferredPaymentMethod: "CREDIT_CARD",
    },
  });

  for (let i = 1; i <= 12; i++) {
    const dueDate = new Date("2024-10-10");
    dueDate.setMonth(dueDate.getMonth() + (i - 1));
    const paid = i <= paidInstallments;
    await db.orthoInstallment.create({
      data: {
        paymentPlanId: payPlan.id,
        clinicId,
        installmentNumber: i,
        amount: installmentAmount,
        dueDate,
        status: paid ? "PAID" : "PENDING",
        paidAt: paid ? dueDate : null,
        amountPaid: paid ? installmentAmount : null,
        paymentMethod: paid ? "CREDIT_CARD" : null,
        recordedById: paid ? doctorId : null,
      },
    });
  }

  await db.orthodonticControlAppointment.createMany({
    data: [
      {
        treatmentPlanId: plan.id,
        patientId,
        clinicId,
        scheduledAt: new Date("2024-10-08"),
        performedAt: new Date("2024-10-08"),
        monthInTreatment: 1,
        attendance: "ATTENDED",
        attendedById: doctorId,
        hygieneScore: 95,
        adjustments: ["NEW_ALIGNERS_DELIVERED"],
        paymentStatusSnapshot: "ON_TIME",
        adjustmentNotes: "Set 1 entregado. Compliance excelente.",
      },
      {
        treatmentPlanId: plan.id,
        patientId,
        clinicId,
        scheduledAt: new Date("2024-11-08"),
        performedAt: new Date("2024-11-08"),
        monthInTreatment: 2,
        attendance: "ATTENDED",
        attendedById: doctorId,
        hygieneScore: 92,
        adjustments: ["NEW_ALIGNERS_DELIVERED", "ATTACHMENT_PLACEMENT"],
        paymentStatusSnapshot: "ON_TIME",
        adjustmentNotes: "Sets 2-3 + attachments en 23, 24, 33, 34.",
      },
      {
        treatmentPlanId: plan.id,
        patientId,
        clinicId,
        scheduledAt: new Date("2024-12-09"),
        performedAt: new Date("2024-12-09"),
        monthInTreatment: 3,
        attendance: "ATTENDED",
        attendedById: doctorId,
        hygieneScore: 90,
        adjustments: ["NEW_ALIGNERS_DELIVERED", "IPR"],
        paymentStatusSnapshot: "ON_TIME",
        adjustmentNotes: "Sets 4-6 + IPR 0.3mm en 23-24 y 33-34.",
      },
    ],
  });

  // Digital records: 2 STL stubs (los fileId reales se crean cuando se sube
  // un archivo real al storage). En seed creamos PatientFile placeholder
  // para que linkDigitalRecord acepte el FK.
  const placeholderFile1 = await db.patientFile.create({
    data: {
      clinicId,
      patientId,
      uploadedBy: doctorId,
      name: "scan-medit-T0.stl",
      url: `${clinicId}/orthodontics/${patientId}/seed-mauricio-T0.stl`,
      mimeType: "model/stl",
      category: "SCAN_STL",
      notes: "Scan inicial Medit i700 (seed mock)",
    },
  });
  const placeholderFile2 = await db.patientFile.create({
    data: {
      clinicId,
      patientId,
      uploadedBy: doctorId,
      name: "scan-medit-M3.stl",
      url: `${clinicId}/orthodontics/${patientId}/seed-mauricio-M3.stl`,
      mimeType: "model/stl",
      category: "SCAN_STL",
      notes: "Scan intermedio mes 3 (seed mock)",
    },
  });
  await db.orthodonticDigitalRecord.createMany({
    data: [
      {
        treatmentPlanId: plan.id,
        patientId,
        clinicId,
        recordType: "SCAN_STL",
        fileId: placeholderFile1.id,
        capturedAt: new Date("2024-09-05"),
        uploadedById: doctorId,
        notes: "Scan inicial Medit i700",
      },
      {
        treatmentPlanId: plan.id,
        patientId,
        clinicId,
        recordType: "SCAN_STL",
        fileId: placeholderFile2.id,
        capturedAt: new Date("2024-12-15"),
        uploadedById: doctorId,
        notes: "Scan intermedio mes 3 — control de progreso",
      },
    ],
  });

  await db.orthodonticConsent.createMany({
    data: [
      {
        treatmentPlanId: plan.id,
        patientId,
        clinicId,
        consentType: "TREATMENT",
        signedAt: new Date("2024-09-08"),
        signerName: "Mauricio López Aguirre",
        signerRelationship: "self",
      },
      {
        treatmentPlanId: plan.id,
        patientId,
        clinicId,
        consentType: "FINANCIAL",
        signedAt: new Date("2024-09-08"),
        signerName: "Mauricio López Aguirre",
        signerRelationship: "self",
      },
    ],
  });
}

main()
  .catch((e) => {
    console.error("[ortho-mock] error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
