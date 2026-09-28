// Orthodontics — cargador de datos para el Tablero y las Alertas (T1-T7,
// L1-L5 — ws1-t2, Ola 1, alcance-ortodoncia.html).
//
// Decisión 1 de la arquitectura (REPORTE-ws1-t8.md, «Las cuatro decisiones»):
// el dinero vive en la factura a plazos del tratamiento
// (`orthodonticTreatmentPlan.invoiceId` → `invoice_payment_terms` + `payments`),
// NUNCA en OrthoPaymentPlan/OrthoInstallment — esas tablas se ocultan (bloque
// S), no se leen aquí. `loadOrthoCases` es la base compartida por el Tablero,
// las Alertas y Pacientes en tratamiento.
//
// Tolera que `treatingDoctorId`/`invoiceId` (sql/ortodoncia-nucleo.sql)
// todavía no existan en esta base: P2021/P2022 se leen como «sin esos datos
// todavía» y se reintenta sin ellos — mismo espíritu que cobranza-db.ts y
// src/lib/patient-credit.ts. No tumba la pantalla mientras Rafael no pegue
// el SQL.
//
// `clinicId` y `zonaHoraria` SIEMPRE de la sesión (getCurrentUser), nunca
// del cliente. Menos de 7 consultas por Promise.all (regla del pooler).
//
// Revisión cruzada (REPORTE-ws1-t1.md, «## Revisión cruzada», bloquea): estas
// consultas solo filtraban por clinicId, sin `relatedPatientVisibilityAnd` —
// un doctor o recepción con `visibleUserIds` restringido veía en Tablero,
// Pacientes en tratamiento y Alertas los nombres, saldos y citas de TODOS los
// pacientes de ortodoncia de la clínica. Mismo criterio que ya usan
// build-kanban-data.ts y load-patients.ts.

import { prisma } from "@/lib/prisma";
import type { OrthoTreatmentStatus } from "@prisma/client";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import { calendarDayRangeUtc } from "@/lib/agenda/time-utils";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import { relatedPatientVisibilityAnd, type VisibilityViewer } from "@/lib/patient-visibility";
import { TIPO_CITA_CONTROL_ORTO } from "./agenda-constants";
import { cobranzaDelCaso } from "./cobranza-caso";
import {
  computeActiveCasesCount,
  computeMonthlyProjection,
  computeOverdueBalances,
  computePlacementsAndRemovals,
  computeProductionByDoctor,
  computeValoracionesSummary,
  isSameCalendarMonthUtc,
  type MonthlyProjectionBucket,
  type OrthoCaseSummary,
  type OverdueBalanceSummary,
  type PlacementsAndRemovals,
  type ProductionByDoctor,
  type ValoracionesSummary,
} from "./specialty-kpis";

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

const BASE_SELECT = {
  id: true,
  patientId: true,
  patient: { select: { firstName: true, lastName: true } },
  status: true,
  installedAt: true,
  estimatedDurationMonths: true,
  droppedOutAt: true,
  statusUpdatedAt: true,
} as const;

interface RawPlan {
  id: string;
  patientId: string;
  patientName: string;
  treatingDoctorId: string | null;
  treatingDoctorName: string | null;
  status: OrthoTreatmentStatus;
  installedAt: Date | null;
  estimatedDurationMonths: number;
  droppedOutAt: Date | null;
  statusUpdatedAt: Date;
  invoiceId: string | null;
}

async function loadRawPlans(clinicId: string, viewer: VisibilityViewer): Promise<RawPlan[]> {
  try {
    const plans = await prisma.orthodonticTreatmentPlan.findMany({
      where: { clinicId, deletedAt: null, AND: relatedPatientVisibilityAnd(viewer) },
      select: {
        ...BASE_SELECT,
        treatingDoctorId: true,
        treatingDoctor: { select: { firstName: true, lastName: true } },
        invoiceId: true,
      },
      take: 1000,
    });
    return plans.map((p) => ({
      id: p.id,
      patientId: p.patientId,
      patientName: `${p.patient.firstName} ${p.patient.lastName}`.trim(),
      treatingDoctorId: p.treatingDoctorId,
      treatingDoctorName: p.treatingDoctor
        ? `${p.treatingDoctor.firstName} ${p.treatingDoctor.lastName}`.trim()
        : null,
      status: p.status,
      installedAt: p.installedAt,
      estimatedDurationMonths: p.estimatedDurationMonths,
      droppedOutAt: p.droppedOutAt,
      statusUpdatedAt: p.statusUpdatedAt,
      invoiceId: p.invoiceId,
    }));
  } catch (e) {
    if (!esRelacionAusente(e)) throw e;
    const plans = await prisma.orthodonticTreatmentPlan.findMany({
      where: { clinicId, deletedAt: null, AND: relatedPatientVisibilityAnd(viewer) },
      select: BASE_SELECT,
      take: 1000,
    });
    return plans.map((p) => ({
      id: p.id,
      patientId: p.patientId,
      patientName: `${p.patient.firstName} ${p.patient.lastName}`.trim(),
      treatingDoctorId: null,
      treatingDoctorName: null,
      status: p.status,
      installedAt: p.installedAt,
      estimatedDurationMonths: p.estimatedDurationMonths,
      droppedOutAt: p.droppedOutAt,
      statusUpdatedAt: p.statusUpdatedAt,
      invoiceId: null,
    }));
  }
}

interface InvoiceForCobranza {
  id: string;
  total: number;
  payments: Array<{ amount: unknown; method?: string | null; paidAt: Date }>;
}

export interface OrthoCasesResult {
  cases: OrthoCaseSummary[];
  /** Para cálculos que sí necesitan la factura del caso (producción, T4) — no forma parte de OrthoCaseSummary porque las funciones puras no la necesitan. */
  invoiceIdByPlanId: Map<string, string>;
  invoicesById: Map<string, InvoiceForCobranza>;
}

/**
 * La base compartida: un caso por plan de tratamiento, con su resumen de
 * cobranza ya resuelto contra la factura real. La usan el Tablero, las
 * Alertas y Pacientes en tratamiento — así ninguna de las tres repite la
 * lectura de `orthodonticTreatmentPlan` con criterios ligeramente distintos.
 */
export async function loadOrthoCases(
  clinicId: string,
  zonaHoraria: string,
  viewer: VisibilityViewer,
  ahora: Date = new Date(),
): Promise<OrthoCasesResult> {
  const plans = await loadRawPlans(clinicId, viewer);
  const invoiceIds = Array.from(new Set(plans.map((p) => p.invoiceId).filter((x): x is string => !!x)));

  let invoicesById = new Map<string, InvoiceForCobranza>();
  let condicionesPorFactura = new Map<string, CondicionesPago>();
  if (invoiceIds.length > 0) {
    const [condicionesResult, invoices] = await Promise.all([
      leerCondicionesDeFacturas(prisma, { clinicId, invoiceIds }),
      prisma.invoice.findMany({
        where: { id: { in: invoiceIds }, clinicId },
        select: { id: true, total: true, payments: { select: { amount: true, method: true, paidAt: true } } },
      }),
    ]);
    condicionesPorFactura = condicionesResult.porFactura;
    invoicesById = new Map(invoices.map((i) => [i.id, i]));
  }

  const invoiceIdByPlanId = new Map<string, string>();
  const cases: OrthoCaseSummary[] = plans.map((p) => {
    if (p.invoiceId) invoiceIdByPlanId.set(p.id, p.invoiceId);
    const invoice = p.invoiceId ? invoicesById.get(p.invoiceId) : undefined;
    const cobranza =
      invoice != null
        ? cobranzaDelCaso({
            condiciones: condicionesPorFactura.get(p.invoiceId!) ?? null,
            totalFactura: invoice.total,
            cobros: invoice.payments,
            saldoAFavorPrevio: 0,
            ahora,
            zonaHoraria,
          })
        : null;
    return {
      planId: p.id,
      patientId: p.patientId,
      patientName: p.patientName,
      treatingDoctorId: p.treatingDoctorId,
      treatingDoctorName: p.treatingDoctorName,
      status: p.status,
      installedAt: p.installedAt,
      estimatedDurationMonths: p.estimatedDurationMonths,
      droppedOutAt: p.droppedOutAt,
      statusUpdatedAt: p.statusUpdatedAt,
      cobranza,
    };
  });

  return { cases, invoiceIdByPlanId, invoicesById };
}

export interface OrthoTableroData {
  /** T1 */
  activeCasesCount: number;
  /** T2 — citas "Control de ortodoncia" de hoy, en la zona de la clínica. */
  controlsToday: number;
  /** T3 */
  overdue: OverdueBalanceSummary;
  /** T4 — producción del mes, por doctor tratante. */
  productionByDoctor: ProductionByDoctor[];
  /** T5 */
  valoraciones: ValoracionesSummary;
  /** T6 — próximos 6 meses. */
  monthlyProjection: MonthlyProjectionBucket[];
  /** T7 */
  placementsAndRemovals: PlacementsAndRemovals;
}

export async function loadOrthoTableroData(
  clinicId: string,
  zonaHoraria: string,
  viewer: VisibilityViewer,
  ahora: Date = new Date(),
): Promise<OrthoTableroData> {
  const { cases, invoiceIdByPlanId, invoicesById } = await loadOrthoCases(clinicId, zonaHoraria, viewer, ahora);

  const diagnosisPatientIds = await prisma.orthodonticDiagnosis
    .findMany({
      where: { clinicId, deletedAt: null, AND: relatedPatientVisibilityAnd(viewer) },
      select: { patientId: true },
    })
    .then((rows) => Array.from(new Set(rows.map((r) => r.patientId))));

  const { startUtc: todayStart, endUtc: todayEnd } = calendarDayRangeUtc(hoyEnZona(ahora, zonaHoraria), zonaHoraria);

  const [controlsToday, quotes] = await Promise.all([
    prisma.appointment.count({
      where: {
        clinicId,
        type: TIPO_CITA_CONTROL_ORTO,
        startsAt: { gte: todayStart, lt: todayEnd },
        AND: relatedPatientVisibilityAnd(viewer),
      },
    }),
    diagnosisPatientIds.length > 0
      ? prisma.quote.findMany({
          where: { clinicId, patientId: { in: diagnosisPatientIds } },
          select: { status: true, acceptedAt: true, rejectedAt: true },
        })
      : Promise.resolve([]),
  ]);

  // Producción del mes: cada pago de la factura de un caso, atribuido al
  // doctor tratante de ESE caso (no hay Promise.all extra: reusa lo cargado
  // por loadOrthoCases).
  const doctorByPlanId = new Map(cases.map((c) => [c.planId, { id: c.treatingDoctorId, name: c.treatingDoctorName ?? "Sin doctor tratante" }]));
  const productionPayments: Array<{ doctorId: string | null; doctorName: string; amountMxn: number }> = [];
  for (const [planId, invoiceId] of invoiceIdByPlanId) {
    const invoice = invoicesById.get(invoiceId);
    const doctor = doctorByPlanId.get(planId);
    if (!invoice || !doctor) continue;
    for (const pay of invoice.payments) {
      if (!isSameCalendarMonthUtc(pay.paidAt, ahora)) continue;
      productionPayments.push({ doctorId: doctor.id, doctorName: doctor.name, amountMxn: Number(pay.amount) });
    }
  }

  return {
    activeCasesCount: computeActiveCasesCount(cases),
    controlsToday,
    overdue: computeOverdueBalances(cases),
    productionByDoctor: computeProductionByDoctor(productionPayments),
    valoraciones: computeValoracionesSummary(quotes),
    monthlyProjection: computeMonthlyProjection(cases, ahora, 6),
    placementsAndRemovals: computePlacementsAndRemovals(cases, ahora),
  };
}

export interface TodayControlEntry {
  appointmentId: string;
  patientId: string;
  patientName: string;
  startsAt: Date;
  treatmentPlanId: string | null;
  /** C3 (Control y agenda) — null = sin hoja de control todavía para esta cita. */
  indications: string | null;
}

/**
 * Los controles de HOY con las indicaciones (C3) que ya se cargaron en su
 * hoja, si la hay — para el botón "Enviar indicaciones" (ws1-t2, Paciente y
 * WhatsApp, W5). Lee `OrthoTreatmentCard.indications`, campo de "Control y
 * agenda" (ws1-t4): solo LEE, no lo edita.
 */
export async function loadTodayControlsWithIndications(
  clinicId: string,
  zonaHoraria: string,
  viewer: VisibilityViewer,
  ahora: Date = new Date(),
): Promise<TodayControlEntry[]> {
  const { startUtc: todayStart, endUtc: todayEnd } = calendarDayRangeUtc(hoyEnZona(ahora, zonaHoraria), zonaHoraria);

  const appointments = await prisma.appointment.findMany({
    where: {
      clinicId,
      type: TIPO_CITA_CONTROL_ORTO,
      startsAt: { gte: todayStart, lt: todayEnd },
      status: { not: "CANCELLED" },
      AND: relatedPatientVisibilityAnd(viewer),
    },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      patientId: true,
      startsAt: true,
      patient: { select: { firstName: true, lastName: true } },
    },
    take: 200,
  });
  if (appointments.length === 0) return [];

  const cards = await prisma.orthoTreatmentCard.findMany({
    where: { clinicId, appointmentId: { in: appointments.map((a) => a.id) } },
    select: { appointmentId: true, treatmentPlanId: true, indications: true },
  });
  const cardByAppointmentId = new Map(cards.map((c) => [c.appointmentId, c]));

  return appointments.map((a) => {
    const card = cardByAppointmentId.get(a.id);
    return {
      appointmentId: a.id,
      patientId: a.patientId,
      patientName: `${a.patient.firstName} ${a.patient.lastName}`.trim(),
      startsAt: a.startsAt,
      treatmentPlanId: card?.treatmentPlanId ?? null,
      indications: card?.indications ?? null,
    };
  });
}
