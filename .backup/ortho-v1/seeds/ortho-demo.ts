// Orthodontics — Demo seed dedicado al rediseño Fase 1.5 (paciente Gabriela
// Hernández Ruiz). Es el dataset oficial para presentar el patient-detail al
// equipo y stakeholders.
//
// Run: npx tsx prisma/seeds/ortho-demo.ts <clinicId?>
//
// Si no se pasa clinicId busca la primera clínica DENTAL con módulo
// "orthodontics" activo. Idempotente: borra todo lo previo de Gabriela y
// vuelve a sembrar.
//
// Datos verbatim del prompt master:
//   - Gabriela Hernández Ruiz, 14 años (DOB 2012-01-15), F
//   - +52 55 1234 5678 · gabriela.h@correo.mx
//   - Tutor: María Ruiz (madre) · Alergia: Penicilina (texto libre, no FK)
//   - En clínica desde 10:18, Sillón 2 (G16)
//   - Tx Nivelación · mes 4/22 · MBT 0.022 metálico
//   - Total $33,340 · pagado $12,500 · saldo $20,840
//   - 4 Treatment Cards históricas + 2 TADs Dentos + 2 LabOrders Cendres MX
//
// Nota: digital records (RX, foto-sets) requieren PatientFile real → no se
// siembran aquí; el rediseño los muestra como entradas vacías hasta que se
// suban via /dashboard/xrays.

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const PATIENT_NUMBER = "ORT-DEMO-GABY";
const FIRST_NAME = "Gabriela";
const LAST_NAME = "Hernández Ruiz";
const DOB = new Date("2012-01-15");

async function main() {
  const arg = process.argv[2];
  const clinic = arg
    ? await db.clinic.findUnique({ where: { id: arg }, select: { id: true, name: true } })
    : await db.clinic.findFirst({
        where: {
          category: "DENTAL",
          clinicModules: { some: { status: "active", module: { key: "orthodontics" } } },
        },
        select: { id: true, name: true },
      });
  if (!clinic) {
    console.error(
      "[ortho-demo] No se encontró clínica DENTAL con módulo orthodontics activo. " +
        "Pasa el clinicId como argumento o asegúrate de tener uno activo.",
    );
    process.exit(1);
  }
  const doctor = await db.user.findFirst({
    where: { clinicId: clinic.id, role: "DOCTOR", isActive: true },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!doctor) {
    console.error("[ortho-demo] No DOCTOR activo en la clínica.");
    process.exit(1);
  }
  console.log(
    `[ortho-demo] Sembrando Gabriela en clínica "${clinic.name}" (doctor ${doctor.firstName} ${doctor.lastName}).`,
  );

  const patientId = await upsertGabriela(clinic.id);
  await wipePreviousOrthoData(patientId);

  const dxId = await seedDiagnosis(clinic.id, patientId, doctor.id);
  const planId = await seedTreatmentPlan(clinic.id, patientId, doctor.id, dxId);

  const wireIds = await seedWireSequence(clinic.id, patientId, planId);
  await seedTads(clinic.id, patientId, planId);
  await seedTreatmentCards(clinic.id, patientId, planId, wireIds);
  await seedPaymentPlan(clinic.id, patientId, planId);
  await seedLabOrders(clinic.id, patientId, doctor.id);
  await seedPatientFlow(clinic.id, patientId);
  await seedWhatsAppLog(clinic.id, patientId, doctor.id);
  // Stats hero: 14 visitas atendidas + 1 NO_SHOW + 1 cita futura 13-may-2026.
  await seedOrthoControls(clinic.id, patientId, planId, doctor.id);
  // Sección E: T0 + T1 con 8 PatientFile placeholder cada uno.
  await seedPhotoSets(clinic.id, patientId, planId, doctor.id);
  // Compliance elásticos 78% (visible en Hero stats).
  await seedComplianceAuditLog(clinic.id, planId, doctor.id);
  // Sección F · ModalOpenChoice G5: 3 escenarios pre-cargados.
  await seedQuoteScenarios(clinic.id, planId, doctor.id);
  // Sección H · programa referidos: código personalizado GABY26.
  await seedReferralCode(clinic.id, patientId, planId);

  console.log(`[ortho-demo] OK · paciente ${patientId} sembrada.`);
}

async function upsertGabriela(clinicId: string): Promise<string> {
  const existing = await db.patient.findFirst({
    where: { clinicId, patientNumber: PATIENT_NUMBER },
    select: { id: true },
  });
  if (existing) {
    await db.patient.update({
      where: { id: existing.id },
      data: {
        firstName: FIRST_NAME,
        lastName: LAST_NAME,
        dob: DOB,
        gender: "F",
        phone: "+525512345678",
        email: "gabriela.h@correo.mx",
      },
    });
    return existing.id;
  }
  const created = await db.patient.create({
    data: {
      clinicId,
      patientNumber: PATIENT_NUMBER,
      firstName: FIRST_NAME,
      lastName: LAST_NAME,
      dob: DOB,
      gender: "F",
      phone: "+525512345678",
      email: "gabriela.h@correo.mx",
    },
    select: { id: true },
  });
  return created.id;
}

async function wipePreviousOrthoData(patientId: string): Promise<void> {
  // Orden importa por FKs.
  await db.orthoTreatmentCard.deleteMany({ where: { patientId } });
  await db.orthoTAD.deleteMany({ where: { patientId } });
  await db.orthoWireStep.deleteMany({ where: { treatmentPlan: { patientId } } });
  await db.orthoNpsSchedule.deleteMany({ where: { patientId } });
  await db.orthoReferralCode.deleteMany({ where: { patientId } });
  await db.orthoSignAtHomePackage.deleteMany({ where: { patientId } });
  await db.orthoQuoteScenario.deleteMany({
    where: { treatmentPlan: { patientId } },
  });
  await db.orthoRetentionRegimen.deleteMany({
    where: { treatmentPlan: { patientId } },
  });
  await db.orthodonticConsent.deleteMany({ where: { patientId } });
  await db.orthodonticDigitalRecord.deleteMany({ where: { patientId } });
  await db.orthodonticControlAppointment.deleteMany({ where: { patientId } });
  await db.orthoPhotoSet.deleteMany({ where: { patientId } });
  await db.orthoInstallment.deleteMany({
    where: { paymentPlan: { patientId } },
  });
  await db.orthoPaymentPlan.deleteMany({ where: { patientId } });
  await db.orthodonticPhase.deleteMany({
    where: { treatmentPlan: { patientId } },
  });
  await db.orthodonticTreatmentPlan.deleteMany({ where: { patientId } });
  await db.orthodonticDiagnosis.deleteMany({ where: { patientId } });
  await db.patientFlow.deleteMany({ where: { patientId } });
  await db.labOrder.deleteMany({ where: { patientId, module: "orthodontics" } });
  // InboxMessage rows tienen ON DELETE CASCADE desde InboxThread, basta con
  // borrar los threads del paciente (canal WHATSAPP).
  await db.inboxThread.deleteMany({
    where: { patientId, channel: "WHATSAPP" },
  });
  // PatientFile rows ORTHO_PHOTO_* — los re-creamos con cada seed.
  await db.patientFile.deleteMany({
    where: {
      patientId,
      category: { in: ["ORTHO_PHOTO_T0", "ORTHO_PHOTO_T1", "ORTHO_PHOTO_T2", "ORTHO_PHOTO_CONTROL"] },
    },
  });
  // Audit logs de compliance — re-emitidos cada seed para recalcular el %.
  await db.auditLog.deleteMany({
    where: {
      action: "ortho.elastics.compliance.recorded",
      entityType: "OrthodonticTreatmentPlan",
    },
  });
}

async function seedDiagnosis(
  clinicId: string,
  patientId: string,
  doctorId: string,
): Promise<string> {
  const dx = await db.orthodonticDiagnosis.create({
    data: {
      patientId,
      clinicId,
      diagnosedById: doctorId,
      diagnosedAt: new Date("2026-01-10"),
      angleClassRight: "CLASS_II_DIV_1",
      angleClassLeft: "CLASS_I",
      overbiteMm: 3.5,
      overbitePercentage: 30,
      overjetMm: 5.5,
      midlineDeviationMm: 1.5,
      crossbite: true,
      crossbiteDetails: "lateral derecha 15-45",
      openBite: false,
      crowdingUpperMm: 3.0,
      crowdingLowerMm: 2.0,
      habits: ["MOUTH_BREATHING", "TONGUE_THRUSTING"],
      habitsDescription:
        "Respirador bucal · deglución atípica con interposición lingual anterior.",
      tmjClickingPresent: true,
      tmjPainPresent: false,
      tmjNotes: "Click recíproco izquierdo a la apertura y al cierre.",
      dentalPhase: "PERMANENT",
      skeletalPattern: "MESOFACIAL",
      etiologyDental: true,
      clinicalSummary:
        "Paciente femenina de 14 años, dentición permanente. Maloclusión clase II div 1 derecha, " +
        "clase I izquierda, mordida cruzada lateral derecha 15-45, apiñamiento moderado superior. " +
        "Hábitos parafuncionales activos (respirador bucal + deglución atípica). " +
        "Click ATM recíproco izquierdo sin dolor. Plan: brackets MBT 0.022 con TADs auxiliares. " +
        "Tutor: María Ruiz (madre). Alergia documentada: Penicilina.",
    },
    select: { id: true },
  });
  return dx.id;
}

const PHASES = [
  "ALIGNMENT",
  "LEVELING",
  "SPACE_CLOSURE",
  "DETAILS",
  "FINISHING",
  "RETENTION",
] as const;

async function seedTreatmentPlan(
  clinicId: string,
  patientId: string,
  _doctorId: string,
  diagnosisId: string,
): Promise<string> {
  const plan = await db.orthodonticTreatmentPlan.create({
    data: {
      diagnosisId,
      patientId,
      clinicId,
      technique: "SELF_LIGATING_METAL",
      estimatedDurationMonths: 22,
      estimatedTotalDurationWeeks: 22 * 4,
      startDate: new Date("2026-01-14"),
      installedAt: new Date("2026-01-14"),
      totalCostMxn: 33340,
      anchorageType: "MODERATE",
      treatmentObjectives: "AESTHETIC_AND_FUNCTIONAL",
      retentionPlanText:
        "Hawley sup + Essix inf + retenedor fijo lingual 3-3 .0195. " +
        "Régimen 24/7 año 1, nocturno años 2-5. Controles 3/6/12/24/36 meses.",
      status: "IN_PROGRESS",
      statusUpdatedAt: new Date("2026-04-08"),
      prescriptionSlot: "MBT_022",
      bondingType: "DIRECTO",
      prescriptionNotes: "Premolares cerámicos, molares con tubos.",
      tadsRequired: true,
      iprRequired: true,
      phases: {
        create: PHASES.map((phase, i) => ({
          phaseKey: phase,
          orderIndex: i + 1,
          clinicId,
          status:
            i === 0 ? "COMPLETED" : i === 1 ? "IN_PROGRESS" : "NOT_STARTED",
          startedAt:
            i === 0
              ? new Date("2026-01-14")
              : i === 1
                ? new Date("2026-04-08")
                : null,
          completedAt: i === 0 ? new Date("2026-04-08") : null,
        })),
      },
    },
    select: { id: true },
  });
  return plan.id;
}

interface WireSeed {
  orderIndex: number;
  phaseKey: (typeof PHASES)[number];
  material: "NITI" | "SS" | "TMA";
  shape: "ROUND" | "RECT";
  gauge: string;
  durationWeeks: number;
  status: "PLANNED" | "ACTIVE" | "COMPLETED";
  plannedDate: Date | null;
  appliedDate: Date | null;
  completedDate: Date | null;
  purpose: string;
}

const WIRES: ReadonlyArray<WireSeed> = [
  {
    orderIndex: 1,
    phaseKey: "ALIGNMENT",
    material: "NITI",
    shape: "ROUND",
    gauge: "0.014",
    durationWeeks: 6,
    status: "COMPLETED",
    plannedDate: new Date("2026-01-14"),
    appliedDate: new Date("2026-01-14"),
    completedDate: new Date("2026-02-25"),
    purpose: "Alineación inicial superior e inferior",
  },
  {
    orderIndex: 2,
    phaseKey: "ALIGNMENT",
    material: "NITI",
    shape: "ROUND",
    gauge: "0.016",
    durationWeeks: 6,
    status: "COMPLETED",
    plannedDate: new Date("2026-02-25"),
    appliedDate: new Date("2026-02-25"),
    completedDate: new Date("2026-04-08"),
    purpose: "Alineación con incremento de fuerza",
  },
  {
    orderIndex: 3,
    phaseKey: "LEVELING",
    material: "NITI",
    shape: "ROUND",
    gauge: "0.018",
    durationWeeks: 8,
    status: "ACTIVE",
    plannedDate: new Date("2026-04-08"),
    appliedDate: new Date("2026-04-08"),
    completedDate: null,
    purpose: "Nivelación curva de Spee",
  },
  {
    orderIndex: 4,
    phaseKey: "LEVELING",
    material: "NITI",
    shape: "RECT",
    gauge: "16x22",
    durationWeeks: 8,
    status: "PLANNED",
    plannedDate: null,
    appliedDate: null,
    completedDate: null,
    purpose: "Working wire — torque inicial",
  },
  {
    orderIndex: 5,
    phaseKey: "SPACE_CLOSURE",
    material: "SS",
    shape: "RECT",
    gauge: "17x25",
    durationWeeks: 10,
    status: "PLANNED",
    plannedDate: null,
    appliedDate: null,
    completedDate: null,
    purpose: "Cierre de espacios con mecánica de deslizamiento",
  },
  {
    orderIndex: 6,
    phaseKey: "SPACE_CLOSURE",
    material: "SS",
    shape: "RECT",
    gauge: "19x25",
    durationWeeks: 12,
    status: "PLANNED",
    plannedDate: null,
    appliedDate: null,
    completedDate: null,
    purpose: "Cierre con cadena elastomérica + TADs",
  },
  {
    orderIndex: 7,
    phaseKey: "DETAILS",
    material: "TMA",
    shape: "RECT",
    gauge: "19x25",
    durationWeeks: 8,
    status: "PLANNED",
    plannedDate: null,
    appliedDate: null,
    completedDate: null,
    purpose: "Detalles + ajuste de torque",
  },
  {
    orderIndex: 8,
    phaseKey: "FINISHING",
    material: "TMA",
    shape: "RECT",
    gauge: "19x25",
    durationWeeks: 4,
    status: "PLANNED",
    plannedDate: null,
    appliedDate: null,
    completedDate: null,
    purpose: "Finishing wires con bend-backs",
  },
];

async function seedWireSequence(
  clinicId: string,
  patientId: string,
  treatmentPlanId: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (const w of WIRES) {
    const created = await db.orthoWireStep.create({
      data: {
        treatmentPlanId,
        clinicId,
        patientId,
        orderIndex: w.orderIndex,
        phaseKey: w.phaseKey,
        material: w.material,
        shape: w.shape,
        gauge: w.gauge,
        archUpper: true,
        archLower: true,
        durationWeeks: w.durationWeeks,
        auxiliaries: [],
        purpose: w.purpose,
        status: w.status,
        plannedDate: w.plannedDate,
        appliedDate: w.appliedDate,
        completedDate: w.completedDate,
      },
      select: { id: true },
    });
    ids.push(created.id);
  }
  return ids;
}

async function seedTads(
  clinicId: string,
  patientId: string,
  treatmentPlanId: string,
): Promise<void> {
  await db.orthoTAD.createMany({
    data: [
      {
        treatmentPlanId,
        patientId,
        clinicId,
        brand: "DENTOS",
        size: "1.4×8mm",
        location: "Vestibular sup. der entre 14 y 15",
        torqueNcm: 18,
        placedDate: new Date("2026-03-11"),
        failed: false,
      },
      {
        treatmentPlanId,
        patientId,
        clinicId,
        brand: "DENTOS",
        size: "1.4×8mm",
        location: "Vestibular sup. izq entre 24 y 25",
        torqueNcm: 16,
        placedDate: new Date("2026-03-11"),
        failed: false,
      },
    ],
  });
}

async function seedTreatmentCards(
  clinicId: string,
  patientId: string,
  treatmentPlanId: string,
  wireIds: string[],
): Promise<void> {
  // Card #1 — alineación inicial, mes 0
  await db.orthoTreatmentCard.create({
    data: {
      treatmentPlanId,
      patientId,
      clinicId,
      cardNumber: 1,
      visitDate: new Date("2026-01-14"),
      durationMin: 90,
      phaseKey: "ALIGNMENT",
      monthAt: 0,
      wireFromId: null,
      wireToId: wireIds[0]!,
      soapS: "Paciente refiere ansiedad ante la instalación.",
      soapO: "Mucosa sana, sin lesiones. Brackets MBT 0.022 cementados directamente.",
      soapA: "Tolerancia adecuada al procedimiento.",
      soapP: "Cita en 4 sem.",
      hasProgressPhoto: true,
      status: "SIGNED",
      hygienePlaquePct: 22,
    },
  });
  // Card #2 — alineación, mes 1.5, +1 IPR
  await db.orthoTreatmentCard.create({
    data: {
      treatmentPlanId,
      patientId,
      clinicId,
      cardNumber: 2,
      visitDate: new Date("2026-02-25"),
      durationMin: 30,
      phaseKey: "ALIGNMENT",
      monthAt: 1.5,
      wireFromId: wireIds[0]!,
      wireToId: wireIds[1]!,
      soapS: "Confort adecuado · sin molestias.",
      soapO: "Buena progresión de alineación. IPR 13-14 (0.3 mm).",
      soapA: "Continuar alineación.",
      soapP: "Cambio a 0.016, IPR 13-14.",
      hasProgressPhoto: false,
      status: "SIGNED",
      hygienePlaquePct: 18,
      iprPoints: {
        create: [
          {
            clinicId,
            patientId,
            toothA: 13,
            toothB: 14,
            amountMm: 0.3,
            done: true,
          },
        ],
      },
    },
  });
  // Card #3 — alineación, mes 2, +2 IPR / 1 re-bond
  await db.orthoTreatmentCard.create({
    data: {
      treatmentPlanId,
      patientId,
      clinicId,
      cardNumber: 3,
      visitDate: new Date("2026-03-11"),
      durationMin: 60,
      phaseKey: "ALIGNMENT",
      monthAt: 2,
      wireFromId: wireIds[1]!,
      wireToId: wireIds[1]!,
      soapS: "Bracket de 22 desprendido.",
      soapO:
        "Re-bond 22 directo. IPR 11-12 (0.2) y 21-22 (0.2). Colocación 2 TADs Dentos sup.",
      soapA: "Falla bracket por brick chewing — alta de hábito.",
      soapP: "Iniciar elásticos clase II en próxima cita.",
      hasProgressPhoto: true,
      status: "SIGNED",
      hygienePlaquePct: 28,
      iprPoints: {
        create: [
          {
            clinicId,
            patientId,
            toothA: 11,
            toothB: 12,
            amountMm: 0.2,
            done: true,
          },
          {
            clinicId,
            patientId,
            toothA: 21,
            toothB: 22,
            amountMm: 0.2,
            done: true,
          },
        ],
      },
      brokenBrackets: {
        create: [
          {
            clinicId,
            patientId,
            toothFdi: 22,
            brokenDate: new Date("2026-03-11"),
            reBondedDate: new Date("2026-03-11"),
            notes: "Bond directo, brick chewing.",
          },
        ],
      },
    },
  });
  // Card #4 — nivelación, mes 3, elásticos clase II
  await db.orthoTreatmentCard.create({
    data: {
      treatmentPlanId,
      patientId,
      clinicId,
      cardNumber: 4,
      visitDate: new Date("2026-04-08"),
      durationMin: 30,
      phaseKey: "LEVELING",
      monthAt: 3,
      wireFromId: wireIds[1]!,
      wireToId: wireIds[2]!,
      soapS: "Buen confort. Elásticos colocados consistentemente.",
      soapO: 'Cambio a NiTi 0.018 sup/inf. Elásticos Clase II 1/4" 6oz.',
      soapA: "Inicia fase nivelación.",
      soapP: "Reforzar uso elásticos 22h/día.",
      hasProgressPhoto: false,
      status: "SIGNED",
      hygienePlaquePct: 15,
      elastics: {
        create: [
          {
            clinicId,
            patientId,
            elasticClass: "CLASE_II",
            config: '1/4" 6oz',
            zone: "INTERMAXILAR",
          },
        ],
      },
    },
  });
}

async function seedPaymentPlan(
  clinicId: string,
  patientId: string,
  treatmentPlanId: string,
): Promise<void> {
  // Mockup verbatim: 8 mensualidades · $4,167 cada una · total $33,336 ≈ $33,340.
  // 4 PAID (feb-may 2026) con CFDI ✓ + 4 PENDING (jun-sep 2026).
  // Reemplaza el seed previo que usaba mix $1,875/$2,500 sin sumar al total.
  const startDate = new Date("2026-02-14");
  const endDate = new Date("2026-09-14");
  const TOTAL = 33340;
  const INSTALLMENT = 4167;
  const COUNT = 8;
  const paidCount = 4;
  const paidAmount = INSTALLMENT * paidCount; // 16668
  const plan = await db.orthoPaymentPlan.create({
    data: {
      treatmentPlanId,
      patientId,
      clinicId,
      totalAmount: TOTAL,
      initialDownPayment: 0,
      installmentCount: COUNT,
      installmentAmount: INSTALLMENT,
      startDate,
      endDate,
      paymentDayOfMonth: 14,
      paidAmount,
      pendingAmount: TOTAL - paidAmount,
      status: "ON_TIME",
      preferredPaymentMethod: "CREDIT_CARD",
    },
    select: { id: true },
  });

  // 8 installments — 4 PAID con CFDI placeholder + 4 PENDING.
  const installments: Array<{
    installmentNumber: number;
    amount: number;
    dueDate: Date;
    status: "PAID" | "PENDING";
    paidAt: Date | null;
    method: "CREDIT_CARD" | "BANK_TRANSFER" | null;
  }> = [
    {
      installmentNumber: 1,
      amount: INSTALLMENT,
      dueDate: new Date("2026-02-14"),
      status: "PAID",
      paidAt: new Date("2026-02-13"),
      method: "CREDIT_CARD",
    },
    {
      installmentNumber: 2,
      amount: INSTALLMENT,
      dueDate: new Date("2026-03-14"),
      status: "PAID",
      paidAt: new Date("2026-03-12"),
      method: "CREDIT_CARD",
    },
    {
      installmentNumber: 3,
      amount: INSTALLMENT,
      dueDate: new Date("2026-04-14"),
      status: "PAID",
      paidAt: new Date("2026-04-15"),
      method: "BANK_TRANSFER",
    },
    {
      installmentNumber: 4,
      amount: INSTALLMENT,
      dueDate: new Date("2026-05-14"),
      status: "PAID",
      paidAt: new Date("2026-05-02"),
      method: "CREDIT_CARD",
    },
    {
      installmentNumber: 5,
      amount: INSTALLMENT,
      dueDate: new Date("2026-06-14"),
      status: "PENDING",
      paidAt: null,
      method: null,
    },
    {
      installmentNumber: 6,
      amount: INSTALLMENT,
      dueDate: new Date("2026-07-14"),
      status: "PENDING",
      paidAt: null,
      method: null,
    },
    {
      installmentNumber: 7,
      amount: INSTALLMENT,
      dueDate: new Date("2026-08-14"),
      status: "PENDING",
      paidAt: null,
      method: null,
    },
    {
      installmentNumber: 8,
      amount: INSTALLMENT,
      dueDate: new Date("2026-09-14"),
      status: "PENDING",
      paidAt: null,
      method: null,
    },
  ];
  for (const i of installments) {
    await db.orthoInstallment.create({
      data: {
        paymentPlanId: plan.id,
        clinicId,
        installmentNumber: i.installmentNumber,
        amount: i.amount,
        dueDate: i.dueDate,
        status: i.status,
        paidAt: i.paidAt,
        amountPaid: i.status === "PAID" ? i.amount : null,
        paymentMethod: i.method,
      },
    });
  }
}

async function seedLabOrders(
  clinicId: string,
  patientId: string,
  authorId: string,
): Promise<void> {
  await db.labOrder.createMany({
    data: [
      {
        clinicId,
        patientId,
        module: "orthodontics",
        authorId,
        orderType: "ortho_appliance",
        spec: { catalog: "Modelos estudio digital", lab: "Lab Cendres MX" },
        status: "received",
        sentAt: new Date("2026-01-08"),
        receivedAt: new Date("2026-01-12"),
        notes: "Modelos para ortodoncia digital pre-tx.",
      },
      {
        clinicId,
        patientId,
        module: "orthodontics",
        authorId,
        orderType: "retainer",
        spec: { catalog: "Retenedor Hawley sup planificado", lab: "Lab Cendres MX" },
        status: "draft",
        sentAt: null,
        receivedAt: null,
        notes: "Retenedor superior — pendiente al debonding (fase RETENTION).",
      },
    ],
  });
}

/**
 * Sección I · WhatsApp log — 3 mensajes demo para Gabriela.
 *
 * Modelo correcto: InboxThread (channel=WHATSAPP) + InboxMessage children con
 * direction=IN/OUT. NO existe tabla "WhatsAppMessage" — el inbox unificado
 * cubre WhatsApp, Email, PortalForm, Validation y Reminder bajo el mismo
 * thread/message schema.
 *
 * Datos verbatim del prompt master:
 *   - Hace 1 sem · OUT · "Tu cita es el 9 abril 10:30. Confirma con 1." · READ
 *   - Hace 5 días · IN · "Doctora, se cayó un bracket otra vez 😔" · UNREAD/leído
 *   - Hace 2 días · OUT · "Hola Gabriela, recuerda traer tus elásticos..." · DELIVERED
 *
 * El status del thread se deriva del último mensaje recibido sin leer.
 */
async function seedWhatsAppLog(
  clinicId: string,
  patientId: string,
  doctorId: string,
): Promise<void> {
  const now = Date.now();
  const _2d = new Date(now - 2 * 24 * 60 * 60 * 1000);
  const _5d = new Date(now - 5 * 24 * 60 * 60 * 1000);
  const _1w = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const thread = await db.inboxThread.create({
    data: {
      clinicId,
      patientId,
      channel: "WHATSAPP",
      // El paciente leyó el último OUT pero el IN del bracket caído quedó
      // como UNREAD para mostrar al doctor el badge en la inbox.
      status: "READ",
      subject: "Conversación WhatsApp ortodoncia",
      lastMessageAt: _2d,
      tags: ["ortodoncia"],
    },
    select: { id: true },
  });

  await db.inboxMessage.createMany({
    data: [
      // Hace 1 sem · OUT · cita confirmada
      {
        threadId: thread.id,
        direction: "OUT",
        body: "Hola Gabriela 👋 Tu cita es el martes 9 abril a las 10:30. Confirma con un 1 si vas a asistir, o avísanos para reagendar.",
        sentAt: _1w,
        sentById: doctorId,
        isInternal: false,
      },
      // Hace 5 días · IN · bracket caído
      {
        threadId: thread.id,
        direction: "IN",
        body: "Doctora, se cayó un bracket otra vez 😔 ¿qué hago?",
        sentAt: _5d,
        sentById: null,
        isInternal: false,
      },
      // Hace 2 días · OUT · recordatorio elásticos
      {
        threadId: thread.id,
        direction: "OUT",
        body: "Hola Gabriela, recuerda traer tus elásticos y el control de cepillado para tu cita del jueves. Te esperamos a las 10:30 ✨",
        sentAt: _2d,
        sentById: doctorId,
        isInternal: false,
      },
    ],
  });
}

async function seedPatientFlow(clinicId: string, patientId: string): Promise<void> {
  // Hoy a las 10:18 — paciente WAITING en Sillón 2.
  const today = new Date();
  const enteredAt = new Date(today);
  enteredAt.setHours(10, 18, 0, 0);
  await db.patientFlow.create({
    data: {
      clinicId,
      patientId,
      status: "WAITING",
      chair: "Sillón 2",
      enteredAt,
    },
  });
}

/**
 * Sección Hero stats + Sidebar derecha · "Próxima cita".
 *
 * Seedea 14 OrthodonticControlAppointment ATTENDED + 1 NO_SHOW +
 * 1 future SCHEDULED (13-may-2026 10:30 · Control mensual ortodoncia ·
 * Sillón 2 · 30 min). El loader deriva nextAppointment del control con
 * scheduledAt futuro más cercano. attendancePct se computa en el adapter
 * y dará 14/15 = 93%.
 */
async function seedOrthoControls(
  clinicId: string,
  patientId: string,
  treatmentPlanId: string,
  doctorId: string,
): Promise<void> {
  // 14 visitas atendidas distribuidas mes 0 → mes 4.
  // Fechas reales de Card #1-#4 también son control appointments (mismas
  // fechas), así el doctor puede correlacionar.
  const ATTENDED_DATES: Array<{ date: string; month: number }> = [
    { date: "2026-01-14T10:00:00.000-06:00", month: 0 },
    { date: "2026-01-21T10:00:00.000-06:00", month: 0 }, // check-in post-bracket
    { date: "2026-01-28T10:00:00.000-06:00", month: 0 },
    { date: "2026-02-11T10:00:00.000-06:00", month: 1 },
    { date: "2026-02-25T10:00:00.000-06:00", month: 1 }, // Card #2
    { date: "2026-03-04T10:00:00.000-06:00", month: 2 },
    { date: "2026-03-11T10:00:00.000-06:00", month: 2 }, // Card #3 + TADs
    { date: "2026-03-18T10:00:00.000-06:00", month: 2 },
    { date: "2026-03-25T10:00:00.000-06:00", month: 2 },
    { date: "2026-04-01T10:00:00.000-06:00", month: 3 },
    { date: "2026-04-08T10:00:00.000-06:00", month: 3 }, // Card #4
    { date: "2026-04-15T10:00:00.000-06:00", month: 3 },
    { date: "2026-04-22T10:00:00.000-06:00", month: 3 },
    { date: "2026-04-29T10:00:00.000-06:00", month: 4 },
  ];
  for (const c of ATTENDED_DATES) {
    const scheduledAt = new Date(c.date);
    await db.orthodonticControlAppointment.create({
      data: {
        treatmentPlanId,
        patientId,
        clinicId,
        scheduledAt,
        performedAt: scheduledAt,
        monthInTreatment: c.month,
        attendance: "ATTENDED",
        attendedById: doctorId,
        appliancesIntact: true,
        patientReportsPain: false,
      },
    });
  }
  // 1 NO_SHOW (paciente faltó · enfermedad).
  await db.orthodonticControlAppointment.create({
    data: {
      treatmentPlanId,
      patientId,
      clinicId,
      scheduledAt: new Date("2026-02-04T10:00:00.000-06:00"),
      performedAt: null,
      monthInTreatment: 1,
      attendance: "NO_SHOW",
      attendedById: doctorId,
      patientPainNotes: "Paciente reportó cuadro gripal · re-agendar",
    },
  });
  // 1 future SCHEDULED — Próxima cita 13-may-2026 10:30, Sillón 2, 30 min.
  const nextDate = new Date("2026-05-13T10:30:00.000-06:00");
  await db.orthodonticControlAppointment.create({
    data: {
      treatmentPlanId,
      patientId,
      clinicId,
      scheduledAt: nextDate,
      performedAt: null,
      monthInTreatment: 4,
      attendance: "ATTENDED", // ATTENDED es el default — el filtro en
      // el adapter usa scheduledAt > now y attendance != NO_SHOW para
      // detectar próxima cita. ATTENDED no se filtra (paciente aún no
      // ha llegado pero está en agenda).
      attendedById: doctorId,
    },
  });
}

/**
 * Sección E · Foto-sets históricos.
 *
 * Seedea T0 (Inicial · 14-ene-2026 · 8 fotos) + T1 (3 meses · 8-abr-2026 ·
 * 8 fotos). Cada foto es un PatientFile con URL placeholder de
 * picsum.photos (público) — el `signMaybeUrl` los devuelve tal cual
 * porque no son paths del bucket privado.
 *
 * NOTA: para producción real las URLs deben venir de Supabase Storage
 * (private bucket) · ver /api/orthodontics/photos/upload.
 */
async function seedPhotoSets(
  clinicId: string,
  patientId: string,
  treatmentPlanId: string,
  doctorId: string,
): Promise<void> {
  type SetType = "T0" | "T1";
  const VIEWS: Array<{
    column:
      | "photoFrontalId"
      | "photoProfileId"
      | "photoSmileId"
      | "photoIntraFrontalId"
      | "photoIntraLateralRId"
      | "photoIntraLateralLId"
      | "photoOcclusalUpperId"
      | "photoOcclusalLowerId";
    label: string;
    seed: number;
  }> = [
    { column: "photoFrontalId", label: "Extraoral frontal", seed: 1011 },
    { column: "photoProfileId", label: "Extraoral perfil", seed: 1012 },
    { column: "photoSmileId", label: "Extraoral sonrisa", seed: 1013 },
    { column: "photoIntraFrontalId", label: "Intraoral frontal", seed: 1014 },
    { column: "photoIntraLateralRId", label: "Intraoral lateral der", seed: 1015 },
    { column: "photoIntraLateralLId", label: "Intraoral lateral izq", seed: 1016 },
    { column: "photoOcclusalUpperId", label: "Oclusal superior", seed: 1017 },
    { column: "photoOcclusalLowerId", label: "Oclusal inferior", seed: 1018 },
  ];

  const SETS: Array<{
    setType: SetType;
    capturedAt: Date;
    monthInTreatment: number;
    notes: string;
  }> = [
    {
      setType: "T0",
      capturedAt: new Date("2026-01-14T11:00:00.000-06:00"),
      monthInTreatment: 0,
      notes: "Set fotográfico inicial · pre-bracket placement.",
    },
    {
      setType: "T1",
      capturedAt: new Date("2026-04-08T11:00:00.000-06:00"),
      monthInTreatment: 3,
      notes: "Set fotográfico 3 meses · transición ALIGNMENT → LEVELING.",
    },
  ];

  for (const s of SETS) {
    const createdSet = await db.orthoPhotoSet.create({
      data: {
        treatmentPlanId,
        patientId,
        clinicId,
        setType: s.setType,
        capturedAt: s.capturedAt,
        capturedById: doctorId,
        monthInTreatment: s.monthInTreatment,
        notes: s.notes,
      },
      select: { id: true },
    });

    // 8 PatientFile placeholder pointing a picsum.photos (URLs públicas
    // estables por seed). El `signMaybeUrl` los detecta como no-Supabase
    // y los devuelve tal cual.
    const ids: Record<string, string> = {};
    for (const v of VIEWS) {
      const placeholderUrl = `https://picsum.photos/seed/${s.setType}-${v.seed}/600/400`;
      const file = await db.patientFile.create({
        data: {
          clinicId,
          patientId,
          uploadedBy: doctorId,
          name: `${s.setType}-${v.label}.jpg`,
          url: placeholderUrl,
          mimeType: "image/jpeg",
          category: s.setType === "T0" ? "ORTHO_PHOTO_T0" : "ORTHO_PHOTO_T1",
          notes: `Set ${s.setType} · ${v.label} (seed demo).`,
          takenAt: s.capturedAt,
        },
        select: { id: true },
      });
      ids[v.column] = file.id;
    }
    await db.orthoPhotoSet.update({
      where: { id: createdSet.id },
      data: ids,
    });
  }
}

/**
 * Sección F · ModalOpenChoice G5 — 3 escenarios pre-cargados:
 *   - Contado (10% descuento)
 *   - Enganche + 18 meses (recomendado)
 *   - Enganche + 24 meses MSI 6
 *
 * El doctor selecciona uno con `selectQuoteScenario` server action;
 * el modal se abre desde Sección F → "Presentar cotización G5".
 */
async function seedQuoteScenarios(
  clinicId: string,
  treatmentPlanId: string,
  doctorId: string,
): Promise<void> {
  await db.orthoQuoteScenario.create({
    data: {
      treatmentPlanId,
      clinicId,
      label: "Contado",
      paymentMode: "CONTADO",
      downPayment: 30006, // 33340 - 10% = 30006
      monthlyAmount: 0,
      monthsCount: 0,
      totalAmount: 30006,
      discountPct: 10,
      badge: "10% descuento",
      includes: [
        "Pago único · sin cargos financieros",
        "CFDI 4.0 timbrado al momento",
        "Materiales premium (Damon Q2 + arcos NiTi termo)",
      ],
      status: "DRAFT",
      createdById: doctorId,
    },
  });
  await db.orthoQuoteScenario.create({
    data: {
      treatmentPlanId,
      clinicId,
      label: "Enganche + 18 meses",
      paymentMode: "ENGANCHE_MENSUALIDADES",
      downPayment: 5000,
      monthlyAmount: 1574, // (33340-5000)/18 ≈ 1574
      monthsCount: 18,
      totalAmount: 33340,
      discountPct: 0,
      badge: "Recomendado",
      includes: [
        "Enganche $5,000 · 18 mensualidades",
        "CFDI 4.0 mensual",
        "Re-bond gratuito si bracket se cae 1ra vez",
      ],
      status: "DRAFT",
      createdById: doctorId,
    },
  });
  await db.orthoQuoteScenario.create({
    data: {
      treatmentPlanId,
      clinicId,
      label: "Enganche + 24 meses MSI 6",
      paymentMode: "ENGANCHE_MSI",
      downPayment: 5000,
      monthlyAmount: 1181, // (33340-5000)/24 ≈ 1181
      monthsCount: 24,
      totalAmount: 33340,
      discountPct: 0,
      badge: "MSI 6",
      includes: [
        "Enganche $5,000 + 24 mensualidades",
        "Primeros 6 meses sin intereses",
        "Stripe MX · tarjetas participantes",
      ],
      status: "DRAFT",
      createdById: doctorId,
    },
  });
}

/**
 * Sección H · programa referidos — código personalizado para Gabriela.
 */
async function seedReferralCode(
  clinicId: string,
  patientId: string,
  treatmentPlanId: string,
): Promise<void> {
  await db.orthoReferralCode.create({
    data: {
      treatmentPlanId,
      patientId,
      clinicId,
      code: "GABY26",
      referralCount: 0,
      rewardLabel: "1 mes gratis · referido completa diagnóstico",
    },
  });
}

/**
 * Compliance elásticos 78% — guardado como auditLog `ortho.elastics.compliance.recorded`.
 * El loader lee la última entry y la usa como elasticsCompliancePct (sin
 * requerir column nueva en OrthodonticTreatmentPlan).
 */
async function seedComplianceAuditLog(
  clinicId: string,
  treatmentPlanId: string,
  doctorId: string,
): Promise<void> {
  await db.auditLog.create({
    data: {
      clinicId,
      userId: doctorId,
      entityType: "OrthodonticTreatmentPlan",
      entityId: treatmentPlanId,
      action: "ortho.elastics.compliance.recorded",
      changes: {
        _created: {
          before: null,
          after: {
            evaluatedAt: "2026-04-30T00:00:00.000Z",
            compliancePct: 78,
            reminderEnqueued: false,
          },
        },
      },
    },
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[ortho-demo] fail:", e);
    process.exit(1);
  })
  .finally(() => {
    void db.$disconnect();
  });
