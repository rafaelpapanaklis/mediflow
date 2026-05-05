// Periodontics — seed con 3 pacientes mock para QA y demos. SPEC §14.
//
// Run: npx tsx prisma/seeds/periodontics-mock.ts
//
// Idempotente: usa upsert por patient.patientNumber. Detecta la primera
// clínica DENTAL con módulo `periodontics` activo y el primer DOCTOR de
// esa clínica.
//
// Casos:
//   1. María González    — Estadio II generalizada · Plan Fase 2 · sin cirugía.
//   2. Juan Pérez        — Estadio III Grado C · cirugía RTG · reevaluación post.
//   3. Carmen López      — Estadio I (controlado) · mantenimiento Fase 4.

import { PrismaClient, Prisma } from "@prisma/client";
import { computePerioMetrics } from "../../src/lib/periodontics/periodontogram-math";
import {
  FDI_ALL,
  SITE_CAPTURE_ORDER,
} from "../../src/lib/periodontics/site-helpers";
import type { Site, ToothLevel } from "../../src/lib/periodontics/schemas";

const db = new PrismaClient();

async function main() {
  const clinic = await db.clinic.findFirst({
    where: {
      category: "DENTAL",
      clinicModules: {
        some: { status: "active", module: { key: "periodontics" } },
      },
    },
    select: { id: true, name: true },
  });
  if (!clinic) {
    console.error(
      "[perio-mock] No se encontró ninguna clínica DENTAL con módulo 'periodontics' activo.",
    );
    process.exit(1);
  }

  const doctor = await db.user.findFirst({
    where: { clinicId: clinic.id, role: "DOCTOR", isActive: true },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!doctor) {
    console.error("[perio-mock] No hay DOCTOR activo en la clínica.");
    process.exit(1);
  }

  console.log(
    `[perio-mock] Sembrando en clínica "${clinic.name}" con doctor ${doctor.firstName} ${doctor.lastName}.`,
  );

  // ─── Mock 1: María González — Estadio II generalizada ──────────────
  const maria = await upsertPatient(clinic.id, {
    patientNumber: "MOCK-PERIO-001",
    firstName: "María",
    lastName: "González Rivera",
    dob: new Date("1978-03-22"),
    phone: "+52 55 5555 0001",
    email: "maria.gonzalez+perio@mediflow.test",
  });
  await seedRecordsForPatient({
    clinicId: clinic.id,
    doctorId: doctor.id,
    patientId: maria.id,
    profile: "stage2_generalizada",
  });
  await db.periodontalTreatmentPlan.create({
    data: {
      clinicId: clinic.id,
      patientId: maria.id,
      currentPhase: "PHASE_2",
      phase1StartedAt: new Date("2026-03-10"),
      phase1CompletedAt: new Date("2026-04-02"),
      phase2StartedAt: new Date("2026-04-15"),
      planNotes: "Paciente colaboradora; mejora de técnica de cepillado evidente en visita de Fase 1.",
    },
  });
  await db.periodontalRiskAssessment.create({
    data: {
      clinicId: clinic.id,
      patientId: maria.id,
      bopPct: 28,
      residualSites5Plus: 6,
      lostTeethPerio: 1,
      smokingStatus: "NO",
      hba1c: 5.6,
      riskCategory: "MODERADO",
      recommendedRecallMonths: 4,
      evaluatedById: doctor.id,
    },
  });

  // ─── Mock 2: Juan Pérez — Estadio III Grado C ──────────────────────
  const juan = await upsertPatient(clinic.id, {
    patientNumber: "MOCK-PERIO-002",
    firstName: "Juan",
    lastName: "Pérez Castillo",
    dob: new Date("1965-11-08"),
    phone: "+52 55 5555 0002",
    email: "juan.perez+perio@mediflow.test",
  });
  await seedRecordsForPatient({
    clinicId: clinic.id,
    doctorId: doctor.id,
    patientId: juan.id,
    profile: "stage3_gradoC",
  });
  const juanPlan = await db.periodontalTreatmentPlan.create({
    data: {
      clinicId: clinic.id,
      patientId: juan.id,
      currentPhase: "PHASE_3",
      phase1StartedAt: new Date("2025-11-05"),
      phase1CompletedAt: new Date("2025-11-25"),
      phase2StartedAt: new Date("2025-12-08"),
      phase2CompletedAt: new Date("2026-01-20"),
      phase3StartedAt: new Date("2026-02-10"),
      planNotes: "Tabaquismo activo (12 cig/día). Se enfatiza programa de cesación.",
    },
  });
  await db.periodontalSurgery.create({
    data: {
      clinicId: clinic.id,
      patientId: juan.id,
      planId: juanPlan.id,
      surgeryType: "RTG",
      treatedSites: [
        { fdi: 36, sites: ["DV", "MV"] },
        { fdi: 46, sites: ["DV"] },
      ],
      biomaterials: {
        membrane: "Bio-Gide",
        boneGraft: "Bio-Oss 0.25-1mm",
        growthFactor: "Emdogain 0.7 mL",
      },
      sutureType: "Vicryl 5-0",
      surgeryDate: new Date("2026-03-04"),
      doctorId: doctor.id,
      sutureRemovalDate: new Date("2026-03-18"),
    },
  });
  await db.periodontalRiskAssessment.create({
    data: {
      clinicId: clinic.id,
      patientId: juan.id,
      bopPct: 42,
      residualSites5Plus: 14,
      lostTeethPerio: 6,
      smokingStatus: "MAYOR_O_IGUAL_10",
      hba1c: 7.8,
      riskCategory: "ALTO",
      recommendedRecallMonths: 3,
      evaluatedById: doctor.id,
    },
  });

  // ─── Mock 3: Carmen López — Estadio I controlado, mantenimiento ────
  const carmen = await upsertPatient(clinic.id, {
    patientNumber: "MOCK-PERIO-003",
    firstName: "Carmen",
    lastName: "López Domínguez",
    dob: new Date("1953-07-19"),
    phone: "+52 55 5555 0003",
    email: "carmen.lopez+perio@mediflow.test",
  });
  await seedRecordsForPatient({
    clinicId: clinic.id,
    doctorId: doctor.id,
    patientId: carmen.id,
    profile: "stage1_mantenimiento",
  });
  await db.periodontalTreatmentPlan.create({
    data: {
      clinicId: clinic.id,
      patientId: carmen.id,
      currentPhase: "PHASE_4",
      phase1StartedAt: new Date("2024-06-10"),
      phase1CompletedAt: new Date("2024-07-01"),
      phase2StartedAt: new Date("2024-07-15"),
      phase2CompletedAt: new Date("2024-09-10"),
      phase3StartedAt: new Date("2024-10-05"),
      phase3CompletedAt: new Date("2024-10-05"),
      phase4StartedAt: new Date("2024-11-01"),
      nextEvaluationAt: new Date("2026-04-15"), // ya pasada → marca como vencida en widget
      planNotes: "Paciente cumplidora. Recall semestral.",
    },
  });
  await db.periodontalRiskAssessment.create({
    data: {
      clinicId: clinic.id,
      patientId: carmen.id,
      bopPct: 8,
      residualSites5Plus: 2,
      lostTeethPerio: 2,
      smokingStatus: "NO",
      hba1c: 5.2,
      riskCategory: "BAJO",
      recommendedRecallMonths: 6,
      evaluatedById: doctor.id,
    },
  });

  console.log("[perio-mock] OK: 3 pacientes sembrados (María, Juan, Carmen).");
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
    // Limpia datos perio previos para mantener idempotencia.
    await db.periodontalRiskAssessment.deleteMany({ where: { patientId: existing.id } });
    await db.periodontalSurgery.deleteMany({ where: { patientId: existing.id } });
    await db.sRPSession.deleteMany({ where: { patientId: existing.id } });
    await db.periodontalReevaluation.deleteMany({ where: { patientId: existing.id } });
    await db.periodontalTreatmentPlan.deleteMany({ where: { patientId: existing.id } });
    await db.periodontalClassification.deleteMany({ where: { patientId: existing.id } });
    await db.gingivalRecession.deleteMany({ where: { patientId: existing.id } });
    await db.periImplantAssessment.deleteMany({ where: { patientId: existing.id } });
    await db.periodontalRecord.deleteMany({ where: { patientId: existing.id } });
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

type Profile = "stage2_generalizada" | "stage3_gradoC" | "stage1_mantenimiento";

async function seedRecordsForPatient(args: {
  clinicId: string;
  doctorId: string;
  patientId: string;
  profile: Profile;
}) {
  const { sites, teeth, classification, recordType, createdAt } = buildPerioFixture(args.profile);

  const metrics = computePerioMetrics(sites, teeth);
  const record = await db.periodontalRecord.create({
    data: {
      patientId: args.patientId,
      clinicId: args.clinicId,
      doctorId: args.doctorId,
      recordType,
      sites,
      toothLevel: teeth,
      bopPercentage: metrics.bopPct,
      plaqueIndexOleary: metrics.plaquePct,
      sites1to3mm: metrics.sites1to3,
      sites4to5mm: metrics.sites4to5,
      sites6PlusMm: metrics.sites6plus,
      teethWithPockets5Plus: metrics.teethWithPockets5plus,
      createdAt,
    },
  });

  await db.periodontalClassification.create({
    data: {
      patientId: args.patientId,
      clinicId: args.clinicId,
      periodontalRecordId: record.id,
      stage: classification.stage,
      grade: classification.grade,
      extension: classification.extension,
      modifiers: classification.modifiers as Prisma.InputJsonValue,
      computationInputs: classification.inputs as Prisma.InputJsonValue,
      calculatedAutomatically: true,
      classifiedById: args.doctorId,
      classifiedAt: createdAt,
    },
  });
}

function buildPerioFixture(profile: Profile): {
  sites: Site[];
  teeth: ToothLevel[];
  recordType: "INICIAL" | "POST_FASE_1" | "POST_FASE_2" | "MANTENIMIENTO";
  createdAt: Date;
  classification: {
    stage: "STAGE_I" | "STAGE_II" | "STAGE_III";
    grade: "GRADE_A" | "GRADE_B" | "GRADE_C" | null;
    extension: "LOCALIZADA" | "GENERALIZADA" | "PATRON_MOLAR_INCISIVO" | null;
    modifiers: Record<string, unknown>;
    inputs: Record<string, unknown>;
  };
} {
  switch (profile) {
    case "stage2_generalizada":
      return {
        sites: buildSites({
          basePd: 3,
          baseRec: -1,
          baseBop: 0.35,
          // ~30% sitios con PD 4 y BoP+
          severityFn: (fdi) => (fdi % 7 === 0 ? { pdMm: 4, recMm: 1, bop: true } : {}),
        }),
        teeth: buildTeeth({}),
        recordType: "INICIAL",
        createdAt: new Date("2026-03-10"),
        classification: {
          stage: "STAGE_II",
          grade: "GRADE_B",
          extension: "GENERALIZADA",
          modifiers: {},
          inputs: { maxCalInterproximalMm: 4, maxPdMm: 5, lostTeethPerio: 1 },
        },
      };

    case "stage3_gradoC":
      return {
        sites: buildSites({
          basePd: 4,
          baseRec: 1,
          baseBop: 0.55,
          severityFn: (fdi, pos) => {
            // Molares: bolsas profundas
            if ([16, 17, 26, 27, 36, 37, 46, 47].includes(fdi) && pos !== "MB" && pos !== "ML") {
              return { pdMm: 7, recMm: 3, bop: true, suppuration: fdi === 36 };
            }
            // Anteriores con CAL alto
            if ([11, 21, 31, 41].includes(fdi) && pos === "DV") {
              return { pdMm: 5, recMm: 2, bop: true };
            }
            return {};
          },
        }),
        teeth: buildTeeth({
          18: { absent: true },
          17: { mobility: 2, furcation: 2 },
          26: { absent: true },
          27: { mobility: 2 },
          36: { mobility: 2, furcation: 3 },
          37: { absent: true },
          46: { mobility: 1, furcation: 2 },
          47: { absent: true },
          28: { absent: true },
          38: { absent: true },
        }),
        recordType: "INICIAL",
        createdAt: new Date("2025-11-05"),
        classification: {
          stage: "STAGE_III",
          grade: "GRADE_C",
          extension: "GENERALIZADA",
          modifiers: { smokingCigsPerDay: 12, hba1c: 7.8 },
          inputs: { maxCalInterproximalMm: 10, maxPdMm: 7, lostTeethPerio: 6 },
        },
      };

    case "stage1_mantenimiento":
      return {
        sites: buildSites({
          basePd: 2,
          baseRec: -2,
          baseBop: 0.05,
          severityFn: () => ({}),
        }),
        teeth: buildTeeth({
          17: { absent: true },
          26: { absent: true },
        }),
        recordType: "MANTENIMIENTO",
        createdAt: new Date("2026-04-01"),
        classification: {
          stage: "STAGE_I",
          grade: "GRADE_A",
          extension: "LOCALIZADA",
          modifiers: {},
          inputs: { maxCalInterproximalMm: 2, maxPdMm: 3, lostTeethPerio: 2 },
        },
      };
  }
}

function buildSites(opts: {
  basePd: number;
  baseRec: number;
  baseBop: number;
  severityFn: (fdi: number, pos: typeof SITE_CAPTURE_ORDER[number]) => Partial<Site>;
}): Site[] {
  const out: Site[] = [];
  for (const fdi of FDI_ALL) {
    for (const position of SITE_CAPTURE_ORDER) {
      const baseBop = Math.random() < opts.baseBop;
      const override = opts.severityFn(fdi, position);
      out.push({
        fdi,
        position,
        pdMm: override.pdMm ?? opts.basePd,
        recMm: override.recMm ?? opts.baseRec,
        bop: override.bop ?? baseBop,
        plaque: false,
        suppuration: override.suppuration ?? false,
      });
    }
  }
  return out;
}

function buildTeeth(opts: Partial<Record<number, Partial<ToothLevel>>>): ToothLevel[] {
  return FDI_ALL.map((fdi) => ({
    fdi,
    mobility: 0,
    furcation: 0,
    absent: false,
    isImplant: false,
    ...(opts[fdi] ?? {}),
  }));
}

main()
  .catch((e) => {
    console.error("[perio-mock] error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
