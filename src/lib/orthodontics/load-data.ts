// Orthodontics — helper compartido. SPEC §6.

import { differenceInMonths, differenceInYears } from "date-fns";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { patientVisibilityAnd, type VisibilityViewer } from "@/lib/patient-visibility";
import type {
  OrthodonticDiagnosisRow,
  OrthodonticTreatmentPlanRow,
  OrthodonticPhaseRow,
  OrthoPaymentPlanRow,
  OrthoInstallmentRow,
  OrthoPhotoSetWithFiles,
  OrthodonticControlAppointmentRow,
  OrthodonticDigitalRecordRow,
} from "@/lib/types/orthodontics";

export interface LoadOrthoDataInput {
  clinicId: string;
  patientId: string;
  /**
   * ws1-t8 — el caso que se pidió (`?caso=`) cuando el paciente tiene más de uno.
   * Sin él, o si no es un caso vivo de este paciente, sale el caso activo más
   * reciente (y si todos cerraron, el más reciente).
   */
  planId?: string | null;
}

export interface OrthoTabData {
  patientId: string;
  patientName: string;
  isMinor: boolean;
  patientAge: number | null;
  guardianName?: string | null;
  /**
   * ws1-t10 (H·F "Menor con tutor") — el parentesco («madre», «tutor_legal»)
   * del RESPONSABLE DE PAGO real del caso (`responsibleGuardianId`, A11),
   * cuando existe. `null` = `guardianName` sigue siendo el de
   * `PediatricProfile` (o no hay ninguno): antes la cabecera SOLO sabía de
   * este segundo, casi siempre vacío fuera del módulo de Pediatría.
   */
  responsibleGuardianRelation?: string | null;
  hasPediatricProfile: boolean;
  pediatricHabits: readonly string[];
  diagnosis: OrthodonticDiagnosisRow | null;
  plan: OrthodonticTreatmentPlanRow | null;
  phases: OrthodonticPhaseRow[];
  monthInTreatment: number;
  paymentPlan: OrthoPaymentPlanRow | null;
  installments: OrthoInstallmentRow[];
  photoSets: OrthoPhotoSetWithFiles[];
  controls: OrthodonticControlAppointmentRow[];
  digitalRecords: OrthodonticDigitalRecordRow[];
  /**
   * H56: radiografías y escaneos que el paciente ya tiene en su expediente
   * (Radiografías, etc.), para verlos también en «Registros digitales» del
   * caso: antes subías allá, volvías y esto seguía vacío.
   */
  archivosDelPaciente?: { id: string; name: string; category: string; date: string }[];
  /**
   * Revisión cruzada de la Ola 1 (REPORTE-ws1-t1.md, "## Revisión
   * cruzada" → "## Arreglos de la revisión"): cuando `plan.invoiceId` no es
   * null (Cobro, ws1-t1, ya abrió el plan de pago), estos dos son el total
   * y lo pagado de la factura REAL — lo que hay que enseñar en la ficha, el
   * acuerdo financiero y el PDF, en vez de `plan.totalCostMxn`/
   * `paymentPlan.paidAmount`. `null` = sin factura todavía (o la columna
   * `invoiceId` aún no existe en esta base) — quien consuma esto sigue
   * cayendo al precio tipeado al abrir el caso, como hasta ahora.
   */
  invoiceTotal: number | null;
  invoicePaid: number | null;
}

export async function loadOrthoData(
  input: LoadOrthoDataInput,
  viewer: VisibilityViewer,
): Promise<OrthoTabData | null> {
  const patient = await prisma.patient.findFirst({
    where: {
      id: input.patientId,
      clinicId: input.clinicId,
      deletedAt: null,
      // Visibilidad por paciente: un paciente restringido no existe para quien no está en su visibleUserIds.
      AND: [...patientVisibilityAnd(viewer)],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      dob: true,
    },
  });
  if (!patient) return null;

  const fullName = `${patient.firstName} ${patient.lastName}`.trim();
  const age = patient.dob ? differenceInYears(new Date(), patient.dob) : null;
  const isMinor = age != null && age < 18;

  // Pediatric profile (best effort — Pediatrics module puede no estar instalado).
  let hasPediatricProfile = false;
  let guardianName: string | null = null;
  let pediatricHabits: readonly string[] = [];
  try {
    // El modelo PediatricProfile puede no existir en este repo; capturamos errores.
    const profile = await (prisma as unknown as { pediatricProfile?: { findUnique: (args: unknown) => Promise<unknown> } })
      ?.pediatricProfile?.findUnique?.({ where: { patientId: patient.id } });
    if (profile) {
      hasPediatricProfile = true;
      const p = profile as { guardianName?: string; habits?: string[] };
      guardianName = p.guardianName ?? null;
      pediatricHabits = (p.habits ?? []) as readonly string[];
    }
  } catch {
    // PediatricProfile no existe en schema — Pediatría no instalada, ignorar.
  }

  const planPedido = fetchPlanTolerante(patient.id, input.clinicId, input.planId ?? null);
  const [diagnosis, plan, photoSets, controls, digitalRecords] = await Promise.all([
    planPedido.then(async (p) => {
      // Un caso pedido a propósito enseña SU diagnóstico (uno por caso); sin
      // pedirlo, el más reciente del paciente, como siempre (es el que usa «Abrir caso»).
      if (input.planId && p?.id === input.planId) {
        const suyo = await prisma.orthodonticDiagnosis.findFirst({
          where: { id: p.diagnosisId, patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
        });
        if (suyo) return suyo;
      }
      return prisma.orthodonticDiagnosis.findFirst({
        where: { patientId: patient.id, clinicId: input.clinicId, deletedAt: null },
        orderBy: { diagnosedAt: "desc" },
      });
    }),
    planPedido,
    prisma.orthoPhotoSet.findMany({
      where: { patientId: patient.id, clinicId: input.clinicId },
      include: {
        photoFrontal: true,
        photoProfile: true,
        photoSmile: true,
        photoIntraFrontal: true,
        photoIntraLateralR: true,
        photoIntraLateralL: true,
        photoOcclusalUpper: true,
        photoOcclusalLower: true,
      },
      orderBy: { capturedAt: "desc" },
    }),
    prisma.orthodonticControlAppointment.findMany({
      where: { patientId: patient.id, clinicId: input.clinicId },
      orderBy: { scheduledAt: "desc" },
      take: 60,
    }),
    prisma.orthodonticDigitalRecord.findMany({
      where: { patientId: patient.id, clinicId: input.clinicId },
      orderBy: { capturedAt: "desc" },
    }),
  ]);

  const [phases, paymentPlan, archivosRaw] = await Promise.all([
    plan
      ? prisma.orthodonticPhase.findMany({
          where: { treatmentPlanId: plan.id },
          orderBy: { orderIndex: "asc" },
        })
      : Promise.resolve([] as OrthodonticPhaseRow[]),
    plan
      ? prisma.orthoPaymentPlan.findFirst({
          where: { treatmentPlanId: plan.id, clinicId: input.clinicId },
        })
      : Promise.resolve(null),
    prisma.patientFile
      .findMany({
        where: {
          patientId: patient.id,
          clinicId: input.clinicId,
          category: {
            in: [
              "XRAY_PANORAMIC",
              "XRAY_CEPHALOMETRIC",
              "XRAY_CBCT",
              "XRAY_PERIAPICAL",
              "XRAY_BITEWING",
              "XRAY_OCCLUSAL",
              "SCAN_STL",
              "CEPH_ANALYSIS_PDF",
            ],
          },
        },
        select: { id: true, name: true, category: true, takenAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 30,
      })
      .catch(() => [] as { id: string; name: string; category: string; takenAt: Date | null; createdAt: Date }[]),
  ]);

  const archivosDelPaciente = archivosRaw.map((a) => ({
    id: a.id,
    name: a.name,
    category: String(a.category),
    date: (a.takenAt ?? a.createdAt).toISOString(),
  }));

  const installments = paymentPlan
    ? await prisma.orthoInstallment.findMany({
        where: { paymentPlanId: paymentPlan.id },
        orderBy: { installmentNumber: "asc" },
      })
    : [];

  const monthInTreatment = (() => {
    if (!plan?.installedAt) return 0;
    return Math.max(0, differenceInMonths(new Date(), plan.installedAt));
  })();

  // ws1-t10 (H·F "Menor con tutor") — el responsable de pago REAL del caso
  // (A11) manda sobre el `PediatricProfile.guardianName` de arriba, que
  // depende de un módulo distinto (Pediatría) y casi siempre está vacío.
  // Best-effort: sin la columna `responsibleGuardianId` todavía aplicada
  // (sql/ortodoncia-alta-caso.sql), `plan.responsibleGuardianId` es
  // `undefined` (no lanza) y esto no hace nada.
  let responsibleGuardianRelation: string | null = null;
  if (plan?.responsibleGuardianId) {
    try {
      const responsable = await prisma.guardian.findUnique({
        where: { id: plan.responsibleGuardianId },
        select: { fullName: true, parentesco: true },
      });
      if (responsable) {
        guardianName = responsable.fullName;
        responsibleGuardianRelation = responsable.parentesco;
      }
    } catch (e) {
      console.error("[ortho] loadOrthoData: responsibleGuardian no disponible todavía:", e);
    }
  }

  // Revisión cruzada (REPORTE-ws1-t1.md): factura REAL del tratamiento
  // (Cobro, F2) — el número que cuenta una vez que el caso tiene
  // `invoiceId`, no `plan.totalCostMxn`. `clinicId` en el where: aunque
  // `invoiceId` ya venga de un plan de ESTA clínica, no se confía un id
  // ajeno sin volver a cruzarlo (mismo criterio que cobranza-db.ts).
  const { invoiceTotal, invoicePaid } = await fetchInvoiceTotalTolerante(
    plan?.invoiceId ?? null,
    input.clinicId,
  );

  return {
    patientId: patient.id,
    patientName: fullName,
    isMinor,
    patientAge: age,
    guardianName,
    responsibleGuardianRelation,
    hasPediatricProfile,
    pediatricHabits,
    diagnosis,
    plan,
    phases,
    monthInTreatment,
    paymentPlan,
    installments,
    photoSets,
    controls,
    digitalRecords,
    archivosDelPaciente,
    invoiceTotal,
    invoicePaid,
  };
}

/** Códigos Prisma de "tabla/columna inexistente" — mismo criterio que cobranza-db.ts (Ola 0). */
function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

/**
 * El plan del caso, tolerando que las columnas nuevas de esta ola
 * (`treatingDoctorId`/`invoiceId`, Ola 0; `responsibleGuardianId`, Alta del
 * caso) aún no existan en esta base: reintenta omitiéndolas en vez de
 * tumbar toda la pestaña de Ortodoncia. Mismo patrón de "reintenta sin el
 * campo nuevo" que ya usan las actions de "Alta del caso"
 * (alta-caso-tolerance.ts).
 */
async function fetchPlanTolerante(
  patientId: string,
  clinicId: string,
  planId: string | null = null,
): Promise<OrthodonticTreatmentPlanRow | null> {
  const base = { patientId, clinicId, deletedAt: null } as const;
  // ws1-t8: el caso pedido; si no hay, el activo más reciente; si todos cerraron, el más reciente.
  if (planId) {
    const pedido = await leerPlanTolerante({ ...base, id: planId });
    if (pedido) return pedido;
  }
  const activo = await leerPlanTolerante({ ...base, status: { notIn: ["COMPLETED", "DROPPED_OUT"] } });
  return activo ?? leerPlanTolerante(base);
}

async function leerPlanTolerante(
  where: Prisma.OrthodonticTreatmentPlanWhereInput,
): Promise<OrthodonticTreatmentPlanRow | null> {
  try {
    return await prisma.orthodonticTreatmentPlan.findFirst({
      where,
      orderBy: { createdAt: "desc" },
    });
  } catch (e) {
    if (!esRelacionAusente(e)) throw e;
    // Reintenta con un `select` explícito que deja fuera las 3 columnas
    // nuevas (el resto de campos escalares del modelo, sin relaciones —
    // igual que el `GetPayload<{}>` de siempre). Sin ellas en el SELECT,
    // Postgres nunca las pide y no hay P2021/P2022 que atrapar.
    const sinColumnasNuevas = await prisma.orthodonticTreatmentPlan.findFirst({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        diagnosisId: true,
        patientId: true,
        clinicId: true,
        technique: true,
        techniqueNotes: true,
        estimatedDurationMonths: true,
        startDate: true,
        installedAt: true,
        prescriptionSlot: true,
        bondingType: true,
        prescriptionNotes: true,
        estimatedTotalDurationWeeks: true,
        totalCostMxn: true,
        anchorageType: true,
        anchorageNotes: true,
        extractionsRequired: true,
        extractionsTeethFdi: true,
        iprRequired: true,
        tadsRequired: true,
        treatmentObjectives: true,
        patientGoals: true,
        retentionPlanText: true,
        status: true,
        statusUpdatedAt: true,
        onHoldReason: true,
        onHoldStartedAt: true,
        droppedOutAt: true,
        droppedOutReason: true,
        signedTreatmentConsentFileId: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
    if (!sinColumnasNuevas) return null;
    // Las 3 columnas nuevas no vienen en el objeto (no existen en la base
    // todavía) — el resto del código las trata igual que `null` vía
    // `plan?.invoiceId` etc.: `undefined` es tan falsy como `null` ahí.
    return {
      ...sinColumnasNuevas,
      treatingDoctorId: null,
      invoiceId: null,
      responsibleGuardianId: null,
    } as OrthodonticTreatmentPlanRow;
  }
}

/** La factura real del tratamiento, o `{ null, null }` sin invoiceId, sin fila, o sin la columna todavía. */
async function fetchInvoiceTotalTolerante(
  invoiceId: string | null,
  clinicId: string,
): Promise<{ invoiceTotal: number | null; invoicePaid: number | null }> {
  const nada = { invoiceTotal: null, invoicePaid: null };
  if (!invoiceId) return nada;
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, clinicId },
      select: { total: true, paid: true },
    });
    if (!invoice) return nada;
    return { invoiceTotal: invoice.total, invoicePaid: invoice.paid };
  } catch (e) {
    if (esRelacionAusente(e)) return nada;
    console.error("[ortho load-data] no se pudo leer la factura real:", e);
    return nada;
  }
}
