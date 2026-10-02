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
import { ORTHO_AUDIT_ACTIONS } from "@/app/actions/orthodontics/audit-actions";
import { cambiosDeEstadoDeBitacora, diasEnPausa } from "./dias-en-pausa";
import { cobranzaDelCasoUnificada } from "./cobranza-caso";
import { normalizarOrthoBillingMode } from "./billing-mode";
import { cargarModosDeCobro } from "./billing-mode-db";
import { cargarCargosDeControlPorCasos, vencimientoDeFacturaPrincipal } from "./cobranza-controles-db";
import { extrasPendientesPorCasos } from "./cobro/extras-db";
import { getPatientCreditBalances } from "@/lib/patient-credit";
import {
  computeActiveCasesCount,
  computeMonthlyProjection,
  computeOverdueBalances,
  computePlacementsAndRemovals,
  computeProjectionExcluded,
  type MonthlyProjectionBucket,
  type OrthoCaseSummary,
  type OverdueBalanceSummary,
  type PlacementsAndRemovals,
  type ProductionByDoctor,
  type ProjectionExcluded,
  type ValoracionesSummary,
} from "./specialty-kpis";
import { mesEnZona, produccionPorDoctor, rangoDelMes } from "./produccion";
import { cargarCambiosDeDoctor, cargarNombresDeDoctores, cargarPagosDeCasos } from "./produccion-db";
import { cargarValoracionesDelTablero } from "./valoraciones-tablero-db";
import { cargarProgresoDeControles, numerarCitasPorAtender } from "./controles-hechos-db";
import { inicioDelCaso } from "./controles-hechos";
import { cargarCasosIncompletos, type CasoIncompleto } from "./casos-incompletos-db";
import { casosConHojaDeHoyFirmadaSinCita } from "./hoja-firmada-de-la-cita-db";

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
  /** Ola 2 (ws1-t1) — sql/ortodoncia-modo-cobro.sql, EN SU PROPIA sonda (no
   * comparte la de treatingDoctorId/invoiceId): puede llegar aplicado antes o
   * después que esas, y no queremos perder doctor/factura por su culpa. */
  billingMode: string | null;
}

async function loadRawPlans(clinicId: string, viewer: VisibilityViewer): Promise<RawPlan[]> {
  const conModo = async (plans: Omit<RawPlan, "billingMode">[]): Promise<RawPlan[]> => {
    const modos = await cargarModosDeCobro(clinicId, plans.map((p) => p.id));
    return plans.map((p) => ({ ...p, billingMode: modos.get(p.id) ?? null }));
  };
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
    return conModo(plans.map((p) => ({
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
    })));
  } catch (e) {
    if (!esRelacionAusente(e)) throw e;
    const plans = await prisma.orthodonticTreatmentPlan.findMany({
      where: { clinicId, deletedAt: null, AND: relatedPatientVisibilityAnd(viewer) },
      select: BASE_SELECT,
      take: 1000,
    });
    return conModo(plans.map((p) => ({
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
    })));
  }
}

interface InvoiceForCobranza {
  id: string;
  total: number;
  status?: string;
  dueDate?: Date | null;
  createdAt?: Date | null;
  /** `Invoice.paid`: lo pagado, igual que Facturación (incluye lo migrado sin filas en `payments`). */
  paid?: number;
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
  const planIdsPorControl = plans
    .filter((p) => normalizarOrthoBillingMode(p.billingMode) === "PAGO_POR_CONTROL")
    .map((p) => p.id);

  let invoicesById = new Map<string, InvoiceForCobranza>();
  let condicionesPorFactura = new Map<string, CondicionesPago>();
  if (invoiceIds.length > 0) {
    const [condicionesResult, invoices] = await Promise.all([
      leerCondicionesDeFacturas(prisma, { clinicId, invoiceIds }),
      prisma.invoice.findMany({
        where: { id: { in: invoiceIds }, clinicId },
        select: { id: true, total: true, paid: true, status: true, dueDate: true, createdAt: true, payments: { select: { amount: true, method: true, paidAt: true } } },
      }),
    ]);
    condicionesPorFactura = condicionesResult.porFactura;
    invoicesById = new Map(invoices.map((i) => [i.id, i]));
  }
  const cargosControlPorPlan = await cargarCargosDeControlPorCasos(clinicId, planIdsPorControl);
  const pausaPorPlan = await cargarDiasEnPausaPorCaso(clinicId, plans.map((p) => p.id), ahora, plans);
  // #80 / #72: extras que se deben y responsable de pago, una consulta cada uno
  // para todos los casos; si alguna falla, la pantalla sale como antes.
  // ws1-t4: el saldo a favor de cada paciente, una consulta para todos (nunca lanza).
  const [extrasPorPlan, responsablePorPlan, saldoPorPaciente] = await Promise.all([
    extrasPendientesPorCasos(clinicId, plans.map((p) => p.id)),
    cargarResponsablesDeCasos(clinicId, plans.map((p) => p.id)),
    getPatientCreditBalances(clinicId, plans.map((p) => p.patientId)),
  ]);

  const invoiceIdByPlanId = new Map<string, string>();
  const cases: OrthoCaseSummary[] = plans.map((p) => {
    if (p.invoiceId) invoiceIdByPlanId.set(p.id, p.invoiceId);
    const invoice = p.invoiceId ? invoicesById.get(p.invoiceId) : undefined;
    // Una factura CANCELADA no es deuda del caso (mismo criterio que la ficha y
    // `cobranza-db.ts`): sin esto Tablero, Cobranza y Alertas seguían marcando
    // vencido lo que ya se canceló para reabrir el plan.
    const cobranza = cobranzaDelCasoUnificada({
      modo: p.billingMode,
      facturaPrincipal: invoice != null && invoice.status !== "CANCELLED"
        ? {
            condiciones: condicionesPorFactura.get(p.invoiceId!) ?? null,
            totalFactura: invoice.total,
            cobros: invoice.payments,
            pagado: invoice.paid,
            invoiceId: invoice.id,
            vencimiento: vencimientoDeFacturaPrincipal(p.billingMode, invoice.dueDate ?? null, invoice.createdAt ?? null, zonaHoraria),
          }
        : null,
      cargosControl: cargosControlPorPlan.get(p.id) ?? [],
      // ws1-t4: el del libro del paciente, igual que la ficha y su resumen.
      saldoAFavorPrevio: saldoPorPaciente.get(p.patientId) ?? 0,
      ahora,
      zonaHoraria,
    });
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
      diasEnPausa: pausaPorPlan.get(p.id) ?? 0,
      extrasPendientes: extrasPorPlan.get(p.id),
      responsableNombre: responsablePorPlan.get(p.id) ?? null,
      saldoAFavorPaciente: saldoPorPaciente.get(p.patientId) ?? 0,
      cobranza,
    };
  });

  return { cases, invoiceIdByPlanId, invoicesById };
}

/** #72: el responsable de pago de cada caso (una consulta). Nunca lanza: sin dato, nadie. */
async function cargarResponsablesDeCasos(clinicId: string, planIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!clinicId || planIds.length === 0) return out;
  try {
    const filas = await prisma.orthodonticTreatmentPlan.findMany({
      where: { clinicId, id: { in: planIds }, responsibleGuardianId: { not: null } },
      select: { id: true, responsibleGuardian: { select: { fullName: true } } },
    });
    for (const f of filas) if (f.responsibleGuardian?.fullName) out.set(f.id, f.responsibleGuardian.fullName);
  } catch (e) {
    if (!esRelacionAusente(e)) console.warn("[ortho] no se pudo leer el responsable de pago:", e);
  }
  return out;
}

/**
 * H45: días en pausa de cada caso, leídos de la bitácora (una consulta para
 * todos). Nunca lanza: sin bitácora o con la base caída, 0 días (lo de antes).
 */
async function cargarDiasEnPausaPorCaso(
  clinicId: string,
  planIds: string[],
  ahora: Date,
  plans: Array<{ id: string; status: string }>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (planIds.length === 0) return out;
  try {
    const filas = await prisma.auditLog.findMany({
      where: {
        clinicId,
        entityType: "OrthodonticTreatmentPlan",
        entityId: { in: planIds },
        action: ORTHO_AUDIT_ACTIONS.TREATMENT_PLAN_STATUS_CHANGED,
      },
      select: { entityId: true, createdAt: true, changes: true },
      take: 5000,
    });
    const porPlan = new Map<string, Array<{ createdAt: Date; changes: unknown }>>();
    for (const f of filas) {
      const l = porPlan.get(f.entityId) ?? [];
      l.push({ createdAt: f.createdAt, changes: f.changes });
      porPlan.set(f.entityId, l);
    }
    for (const p of plans) {
      const l = porPlan.get(p.id);
      if (l) out.set(p.id, diasEnPausa(cambiosDeEstadoDeBitacora(l), p.status, ahora));
    }
  } catch (e) {
    console.error("[ortho] no se pudo leer la bitácora de pausas:", e);
  }
  return out;
}

export interface OrthoTableroData {
  /** T1 */
  activeCasesCount: number;
  /** T2 — citas "Control de ortodoncia" de hoy, en la zona de la clínica. */
  controlsToday: number;
  /** T3 */
  overdue: OverdueBalanceSummary;
  /** T4 — producción del mes: cobros menos reembolsos, por el doctor que llevaba el caso el día del pago (fila 88). */
  productionByDoctor: ProductionByDoctor[];
  /**
   * T5 — citas de valoración de los últimos 90 días y cuántas abrieron caso
   * (`valoraciones-tablero.ts`). `agendadas` y `dias` son opcionales para no
   * romper a quien arma este objeto a mano con la forma anterior.
   */
  valoraciones: ValoracionesSummary & { agendadas?: number; dias?: number };
  /** T6 — próximos 6 meses. Solo casos en curso. */
  monthlyProjection: MonthlyProjectionBucket[];
  /** T6 — lo que la proyección dejó fuera: casos en pausa o abandonados (fila 91). Opcional para no romper a quien arma este objeto a mano. */
  projectionExcluded?: ProjectionExcluded;
  /** T7 */
  placementsAndRemovals: PlacementsAndRemovals;
  /** ws1-t12 — casos activos con el diagnóstico o el plan incompletos (cuenta y lista, con acceso directo al paso que falta). Opcional para no romper a quien arma este objeto a mano. */
  incompletos?: CasoIncompleto[];
}

export async function loadOrthoTableroData(
  clinicId: string,
  zonaHoraria: string,
  viewer: VisibilityViewer,
  ahora: Date = new Date(),
): Promise<OrthoTableroData> {
  const { cases, invoiceIdByPlanId } = await loadOrthoCases(clinicId, zonaHoraria, viewer, ahora);

  const { startUtc: todayStart, endUtc: todayEnd } = calendarDayRangeUtc(hoyEnZona(ahora, zonaHoraria), zonaHoraria);

  // Valoraciones (fila 16 de la revisión de lógica de uso): antes se contaban
  // presupuestos de cualquier procedimiento y fecha; ahora, citas de
  // valoración de ortodoncia. Ver valoraciones-tablero.ts.
  const [controlsToday, valoraciones] = await Promise.all([
    prisma.appointment.count({
      where: {
        clinicId,
        type: TIPO_CITA_CONTROL_ORTO,
        startsAt: { gte: todayStart, lt: todayEnd },
        // Sin las canceladas: el mismo criterio que la lista de al lado
        // (`loadTodayControlsWithIndications`) y que la pantalla Controles.
        // Antes el indicador decía 3 y la lista enseñaba 2.
        status: { not: "CANCELLED" },
        AND: relatedPatientVisibilityAnd(viewer),
      },
    }),
    cargarValoracionesDelTablero(clinicId, viewer, ahora),
  ]);

  // Producción del mes (fila 88): cada cobro de una factura del caso, MENOS
  // los reembolsos, atribuido a quien llevaba el caso el día del pago (no a
  // quien lo lleva hoy) y contado en el mes de la CLÍNICA. Entran también los
  // controles cobrados y los extras, no solo la factura del tratamiento. Tres
  // lecturas en fila (produccion-db.ts).
  const mes = mesEnZona(ahora, zonaHoraria);
  const rango = rangoDelMes(mes, zonaHoraria);
  const casosParaProduccion = cases.map((c) => ({
    planId: c.planId,
    invoiceId: invoiceIdByPlanId.get(c.planId) ?? null,
    treatingDoctorId: c.treatingDoctorId,
  }));
  const pagosDelMes = await cargarPagosDeCasos(clinicId, casosParaProduccion, rango);
  const cambiosDeDoctor = pagosDelMes.length > 0
    ? await cargarCambiosDeDoctor(clinicId, Array.from(new Set(pagosDelMes.map((p) => p.planId))), rango.desde)
    : [];
  const nombres = new Map<string, string>();
  for (const c of cases) if (c.treatingDoctorId && c.treatingDoctorName) nombres.set(c.treatingDoctorId, c.treatingDoctorName);
  const sinNombre = cambiosDeDoctor.flatMap((c) => [c.de, c.a]).filter((id): id is string => !!id && !nombres.has(id));
  if (sinNombre.length > 0) {
    for (const [id, nombre] of await cargarNombresDeDoctores(clinicId, sinNombre)) nombres.set(id, nombre);
  }
  const productionByDoctor = produccionPorDoctor({
    pagos: pagosDelMes,
    doctorActualPorCaso: new Map(cases.map((c) => [c.planId, c.treatingDoctorId])),
    cambios: cambiosDeDoctor,
    nombres,
    mes,
    zonaHoraria,
  });

  // ws1-t12: una lectura más para todos los casos; nunca lanza.
  const incompletos = await cargarCasosIncompletos(clinicId, cases);

  return {
    incompletos,
    activeCasesCount: computeActiveCasesCount(cases),
    controlsToday,
    overdue: computeOverdueBalances(cases),
    productionByDoctor,
    valoraciones,
    monthlyProjection: computeMonthlyProjection(cases, ahora, 6),
    projectionExcluded: computeProjectionExcluded(cases, ahora, 6),
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
  /**
   * M3 (ws1-t8, Ronda 6, «El día de la ortodoncista»): ¿esta cita YA tiene
   * hoja de control? Antes `treatmentPlanId` solo se resolvía a través de
   * una hoja EXISTENTE (`card?.treatmentPlanId`) — para las citas de HOY que
   * todavía no tienen hoja (el caso más común: es la razón de que estén en
   * esta lista) eso dejaba `treatmentPlanId: null` y ningún botón podía
   * abrir "Registrar control" desde aquí. Ahora se resuelve siempre desde
   * el caso activo del paciente. Opcional para no romper fixtures/vistas
   * previas que ya armaban este DTO a mano antes de este campo.
   */
  hasCard?: boolean;
  /**
   * Revisión final de ws1-t9 (fallo nuevo 4): sin hoja ligada, pero el caso ya tiene la hoja de HOY firmada «sin
   * cita» (al abrirla desde la cita se liga). El botón dice «Ver control», no «Registrar control».
   */
  hojaFirmadaSinCita?: boolean;
  /** ws1-t12 — «Control 6 de 18», del plan de tratamiento del caso. Solo si el plan dice cuántos controles prevé. */
  progreso?: { numero: number; previstos: number };
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
      status: true,
      patient: { select: { firstName: true, lastName: true } },
    },
    take: 200,
  });
  if (appointments.length === 0) return [];

  // M3: menos de 7 consultas por Promise.all (regla del pooler) — dos aquí.
  const [cards, plans] = await Promise.all([
    prisma.orthoTreatmentCard.findMany({
      where: { clinicId, appointmentId: { in: appointments.map((a) => a.id) } },
      select: { appointmentId: true, treatmentPlanId: true, indications: true },
    }),
    prisma.orthodonticTreatmentPlan.findMany({
      where: {
        clinicId,
        deletedAt: null,
        patientId: { in: appointments.map((a) => a.patientId) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, patientId: true, installedAt: true, startDate: true, createdAt: true },
    }),
  ]);
  const cardByAppointmentId = new Map(cards.map((c) => [c.appointmentId, c]));
  // Un paciente puede tener más de un plan histórico (caso previo cerrado);
  // se toma el más reciente — mismo criterio que getTreatmentPlanIdForAppointment.ts.
  const planIdByPatientId = new Map<string, string>();
  const planByPatientId = new Map<string, (typeof plans)[number]>();
  for (const p of plans) {
    if (!planIdByPatientId.has(p.patientId)) {
      planIdByPatientId.set(p.patientId, p.id);
      planByPatientId.set(p.patientId, p);
    }
  }

  // ws1-t12 — «Control X de N»: una consulta más para todos, y solo de los casos cuyo plan prevé controles.
  const progresoPorCaso = await cargarProgresoDeControles(
    clinicId,
    zonaHoraria,
    Array.from(planByPatientId.values()).map((p) => ({ planId: p.id, patientId: p.patientId, inicio: inicioDelCaso(p) })),
    ahora,
  );
  const progresoPorPaciente = new Map<string, { hechos: number; previstos: number }>();
  for (const [patientId, p] of planByPatientId) {
    const pr = progresoPorCaso.get(p.id);
    if (pr) progresoPorPaciente.set(patientId, pr);
  }
  const numeros = numerarCitasPorAtender(appointments, progresoPorPaciente, (a) => cardByAppointmentId.has(a.id));
  // Fallo nuevo 4: los casos con la hoja de hoy firmada «sin cita» (una consulta, solo si hay citas sin hoja).
  const sinHoja = appointments.filter((a) => !cardByAppointmentId.has(a.id));
  const firmadasSinCita = await casosConHojaDeHoyFirmadaSinCita(
    clinicId,
    sinHoja.map((a) => planIdByPatientId.get(a.patientId)).filter((id): id is string => !!id),
    zonaHoraria,
    ahora,
  );

  return appointments.map((a) => {
    const card = cardByAppointmentId.get(a.id);
    return {
      appointmentId: a.id,
      patientId: a.patientId,
      patientName: `${a.patient.firstName} ${a.patient.lastName}`.trim(),
      startsAt: a.startsAt,
      treatmentPlanId: card?.treatmentPlanId ?? planIdByPatientId.get(a.patientId) ?? null,
      indications: card?.indications ?? null,
      hasCard: Boolean(card),
      hojaFirmadaSinCita: !card && firmadasSinCita.has(planIdByPatientId.get(a.patientId) ?? ""),
      ...(numeros.has(a) ? { progreso: numeros.get(a)! } : {}),
    };
  });
}
