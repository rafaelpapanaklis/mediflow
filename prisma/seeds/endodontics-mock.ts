// Endodontics — seed con 3 pacientes mock para QA y demos. Spec §14.
//
// Run: npx tsx prisma/seeds/endodontics-mock.ts
//
// Idempotente: usa upsert por patient.patientNumber. Detecta la primera
// clínica DENTAL con módulo `endodontics` activo y el primer DOCTOR de
// esa clínica.

import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const clinic = await db.clinic.findFirst({
    where: {
      category: "DENTAL",
      clinicModules: {
        some: {
          status: "active",
          module: { key: "endodontics" },
        },
      },
    },
    select: { id: true, name: true },
  });

  if (!clinic) {
    console.error(
      "[endo-mock] No se encontró ninguna clínica DENTAL con módulo 'endodontics' activo. " +
        "Asegúrate de tener la migración aplicada y un ClinicModule en status='active'.",
    );
    process.exit(1);
  }

  const doctor = await db.user.findFirst({
    where: { clinicId: clinic.id, role: "DOCTOR", isActive: true },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!doctor) {
    console.error("[endo-mock] No hay DOCTOR activo en la clínica.");
    process.exit(1);
  }

  console.log(`[endo-mock] Sembrando en clínica "${clinic.name}" con doctor ${doctor.firstName} ${doctor.lastName}.`);

  // ─── Mock 1: Roberto Salinas — TC primario completado ───
  const roberto = await upsertPatient(clinic.id, {
    patientNumber: "MOCK-ENDO-001",
    firstName: "Roberto",
    lastName: "Salinas Jiménez",
    dob: new Date("1984-07-12"),
    phone: "+52 55 1234 0001",
    email: "roberto.salinas+mock@mediflow.test",
  });

  const robertoDiag = await db.endodonticDiagnosis.create({
    data: {
      clinicId: clinic.id, patientId: roberto.id, doctorId: doctor.id,
      toothFdi: 36,
      diagnosedAt: new Date("2026-04-15"),
      pulpalDiagnosis: "PULPITIS_IRREVERSIBLE_SINTOMATICA",
      periapicalDiagnosis: "PERIODONTITIS_APICAL_SINTOMATICA",
      justification: "Dolor pulsátil EVA 8/10, frío exagerado y persistente.",
      createdByUserId: doctor.id,
    },
  });

  const robertoVitalities = [
    { type: "FRIO", controls: [35, 37], result: "EXAGERADO", intensity: 9 },
    { type: "PERCUSION_VERTICAL", controls: [35, 37], result: "POSITIVO", intensity: null },
    { type: "PALPACION_APICAL", controls: [35, 37], result: "POSITIVO", intensity: 4 },
    { type: "EPT", controls: [35, 37], result: "POSITIVO", intensity: 2 },
  ] as const;
  for (const v of robertoVitalities) {
    await db.vitalityTest.create({
      data: {
        clinicId: clinic.id, patientId: roberto.id, doctorId: doctor.id,
        toothFdi: 36,
        controlTeeth: v.controls,
        testType: v.type,
        result: v.result,
        intensity: v.intensity,
        evaluatedAt: new Date("2026-04-15"),
        createdByUserId: doctor.id,
      },
    });
  }

  const robertoTx = await db.endodonticTreatment.create({
    data: {
      clinicId: clinic.id, patientId: roberto.id, doctorId: doctor.id,
      toothFdi: 36,
      treatmentType: "TC_PRIMARIO",
      diagnosisId: robertoDiag.id,
      startedAt: new Date("2026-04-15"),
      completedAt: new Date("2026-04-23"),
      sessionsCount: 2,
      currentStep: 4,
      isMultiSession: true,
      rubberDamPlaced: true,
      accessType: "CONVENCIONAL",
      instrumentationSystem: "PROTAPER_GOLD",
      technique: "ROTACION_CONTINUA",
      irrigants: [
        { substance: "NaOCl", concentration: "5.25%", volumeMl: 10, order: 1 },
        { substance: "EDTA",  concentration: "17%",   volumeMl: 3,  order: 2 },
        { substance: "NaOCl", concentration: "5.25%", volumeMl: 5,  order: 3 },
      ] as Prisma.InputJsonValue,
      irrigationActivation: "ULTRASONICA",
      totalIrrigationMinutes: 6,
      obturationTechnique: "BIOCERAMIC_SINGLE_CONE",
      sealer: "BC_SEALER",
      postOpRestorationPlan: "CORONA_ZIRCONIA",
      requiresPost: false,
      restorationUrgencyDays: 30,
      outcomeStatus: "COMPLETADO",
      createdByUserId: doctor.id,
    },
  });

  const robertoCanals = [
    { canonicalName: "MV",  workingLengthMm: 19.5, masterIso: 25, taper: 0.06, quality: "HOMOGENEA" },
    { canonicalName: "ML",  workingLengthMm: 19.0, masterIso: 25, taper: 0.06, quality: "HOMOGENEA" },
    { canonicalName: "MB2", workingLengthMm: 18.0, masterIso: 25, taper: 0.06, quality: "HOMOGENEA" },
    { canonicalName: "D",   workingLengthMm: 20.0, masterIso: 30, taper: 0.06, quality: "HOMOGENEA" },
  ] as const;
  for (const c of robertoCanals) {
    await db.rootCanal.create({
      data: {
        treatmentId: robertoTx.id,
        canonicalName: c.canonicalName,
        workingLengthMm: new Prisma.Decimal(c.workingLengthMm),
        coronalReferencePoint: c.canonicalName === "D" ? "cúspide DV" : "cúspide MV",
        masterApicalFileIso: c.masterIso,
        masterApicalFileTaper: new Prisma.Decimal(c.taper),
        obturationQuality: c.quality,
        createdByUserId: doctor.id,
      },
    });
  }

  await db.intracanalMedication.create({
    data: {
      treatmentId: robertoTx.id,
      substance: "HIDROXIDO_CALCIO",
      placedAt: new Date("2026-04-15"),
      expectedRemovalAt: new Date("2026-04-23"),
      actualRemovalAt: new Date("2026-04-23"),
      createdByUserId: doctor.id,
    },
  });

  for (const m of [
    { milestone: "CONTROL_6M",  date: "2026-10-23" },
    { milestone: "CONTROL_12M", date: "2027-04-23" },
    { milestone: "CONTROL_24M", date: "2028-04-23" },
  ] as const) {
    await db.endodonticFollowUp.create({
      data: {
        treatmentId: robertoTx.id,
        milestone: m.milestone,
        scheduledAt: new Date(m.date),
        createdByUserId: doctor.id,
      },
    });
  }

  // ─── Mock 2: Mariana Torres — Retratamiento ───
  const mariana = await upsertPatient(clinic.id, {
    patientNumber: "MOCK-ENDO-002",
    firstName: "Mariana",
    lastName: "Torres Cuevas",
    dob: new Date("1998-02-08"),
    phone: "+52 55 1234 0002",
    email: "mariana.torres+mock@mediflow.test",
  });

  const marianaDiag = await db.endodonticDiagnosis.create({
    data: {
      clinicId: clinic.id, patientId: mariana.id, doctorId: doctor.id,
      toothFdi: 21,
      pulpalDiagnosis: "PREVIAMENTE_TRATADO",
      periapicalDiagnosis: "PERIODONTITIS_APICAL_ASINTOMATICA",
      justification: "Lesión periapical 6 mm circunscrita, fístula vestibular intermitente.",
      createdByUserId: doctor.id,
    },
  });

  const marianaTx = await db.endodonticTreatment.create({
    data: {
      clinicId: clinic.id, patientId: mariana.id, doctorId: doctor.id,
      toothFdi: 21,
      treatmentType: "RETRATAMIENTO",
      diagnosisId: marianaDiag.id,
      isMultiSession: true,
      sessionsCount: 2,
      currentStep: 2,
      rubberDamPlaced: true,
      accessType: "RECTIFICACION_PREVIO",
      instrumentationSystem: "WAVEONE_GOLD",
      technique: "RECIPROCACION",
      outcomeStatus: "EN_CURSO",
      postOpRestorationPlan: "CORONA_DISILICATO_LITIO",
      restorationUrgencyDays: 30,
      createdByUserId: doctor.id,
    },
  });

  await db.rootCanal.create({
    data: {
      treatmentId: marianaTx.id,
      canonicalName: "CONDUCTO_UNICO",
      workingLengthMm: new Prisma.Decimal(22.5),
      coronalReferencePoint: "borde incisal",
      masterApicalFileIso: 40,
      masterApicalFileTaper: new Prisma.Decimal(0.06),
      createdByUserId: doctor.id,
    },
  });

  await db.endodonticRetreatmentInfo.create({
    data: {
      treatmentId: marianaTx.id,
      failureReason: "SUBOBTURACION",
      originalTreatmentDate: new Date("2022-03-15"),
      fracturedInstrumentRecovered: false,
      difficulty: "MEDIA",
      createdByUserId: doctor.id,
    },
  });

  // ─── Mock 3: Carlos Mendoza — Control 12m post-TC ───
  const carlos = await upsertPatient(clinic.id, {
    patientNumber: "MOCK-ENDO-003",
    firstName: "Carlos",
    lastName: "Mendoza Ríos",
    dob: new Date("1971-09-30"),
    phone: "+52 55 1234 0003",
    email: "carlos.mendoza+mock@mediflow.test",
  });

  const carlosDiag = await db.endodonticDiagnosis.create({
    data: {
      clinicId: clinic.id, patientId: carlos.id, doctorId: doctor.id,
      toothFdi: 47,
      pulpalDiagnosis: "NECROSIS_PULPAR",
      periapicalDiagnosis: "PERIODONTITIS_APICAL_ASINTOMATICA",
      diagnosedAt: new Date("2025-04-30"),
      createdByUserId: doctor.id,
    },
  });

  const carlosTx = await db.endodonticTreatment.create({
    data: {
      clinicId: clinic.id, patientId: carlos.id, doctorId: doctor.id,
      toothFdi: 47,
      treatmentType: "TC_PRIMARIO",
      diagnosisId: carlosDiag.id,
      startedAt: new Date("2025-04-30"),
      completedAt: new Date("2025-05-10"),
      sessionsCount: 1,
      currentStep: 4,
      rubberDamPlaced: true,
      accessType: "CONVENCIONAL",
      instrumentationSystem: "PROTAPER_NEXT",
      technique: "ROTACION_CONTINUA",
      obturationTechnique: "CONDENSACION_VERTICAL_CALIENTE",
      sealer: "AH_PLUS",
      postOpRestorationPlan: "ONLAY",
      restorationUrgencyDays: 30,
      postOpRestorationCompletedAt: new Date("2025-06-02"),
      outcomeStatus: "COMPLETADO",
      createdByUserId: doctor.id,
    },
  });

  for (const c of [
    { canonicalName: "MV", wl: 20.0 },
    { canonicalName: "ML", wl: 20.5 },
    { canonicalName: "D",  wl: 21.0 },
  ] as const) {
    await db.rootCanal.create({
      data: {
        treatmentId: carlosTx.id,
        canonicalName: c.canonicalName,
        workingLengthMm: new Prisma.Decimal(c.wl),
        coronalReferencePoint: "cúspide MV",
        masterApicalFileIso: 30,
        masterApicalFileTaper: new Prisma.Decimal(0.06),
        obturationQuality: "HOMOGENEA",
        createdByUserId: doctor.id,
      },
    });
  }

  for (const f of [
    { milestone: "CONTROL_6M",  scheduled: "2025-11-10", performed: "2025-11-12",
      pai: 3, conclusion: "EN_CURACION", action: "Control 12m programado." },
    { milestone: "CONTROL_12M", scheduled: "2026-05-10", performed: "2026-05-04",
      pai: 2, conclusion: "EN_CURACION", action: "Control 24m para confirmar éxito." },
    { milestone: "CONTROL_24M", scheduled: "2027-05-10", performed: null, pai: null, conclusion: null, action: null },
  ] as const) {
    await db.endodonticFollowUp.create({
      data: {
        treatmentId: carlosTx.id,
        milestone: f.milestone,
        scheduledAt: new Date(f.scheduled),
        performedAt: f.performed ? new Date(f.performed) : null,
        paiScore: f.pai,
        symptomsPresent: f.performed ? false : null,
        conclusion: f.conclusion,
        recommendedAction: f.action,
        createdByUserId: doctor.id,
      },
    });
  }

  console.log("[endo-mock] OK: 3 pacientes sembrados (Roberto, Mariana, Carlos).");
}

interface PatientSeed {
  patientNumber: string;
  firstName: string;
  lastName: string;
  dob: Date;
  phone: string;
  email: string;
}

async function upsertPatient(clinicId: string, p: PatientSeed) {
  const existing = await db.patient.findFirst({
    where: { clinicId, patientNumber: p.patientNumber },
    select: { id: true },
  });
  if (existing) {
    // Borra los registros endo previos de este paciente para mantener
    // idempotencia del seed.
    await db.endodonticTreatment.deleteMany({ where: { patientId: existing.id } });
    await db.vitalityTest.deleteMany({ where: { patientId: existing.id } });
    await db.endodonticDiagnosis.deleteMany({ where: { patientId: existing.id } });
    return existing;
  }
  return db.patient.create({
    data: {
      clinicId,
      patientNumber: p.patientNumber,
      firstName: p.firstName,
      lastName: p.lastName,
      dob: p.dob,
      phone: p.phone,
      email: p.email,
      gender: "OTHER",
    },
    select: { id: true },
  });
}

main()
  .catch((e) => {
    console.error("[endo-mock] error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
