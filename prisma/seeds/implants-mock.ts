// Implants — seed con 3 pacientes mock para QA y demos. Spec §12.
//
// Run: npx tsx prisma/seeds/implants-mock.ts
//
// Idempotente: usa upsert por patient.patientNumber + skipDuplicates
// en los implantes. Detecta la primera clínica DENTAL con módulo
// `implants` activo y el primer DOCTOR de esa clínica.

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const clinic = await db.clinic.findFirst({
    where: {
      category: "DENTAL",
      clinicModules: {
        some: { status: "active", module: { key: "implants" } },
      },
    },
    select: { id: true, name: true },
  });
  if (!clinic) {
    console.error(
      "[implant-mock] No se encontró clínica DENTAL con módulo 'implants' activo.",
    );
    process.exit(1);
  }

  const doctor = await db.user.findFirst({
    where: { clinicId: clinic.id, role: "DOCTOR", isActive: true },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!doctor) {
    console.error("[implant-mock] No hay DOCTOR activo en la clínica.");
    process.exit(1);
  }

  console.log(`[implant-mock] Clínica "${clinic.name}", doctor ${doctor.firstName} ${doctor.lastName}.`);

  // ═════════════════════════════════════════════════════════════════
  // 1. Roberto Méndez Aguilar (58, Straumann BLX en 36 — FUNCTIONAL)
  // ═════════════════════════════════════════════════════════════════
  const roberto = await upsertPatient(clinic.id, {
    patientNumber: "MOCK-IMP-001",
    firstName: "Roberto",
    lastName: "Méndez Aguilar",
    dob: new Date("1967-03-12"),
    gender: "M",
    phone: "+52 999 123 4567",
    email: "roberto.mendez+mock@mediflow.test",
  });

  const robertoImplant = await db.implant.upsert({
    where: { id: "mock_imp_roberto_36" },
    update: {},
    create: {
      id: "mock_imp_roberto_36",
      clinicId: clinic.id,
      patientId: roberto.id,
      toothFdi: 36,
      brand: "STRAUMANN",
      modelName: "BLX",
      diameterMm: 4.5,
      lengthMm: 10.0,
      connectionType: "CONICAL_MORSE",
      surfaceTreatment: "SLActive",
      lotNumber: "A12345678",
      manufactureDate: new Date("2023-03-01"),
      expiryDate: new Date("2028-03-01"),
      placedAt: new Date("2024-10-15T09:00:00Z"),
      placedByDoctorId: doctor.id,
      protocol: "ONE_STAGE",
      currentStatus: "FUNCTIONAL",
      statusUpdatedAt: new Date("2024-12-24"),
      createdByUserId: doctor.id,
    },
  });

  await db.implantSurgicalRecord.upsert({
    where: { implantId: robertoImplant.id },
    update: {},
    create: {
      implantId: robertoImplant.id,
      performedAt: new Date("2024-10-15T09:00:00Z"),
      asaClassification: "ASA_II",
      prophylaxisAntibiotic: true,
      prophylaxisDrug: "Amoxicilina 2g VO 1h pre-op",
      insertionTorqueNcm: 38,
      isqMesiodistal: 74,
      isqVestibulolingual: 72,
      boneDensity: "D2",
      ridgeWidthMm: 7.0,
      ridgeHeightMm: 11.0,
      flapType: "Crestal con liberación distal",
      drillingProtocol: "Estándar D2",
      healingAbutmentLot: "HA-22334-R",
      sutureMaterial: "Monofilamento nylon 4-0",
      durationMinutes: 65,
      createdByUserId: doctor.id,
    },
  });
  await db.implantHealingPhase.upsert({
    where: { implantId: robertoImplant.id },
    update: {},
    create: {
      implantId: robertoImplant.id,
      startedAt: new Date("2024-10-15"),
      expectedDurationWeeks: 8,
      isqAt4Weeks: 75,
      isqAt8Weeks: 78,
      isqLatest: 78,
      isqLatestAt: new Date("2024-12-10"),
      completedAt: new Date("2024-12-10"),
      createdByUserId: doctor.id,
    },
  });
  await db.implantProstheticPhase.upsert({
    where: { implantId: robertoImplant.id },
    update: {},
    create: {
      implantId: robertoImplant.id,
      abutmentType: "PREFABRICATED_TI",
      abutmentLot: "SP-87654",
      abutmentTorqueNcm: 35,
      prosthesisType: "SCREW_RETAINED_SINGLE",
      prosthesisMaterial: "ZIRCONIA_MONOLITHIC",
      prosthesisLabName: "Zarate Lab",
      prosthesisLabLot: "8X-2024-0815",
      prosthesisDeliveredAt: new Date("2024-12-24"),
      occlusionScheme: "función de grupo",
      createdByUserId: doctor.id,
    },
  });
  await db.implantPassport.upsert({
    where: { implantId: robertoImplant.id },
    update: {},
    create: {
      implantId: robertoImplant.id,
      generatedAt: new Date("2024-12-24"),
      qrPublicEnabled: false,
      createdByUserId: doctor.id,
    },
  });
  // Follow-ups
  for (const fu of [
    { milestone: "M_1_WEEK" as const,    performedAt: new Date("2024-10-22") },
    { milestone: "M_1_MONTH" as const,   performedAt: new Date("2024-11-15") },
    { milestone: "M_3_MONTHS" as const,  performedAt: new Date("2025-01-15"), boneLoss: 0.4, meets: true },
    { milestone: "M_6_MONTHS" as const,  performedAt: new Date("2025-06-15"), boneLoss: 0.5, meets: true },
    { milestone: "M_12_MONTHS" as const, scheduledAt: new Date("2025-12-15") },
    { milestone: "M_24_MONTHS" as const, scheduledAt: new Date("2026-12-15") },
  ]) {
    await db.implantFollowUp.create({
      data: {
        implantId: robertoImplant.id,
        clinicId: clinic.id,
        milestone: fu.milestone,
        scheduledAt: fu.scheduledAt ?? null,
        performedAt: fu.performedAt ?? null,
        radiographicBoneLossMm: fu.boneLoss ?? null,
        meetsAlbrektssonCriteria: fu.meets ?? null,
        createdByUserId: doctor.id,
      },
    });
  }

  // ═════════════════════════════════════════════════════════════════
  // 2. María Salazar Ortiz (62, All-on-4 superior con Neodent)
  // ═════════════════════════════════════════════════════════════════
  const maria = await upsertPatient(clinic.id, {
    patientNumber: "MOCK-IMP-002",
    firstName: "María",
    lastName: "Salazar Ortiz",
    dob: new Date("1962-08-03"),
    gender: "F",
    phone: "+52 999 234 5678",
    email: "maria.salazar+mock@mediflow.test",
  });

  const allOn4Specs = [
    { id: "mock_imp_maria_12", fdi: 12, dim: { d: 3.75, l: 13 }, lot: "N98765432", torque: 42 },
    { id: "mock_imp_maria_22", fdi: 22, dim: { d: 3.75, l: 13 }, lot: "N98765432", torque: 40 },
    { id: "mock_imp_maria_14", fdi: 14, dim: { d: 4.0, l: 15 }, lot: "N98765431", torque: 45 },
    { id: "mock_imp_maria_24", fdi: 24, dim: { d: 4.0, l: 15 }, lot: "N98765431", torque: 38 },
  ];
  for (const spec of allOn4Specs) {
    const imp = await db.implant.upsert({
      where: { id: spec.id },
      update: {},
      create: {
        id: spec.id,
        clinicId: clinic.id,
        patientId: maria.id,
        toothFdi: spec.fdi,
        brand: "NEODENT",
        modelName: "Drive CM",
        diameterMm: spec.dim.d,
        lengthMm: spec.dim.l,
        connectionType: "CONICAL_MORSE",
        surfaceTreatment: "SLA",
        lotNumber: spec.lot,
        placedAt: new Date("2024-11-25T08:00:00Z"),
        placedByDoctorId: doctor.id,
        protocol: "IMMEDIATE_PLACEMENT_IMMEDIATE_LOADING",
        currentStatus: "LOADED_DEFINITIVE",
        statusUpdatedAt: new Date("2025-03-25"),
        createdByUserId: doctor.id,
      },
    });
    await db.implantSurgicalRecord.upsert({
      where: { implantId: imp.id },
      update: {},
      create: {
        implantId: imp.id,
        performedAt: new Date("2024-11-25T08:00:00Z"),
        asaClassification: "ASA_II",
        prophylaxisAntibiotic: true,
        prophylaxisDrug: "Amoxicilina 2g VO 1h pre-op",
        hba1cIfDiabetic: 6.8,
        insertionTorqueNcm: spec.torque,
        isqMesiodistal: 72,
        isqVestibulolingual: 70,
        boneDensity: "D3",
        flapType: "Crestal extendido bilateral",
        drillingProtocol: "Subdimensionado D3",
        durationMinutes: 180,
        createdByUserId: doctor.id,
      },
    });
    await db.implantProstheticPhase.upsert({
      where: { implantId: imp.id },
      update: {},
      create: {
        implantId: imp.id,
        abutmentType: spec.fdi === 14 || spec.fdi === 24 ? "MULTI_UNIT_ANGLED_30" : "MULTI_UNIT_STRAIGHT",
        abutmentLot: "MUA-2024-0042",
        abutmentTorqueNcm: 15,
        prosthesisType: "ALL_ON_4",
        prosthesisMaterial: "HYBRID_TITANIUM_ACRYLIC",
        prosthesisLabName: "Premium Dental Lab",
        prosthesisLabLot: "AO4-2025-0325",
        immediateLoading: true,
        provisionalDeliveredAt: new Date("2024-11-26"),
        definitiveDeliveredAt: new Date("2025-03-25"),
        prosthesisDeliveredAt: new Date("2025-03-25"),
        occlusionScheme: "guía anterior y caninos",
        createdByUserId: doctor.id,
      },
    });
    await db.implantPassport.upsert({
      where: { implantId: imp.id },
      update: {},
      create: {
        implantId: imp.id,
        generatedAt: new Date("2025-03-25"),
        qrPublicEnabled: false,
        createdByUserId: doctor.id,
      },
    });
  }

  // ═════════════════════════════════════════════════════════════════
  // 3. Carlos Vega Ruiz (45, peri-implantitis a 3 años en 26)
  // ═════════════════════════════════════════════════════════════════
  const carlos = await upsertPatient(clinic.id, {
    patientNumber: "MOCK-IMP-003",
    firstName: "Carlos",
    lastName: "Vega Ruiz",
    dob: new Date("1980-11-22"),
    gender: "M",
    phone: "+52 999 345 6789",
    email: "carlos.vega+mock@mediflow.test",
  });

  const carlosImplant = await db.implant.upsert({
    where: { id: "mock_imp_carlos_26" },
    update: {},
    create: {
      id: "mock_imp_carlos_26",
      clinicId: clinic.id,
      patientId: carlos.id,
      toothFdi: 26,
      brand: "BIOHORIZONS",
      modelName: "Tapered Internal",
      diameterMm: 4.0,
      lengthMm: 11.5,
      connectionType: "INTERNAL_HEX",
      surfaceTreatment: "LASER_LOK",
      lotNumber: "BH-77665544",
      placedAt: new Date("2022-05-10T10:00:00Z"),
      placedByDoctorId: doctor.id,
      protocol: "TWO_STAGE",
      currentStatus: "COMPLICATION",
      statusUpdatedAt: new Date("2025-04-15"),
      createdByUserId: doctor.id,
    },
  });
  await db.implantSurgicalRecord.upsert({
    where: { implantId: carlosImplant.id },
    update: {},
    create: {
      implantId: carlosImplant.id,
      performedAt: new Date("2022-05-10"),
      asaClassification: "ASA_II",
      prophylaxisAntibiotic: true,
      insertionTorqueNcm: 32,
      isqMesiodistal: 68,
      isqVestibulolingual: 66,
      boneDensity: "D3",
      flapType: "Mucoperióstico extendido",
      drillingProtocol: "Subdimensionado D3 + elevación seno",
      sutureMaterial: "Vicryl 4-0",
      durationMinutes: 120,
      createdByUserId: doctor.id,
    },
  });
  await db.implantProstheticPhase.upsert({
    where: { implantId: carlosImplant.id },
    update: {},
    create: {
      implantId: carlosImplant.id,
      abutmentType: "CUSTOM_TI",
      abutmentLot: "BH-AB-99887",
      abutmentTorqueNcm: 30,
      prosthesisType: "SCREW_RETAINED_SINGLE",
      prosthesisMaterial: "PORCELAIN_FUSED_TO_ZIRCONIA",
      prosthesisLabName: "Vega Dental Lab",
      prosthesisLabLot: "VD-2023-0205",
      prosthesisDeliveredAt: new Date("2023-02-05"),
      occlusionScheme: "función canina",
      createdByUserId: doctor.id,
    },
  });
  await db.implantComplication.create({
    data: {
      implantId: carlosImplant.id,
      clinicId: clinic.id,
      patientId: carlos.id,
      detectedAt: new Date("2025-04-15"),
      type: "PERI_IMPLANTITIS_MODERATE",
      severity: "moderada",
      description:
        "PD 7mm DV (vs 3mm previo), BoP+ en 4 sitios, supuración leve, " +
        "pérdida ósea 3mm. Higiene irregular y reanudación de tabaquismo " +
        "hace 1 año.",
      bopAtDiagnosis: true,
      pdMaxAtDiagnosisMm: 7,
      suppurationAtDiagnosis: true,
      radiographicBoneLossMm: 3.0,
      treatmentPlan:
        "Fase 1 no quirúrgica: descontaminación cepillos titanio + " +
        "clorhexidina + láser Er:YAG. Antibiótico amoxicilina 875+125 " +
        "cada 12h por 7 días. Reevaluación 6 sem.",
      createdByUserId: doctor.id,
    },
  });
  // Follow-ups con pérdida ósea progresiva
  for (const fu of [
    { milestone: "M_6_MONTHS" as const,  performedAt: new Date("2022-11-10"), boneLoss: 0.3, meets: true },
    { milestone: "M_12_MONTHS" as const, performedAt: new Date("2023-05-10"), boneLoss: 0.6, meets: true },
    { milestone: "M_24_MONTHS" as const, performedAt: new Date("2024-05-10"), boneLoss: 1.2, meets: true },
    { milestone: "UNSCHEDULED" as const, performedAt: new Date("2025-04-15"), boneLoss: 3.0, meets: false },
  ]) {
    await db.implantFollowUp.create({
      data: {
        implantId: carlosImplant.id,
        clinicId: clinic.id,
        milestone: fu.milestone,
        performedAt: fu.performedAt,
        radiographicBoneLossMm: fu.boneLoss,
        meetsAlbrektssonCriteria: fu.meets,
        createdByUserId: doctor.id,
      },
    });
  }

  console.log(`[implant-mock] OK — 3 pacientes sembrados:`);
  console.log(`  • Roberto Méndez (Straumann BLX en 36, FUNCTIONAL)`);
  console.log(`  • María Salazar (4 Neodent All-on-4 superior, LOADED_DEFINITIVE)`);
  console.log(`  • Carlos Vega (BioHorizons en 26, COMPLICATION peri-implantitis moderada)`);
  console.log("");
  console.log("Query demo de recall por lote:");
  console.log(`  SELECT * FROM "implants" WHERE brand = 'STRAUMANN' AND "lotNumber" = 'A12345678';`);
}

async function upsertPatient(clinicId: string, p: {
  patientNumber: string;
  firstName: string;
  lastName: string;
  dob: Date;
  gender: "M" | "F" | "OTHER";
  phone: string;
  email: string;
}) {
  return db.patient.upsert({
    where: { clinicId_patientNumber: { clinicId, patientNumber: p.patientNumber } },
    update: { firstName: p.firstName, lastName: p.lastName },
    create: {
      clinicId,
      patientNumber: p.patientNumber,
      firstName: p.firstName,
      lastName: p.lastName,
      dob: p.dob,
      gender: p.gender,
      phone: p.phone,
      email: p.email,
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
