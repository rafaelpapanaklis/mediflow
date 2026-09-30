// Orthodontics — pure helpers para los KPIs de la página agregada.
// Aislado de load-patients.ts (que importa prisma en runtime) para que los
// tests puedan ejecutarse sin DATABASE_URL.

import type { OrthoTreatmentStatus } from "@prisma/client";
import type {
  OrthoPatientRow,
  OrthoSpecialtyKpis,
} from "./load-patients";

export const ACTIVE_PLAN_STATUSES: OrthoTreatmentStatus[] = [
  "PLANNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "RETENTION",
];

/**
 * H43: «Falta de control» solo aplica a casos en tratamiento activo. Uno en
 * retención se revisa a 3/6/12 meses (su cita es «Control de retención», no
 * la mensual), uno en pausa no viene a propósito y uno planeado aún no tiene
 * aparatología colocada.
 */
export const ESTADOS_CON_CONTROL_MENSUAL: OrthoTreatmentStatus[] = ["IN_PROGRESS"];

/**
 * Deriva los KPIs spec a partir de las filas y el conteo separado de
 * citas de hoy. Pure — apto para tests con datos mock.
 */
export function computeOrthoKpis(
  rows: OrthoPatientRow[],
  todayAppointments: number,
): OrthoSpecialtyKpis {
  const activeTreatments = rows.filter(
    (r) =>
      r.treatmentPlanId !== null &&
      ACTIVE_PLAN_STATUSES.includes(r.status as OrthoTreatmentStatus),
  ).length;

  const overdueRows = rows.filter(
    (r) => r.paymentStatus === "LIGHT_DELAY" || r.paymentStatus === "SEVERE_DELAY",
  );
  const overduePaymentsCount = overdueRows.length;
  const overduePaymentsAmountMxn = overdueRows.reduce((s, r) => s + r.amountOverdueMxn, 0);

  const finishingSoon = rows.filter((r) => {
    if (r.estimatedDurationMonths === null || r.monthInTreatment === null) return false;
    const remaining = r.estimatedDurationMonths - r.monthInTreatment;
    return remaining >= 0 && remaining <= 1 && r.status === "IN_PROGRESS";
  }).length;

  return {
    activeTreatments,
    todayAppointments,
    overduePaymentsCount,
    overduePaymentsAmountMxn,
    finishingSoon,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tablero y alertas (Ola 1, ws1-t2) — T1-T7 y L1-L5, alcance-ortodoncia.html.
//
// Decisión 1 de la arquitectura (REPORTE-ws1-t8.md): el dinero vive en la
// factura a plazos del tratamiento, NUNCA en OrthoPaymentPlan/OrthoInstallment
// (esas tablas quedan ocultas — bloque S). Por eso estos KPIs NO usan
// `computeOrthoKpis` de arriba (que sí lee el modelo viejo, y sigue vivo solo
// para la vista antigua `/dashboard/specialties/orthodontics`, S1, todavía sin
// ocultar): reciben el resumen de `cobranzaDelCaso` (cobranza-caso.ts) ya
// calculado por el cargador (tablero-data.ts / alerts-data.ts), que lee la
// factura real. Puro: sin Prisma, sin `Date.now()` implícito.
//
// Decisión 2: los controles son citas de la Agenda (`TIPO_CITA_CONTROL_ORTO`),
// no `OrthodonticControlAppointment`. Estas funciones tampoco conocen ese
// modelo viejo — reciben citas ya filtradas por el cargador.
// ═══════════════════════════════════════════════════════════════════════════

import type { CobranzaDelCaso } from "./cobranza-caso";
import { differenceInMonths } from "date-fns";

/**
 * ¿Mismo mes calendario, en UTC? A propósito NO se usa `isSameMonth` de
 * date-fns (compara en la zona LOCAL del proceso): una `installedAt` guardada
 * a medianoche UTC cruza de mes al leerse en un servidor con offset negativo
 * — el mismo bug que ya tiene `load-patients.ts` con `startOfDay(now)` del
 * servidor (ver cabecero de cobranza-caso.ts). "Este mes" aquí es el mes de
 * `ahora` en UTC, consistente con `computeMonthlyProjection` (que ya bucketea
 * en UTC) — no es la zona de la clínica, pero tampoco depende del huso del
 * proceso.
 */
export function isSameCalendarMonthUtc(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

/** Un caso (plan de tratamiento) con su resumen de cobranza ya resuelto. */
export interface OrthoCaseSummary {
  planId: string;
  patientId: string;
  patientName: string;
  treatingDoctorId: string | null;
  treatingDoctorName: string | null;
  status: OrthoTreatmentStatus;
  installedAt: Date | null;
  estimatedDurationMonths: number | null;
  droppedOutAt: Date | null;
  statusUpdatedAt: Date;
  /** H45: días que el caso estuvo «En pausa» (de la bitácora). Sin dato = 0. */
  diasEnPausa?: number;
  /** #80: lo que el caso debe en extras (reposiciones, retenedores…), aparte de las mensualidades. Sin dato = nada. */
  extrasPendientes?: { monto: number; cantidad: number };
  /** #72: nombre del responsable de pago (tutor), si el caso lo tiene. */
  responsableNombre?: string | null;
  /**
   * ws1-t4 — saldo a favor del PACIENTE (su libro `patient_credits`), el mismo
   * número de su resumen. Opcional para no romper a quien arma este objeto a mano.
   */
  saldoAFavorPaciente?: number;
  /** `null` = sin factura de tratamiento, o sin condiciones cargadas: nada que cobrar todavía (T3/L1 lo ignoran, no lo cuentan como "al día"). */
  cobranza: CobranzaDelCaso | null;
}

/** T1 — casos con un plan en estado "en tratamiento" (excluye DIAGNOSIS_ONLY, COMPLETED, DROPPED_OUT). */
export function computeActiveCasesCount(cases: OrthoCaseSummary[]): number {
  return cases.filter((c) => ACTIVE_PLAN_STATUSES.includes(c.status)).length;
}

export interface OverdueBalanceSummary {
  /** Cuántos casos tienen al menos una cuota vencida sin saldar. */
  count: number;
  /** Suma de lo que falta por pagar de esas cuotas vencidas, en pesos. */
  amountMxn: number;
}

/** T3 / L1 — saldos vencidos, leídos de la factura del tratamiento (nunca de OrthoPaymentPlan). */
export function computeOverdueBalances(cases: OrthoCaseSummary[]): OverdueBalanceSummary {
  let count = 0;
  let amount = 0;
  for (const c of cases) {
    const vencidas = c.cobranza?.vencidas ?? [];
    if (vencidas.length === 0) continue;
    count++;
    amount += vencidas.reduce((s, q) => s + q.falta, 0);
  }
  return { count, amountMxn: Math.round(amount) };
}

export interface OverduePatientEntry {
  patientId: string;
  patientName: string;
  /** ws1-t2 (W2) — para poder pedir el recordatorio de mensualidad de ESTE caso. */
  treatmentPlanId: string;
  amountMxn: number;
  /** "YYYY-MM-DD" de la cuota vencida más vieja. */
  oldestDueDate: string | null;
}

/** L1 — lista "mensualidad vencida" para la pantalla de Alertas. */
export function listOverduePatients(cases: OrthoCaseSummary[]): OverduePatientEntry[] {
  const out: OverduePatientEntry[] = [];
  for (const c of cases) {
    const vencidas = c.cobranza?.vencidas ?? [];
    if (vencidas.length === 0) continue;
    const amountMxn = Math.round(vencidas.reduce((s, q) => s + q.falta, 0));
    const oldest = vencidas.reduce<string | null>((min, q) => {
      if (!q.vencimiento) return min;
      return min === null || q.vencimiento < min ? q.vencimiento : min;
    }, null);
    out.push({ patientId: c.patientId, patientName: c.patientName, treatmentPlanId: c.planId, amountMxn, oldestDueDate: oldest });
  }
  return out.sort((a, b) => b.amountMxn - a.amountMxn);
}

export interface DurationAlertEntry {
  patientId: string;
  patientName: string;
  monthInTreatment: number;
  estimatedDurationMonths: number;
  /** Negativo = ya pasó su fecha estimada. */
  remainingMonths: number;
}

/** L4 — "tratamiento próximo a terminar": IN_PROGRESS con 0 o 1 mes restante. */
export function listFinishingSoon(cases: OrthoCaseSummary[], ahora: Date): DurationAlertEntry[] {
  return durationAlertEntries(cases, ahora).filter(
    (e) => e.remainingMonths >= 0 && e.remainingMonths <= 1,
  );
}

/** L5 — "tratamiento pasado de su fecha": ya rebasó la duración estimada. */
export function listPastDue(cases: OrthoCaseSummary[], ahora: Date): DurationAlertEntry[] {
  return durationAlertEntries(cases, ahora).filter((e) => e.remainingMonths < 0);
}

function durationAlertEntries(cases: OrthoCaseSummary[], ahora: Date): DurationAlertEntry[] {
  return cases
    .filter((c) => c.status === "IN_PROGRESS" && c.installedAt !== null && c.estimatedDurationMonths !== null)
    .map((c) => {
      // H45: los meses en pausa no cuentan como tiempo de tratamiento.
      const mesesPausados = Math.floor((c.diasEnPausa ?? 0) / 30.44);
      const monthInTreatment = Math.max(0, differenceInMonths(ahora, c.installedAt!) - mesesPausados);
      const estimatedDurationMonths = c.estimatedDurationMonths!;
      return {
        patientId: c.patientId,
        patientName: c.patientName,
        monthInTreatment,
        estimatedDurationMonths,
        remainingMonths: estimatedDurationMonths - monthInTreatment,
      };
    });
}

export interface MonthlyProjectionBucket {
  /** "YYYY-MM". */
  monthKey: string;
  amountMxn: number;
}

/**
 * Casos cuyo dinero futuro NO se promete (fila 91 de la revisión de lógica de
 * uso): un caso en pausa no está viniendo a sus controles y uno abandonado ya
 * no vuelve. Sus cuotas siguen existiendo en la factura —la deuda no se borra,
 * y Cobranza las sigue enseñando—, pero contarlas en «lo que va a entrar» le
 * promete al dueño un dinero que no va a llegar.
 */
export const ESTADOS_FUERA_DE_LA_PROYECCION: OrthoTreatmentStatus[] = ["ON_HOLD", "DROPPED_OUT"];

function mesesDeLaProyeccion(ahora: Date, months: number): Map<string, number> {
  const buckets = new Map<string, number>();
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, 0);
  }
  return buckets;
}

/**
 * T6 — lo que va a entrar por mensualidades, sumando las cuotas "próximas" de
 * cada caso, por mes. Solo casos en curso: los que están en pausa o
 * abandonados quedan fuera (ver `computeProjectionExcluded`, que dice cuánto
 * se dejó de contar para que el número no cambie sin explicación).
 */
export function computeMonthlyProjection(
  cases: OrthoCaseSummary[],
  ahora: Date,
  months = 6,
): MonthlyProjectionBucket[] {
  const buckets = mesesDeLaProyeccion(ahora, months);
  for (const c of cases) {
    if (ESTADOS_FUERA_DE_LA_PROYECCION.includes(c.status)) continue;
    for (const q of c.cobranza?.proximas ?? []) {
      if (!q.vencimiento) continue;
      const key = q.vencimiento.slice(0, 7);
      if (buckets.has(key)) buckets.set(key, buckets.get(key)! + q.falta);
    }
  }
  return Array.from(buckets, ([monthKey, amountMxn]) => ({ monthKey, amountMxn: Math.round(amountMxn) }));
}

export interface ProjectionExcluded {
  /** Casos en pausa con cuotas dentro de la ventana de la proyección. */
  enPausa: number;
  /** Casos abandonados con cuotas dentro de la ventana de la proyección. */
  abandonados: number;
  /** Lo que suman esas cuotas, en pesos: lo que la proyección dejó de prometer. */
  amountMxn: number;
}

/** T6 — lo que la proyección NO cuenta (casos en pausa o abandonados), para decirlo al pie. */
export function computeProjectionExcluded(
  cases: OrthoCaseSummary[],
  ahora: Date,
  months = 6,
): ProjectionExcluded {
  const meses = mesesDeLaProyeccion(ahora, months);
  const out: ProjectionExcluded = { enPausa: 0, abandonados: 0, amountMxn: 0 };
  let importe = 0;
  for (const c of cases) {
    if (!ESTADOS_FUERA_DE_LA_PROYECCION.includes(c.status)) continue;
    let delCaso = 0;
    for (const q of c.cobranza?.proximas ?? []) {
      if (q.vencimiento && meses.has(q.vencimiento.slice(0, 7))) delCaso += q.falta;
    }
    if (delCaso <= 0) continue;
    importe += delCaso;
    if (c.status === "ON_HOLD") out.enPausa += 1;
    else out.abandonados += 1;
  }
  out.amountMxn = Math.round(importe);
  return out;
}

export interface PlacementsAndRemovals {
  /** Tratamientos que colocaron aparatología este mes (`installedAt`). */
  placements: number;
  /** Tratamientos que retiraron aparatología este mes (pasaron a RETENTION o COMPLETED). */
  removals: number;
}

/** T7 — colocaciones y retiros del mes. */
export function computePlacementsAndRemovals(cases: OrthoCaseSummary[], ahora: Date): PlacementsAndRemovals {
  const placements = cases.filter(
    (c) => c.installedAt !== null && isSameCalendarMonthUtc(c.installedAt, ahora),
  ).length;
  const removals = cases.filter(
    (c) =>
      (c.status === "RETENTION" || c.status === "COMPLETED") &&
      isSameCalendarMonthUtc(c.statusUpdatedAt, ahora),
  ).length;
  return { placements, removals };
}

export interface ProductionByDoctor {
  doctorId: string | null;
  doctorName: string;
  amountMxn: number;
}

/** T4 — producción del mes (cobrado en facturas ligadas a un caso), por doctor tratante. */
export function computeProductionByDoctor(
  payments: Array<{ doctorId: string | null; doctorName: string; amountMxn: number }>,
): ProductionByDoctor[] {
  const map = new Map<string, ProductionByDoctor>();
  for (const p of payments) {
    const key = p.doctorId ?? "__sin_doctor__";
    const existing = map.get(key) ?? { doctorId: p.doctorId, doctorName: p.doctorName, amountMxn: 0 };
    existing.amountMxn += p.amountMxn;
    map.set(key, existing);
  }
  return Array.from(map.values())
    .map((p) => ({ ...p, amountMxn: Math.round(p.amountMxn) }))
    .sort((a, b) => b.amountMxn - a.amountMxn);
}

export interface ValoracionesSummary {
  total: number;
  aceptadas: number;
  /** Presentadas, ni aceptadas ni rechazadas: para llamar. */
  pendientes: number;
}

/** T5 — de las valoraciones (presupuestos) de pacientes con caso de ortodoncia, cuántas convierten. */
export function computeValoracionesSummary(
  quotes: Array<{ status: string; acceptedAt: Date | null; rejectedAt: Date | null }>,
): ValoracionesSummary {
  const total = quotes.length;
  const aceptadas = quotes.filter((q) => q.status === "ACCEPTED" || q.acceptedAt !== null).length;
  const pendientes = quotes.filter(
    (q) => q.status === "PRESENTED" && q.acceptedAt === null && q.rejectedAt === null,
  ).length;
  return { total, aceptadas, pendientes };
}

export interface MissingNextControlEntry {
  patientId: string;
  patientName: string;
}

/** L2 — "falta de control": caso activo sin ninguna cita de control futura en la Agenda. */
export function listMissingNextControl(
  cases: OrthoCaseSummary[],
  patientIdsWithFutureControl: ReadonlySet<string>,
): MissingNextControlEntry[] {
  const seen = new Set<string>();
  const out: MissingNextControlEntry[] = [];
  for (const c of cases) {
    if (!ESTADOS_CON_CONTROL_MENSUAL.includes(c.status)) continue;
    if (patientIdsWithFutureControl.has(c.patientId)) continue;
    if (seen.has(c.patientId)) continue;
    seen.add(c.patientId);
    out.push({ patientId: c.patientId, patientName: c.patientName });
  }
  return out;
}
