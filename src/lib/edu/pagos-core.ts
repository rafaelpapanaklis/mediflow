/**
 * DaleControl INSTITUCIONAL — PAGOS A MESES, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only"). Aquí viven la
 * aritmética del plan de pagos y sus formas serializables; las consultas
 * están en pagos.ts y la emisión del cobro en caja.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * LAS TRES REGLAS DE UN PLAN DE PAGOS
 *
 * 1. 🔴 LOS CENTAVOS NO SE PIERDEN NI SE INVENTAN. Si el saldo no divide
 *    exacto entre N mensualidades, la DIFERENCIA ENTERA va en la PRIMERA,
 *    no repartida en decimales: $1,000.00 entre 3 son $333.34 + $333.33 +
 *    $333.33, y la suma da EXACTAMENTE el saldo. Un plan cuyas
 *    mensualidades no suman su saldo es una caja que no cuadra por unos
 *    centavos que nadie encuentra.
 *
 * 2. 🔴 VENCIDA NO SE GUARDA: SE CALCULA. Una mensualidad sin pagar y con
 *    la fecha pasada está vencida por el CALENDARIO, no porque un cron
 *    corriera anoche. Un estado "VENCIDA" escrito en una columna necesita
 *    que algo lo escriba — y el día que ese algo falle, toda la cartera
 *    diría "al corriente" siendo mentira. Por eso en la base solo existen
 *    los HECHOS (el pago que la liquidó, su fecha de vencimiento) y el
 *    estado sale de eduInstallmentStatus en cada lectura.
 *
 * 3. 🔴 NADIE TECLEA MONTOS DE MENSUALIDAD. El monto de cada una se fija
 *    al crear el plan (con la regla 1) y pagar una registra EXACTAMENTE
 *    ese monto. El saldo del cobro se sigue derivando de los pagos reales,
 *    como en toda la Ola 5.
 * ═══════════════════════════════════════════════════════════════════════
 */
import {
  EDU_PAYMENT_PLAN_STATUSES,
  type EduInstallmentStatus,
  type EduPaymentMethod,
  type EduPaymentPlanStatus,
} from "@/lib/edu/types";

// ═══════════════════════════════════════════════════════════════════════
// 1 · TOPES
// ═══════════════════════════════════════════════════════════════════════

/** Menos de 2 no es "a meses": es un cobro normal con otro nombre. */
export const EDU_PLAN_MIN_MONTHS = 2;

/**
 * 48 mensualidades = 4 años. Más que eso ya no es un tratamiento de
 * varias sesiones, es un crédito — y este producto no otorga créditos.
 */
export const EDU_PLAN_MAX_MONTHS = 48;

// ═══════════════════════════════════════════════════════════════════════
// 2 · LA ARITMÉTICA DEL PLAN
// ═══════════════════════════════════════════════════════════════════════

/**
 * 🔴 EL REPARTO DE LOS CENTAVOS. Parte `remainingCents` en `months`
 * mensualidades ENTERAS cuya suma es EXACTAMENTE `remainingCents`.
 *
 * La base es el piso de la división y el residuo va COMPLETO en la
 * PRIMERA mensualidad. En la primera y no en la última a propósito: la
 * primera es la que se cobra más cerca de hoy, así que la diferencia se
 * paga cuando el paciente todavía tiene el plan fresco — y si algún día
 * se cancela a la mitad, lo ya cobrado nunca fue "de más".
 *
 * `null` = no se puede: months fuera de rango, o el saldo no alcanza ni
 * un centavo por mensualidad.
 */
export function eduPlanSplitCents(remainingCents: number, months: number): number[] | null {
  if (!Number.isInteger(remainingCents) || !Number.isInteger(months)) return null;
  if (months < EDU_PLAN_MIN_MONTHS || months > EDU_PLAN_MAX_MONTHS) return null;
  if (remainingCents < months) return null;

  const base = Math.floor(remainingCents / months);
  const residuo = remainingCents - base * months;
  const montos = new Array<number>(months).fill(base);
  montos[0] = base + residuo;
  return montos;
}

/** Cuántos días trae un mes (month es 1-12). Puro: aritmética de calendario. */
function diasDelMes(year: number, month: number): number {
  // El día 0 del mes siguiente es el último de éste. En UTC para que la
  // zona de la máquina no opine sobre un calendario.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * LAS FECHAS DE VENCIMIENTO, como fechas de calendario "AAAA-MM-DD".
 *
 * La mensualidad n (1-based) vence el DÍA DE CORTE del mes `startISO + n`:
 * un plan creado el 31 de agosto con corte el 15 vence el 15 de
 * septiembre, el 15 de octubre… La primera SIEMPRE es del mes siguiente —
 * cobrar la primera mensualidad a tres días de crear el plan no es un
 * plan, es un enganche disfrazado (y el enganche ya existe aparte).
 *
 * 🔴 El día de corte se RECORTA al mes que lo aguante: corte el 31 en
 * febrero vence el 28 (o el 29 si el año bisiesto alcanza), y en marzo
 * vuelve a ser el 31. Correr la fecha al mes siguiente haría que dos
 * mensualidades cayeran en el mismo mes.
 *
 * `null` = entrada inválida.
 */
export function eduPlanDueDates(
  startISO: string,
  dueDay: number,
  months: number,
): string[] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startISO ?? "");
  if (!m) return null;
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return null;
  if (!Number.isInteger(months) || months < 1 || months > EDU_PLAN_MAX_MONTHS) return null;

  const y0 = Number(m[1]);
  const m0 = Number(m[2]); // 1-12
  const d0 = Number(m[3]);
  // "2026-13-01" pasa el regex pero no es una fecha: sin esta línea, la
  // aritmética de abajo lo NORMALIZARÍA en silencio (mes 13 → enero del
  // año siguiente) y el plan entero nacería corrido un mes.
  if (m0 < 1 || m0 > 12) return null;
  if (d0 < 1 || d0 > diasDelMes(y0, m0)) return null;
  const out: string[] = [];
  for (let n = 1; n <= months; n++) {
    const total = m0 - 1 + n;
    const year = y0 + Math.floor(total / 12);
    const month = (total % 12) + 1;
    const day = Math.min(dueDay, diasDelMes(year, month));
    out.push(
      `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
  }
  return out;
}

/**
 * "AAAA-MM-DD" + n días → "AAAA-MM-DD". Aritmética de calendario en UTC
 * (un día de calendario no tiene zona), para la ventana de "vence esta
 * semana": [hoy, hoy+7). `null` = entrada inválida.
 */
export function eduPlanAddDaysISO(dayISO: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayISO ?? "")) return null;
  if (!Number.isInteger(days)) return null;
  const t = Date.parse(`${dayISO}T00:00:00.000Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 🔴 EL ESTADO DE UNA MENSUALIDAD SE DERIVA, NUNCA SE GUARDA.
 *
 * PAGADA = tiene el pago que la liquidó (un hecho con fila propia).
 * VENCIDA = sin pagar y con la fecha ESTRICTAMENTE pasada. El día del
 * vencimiento todavía NO está vencida: "vence hoy" es hoy, y marcarla
 * vencida por la mañana sería adelantarse un día entero — el mismo
 * criterio que el contrato del instituto (edu-contract.test.ts).
 *
 * `todayISO` llega calculado en la zona del INSTITUTO (eduTodayISO), no
 * la del navegador ni la del servidor: a las 23:30 de México, un UTC ya
 * va en mañana y marcaría vencido lo que aún no vence.
 *
 * Las dos fechas son "AAAA-MM-DD", que comparan bien como texto.
 */
export function eduInstallmentStatus(
  inst: { paidAt: string | Date | null; dueDateISO: string },
  todayISO: string,
): EduInstallmentStatus {
  if (inst.paidAt) return "PAGADA";
  return inst.dueDateISO < todayISO ? "VENCIDA" : "PENDIENTE";
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · PARSEO DE LO QUE VIENE DEL CLIENTE
// ═══════════════════════════════════════════════════════════════════════

export interface EduPlanRequest {
  months: number;
  /** null = usar el día del mes de HOY (lo rellena el servidor). */
  dueDay: number | null;
}

export type EduPlanRequestResult = { ok: true; plan: EduPlanRequest } | EduPlanRequestFailure;
export type EduPlanRequestFailure = { ok: false; error: string };

/**
 * 🔴 La guarda viaja JUNTO a la unión, en el mismo commit: el tsconfig
 * del repo corre con strict:false y ahí TypeScript NO estrecha una unión
 * por su discriminante booleano — `if (!r.ok) r.error` revienta en el
 * build con TS2339. El predicado estrecha con strict en true y en false.
 */
export function eduPlanRequestFailed(r: EduPlanRequestResult): r is EduPlanRequestFailure {
  return r.ok === false;
}

/**
 * Lee la petición de "pagar a meses". Devuelve el error ESCRITO para una
 * persona en vez de lanzar: este módulo es puro y quien llama (caja.ts,
 * pagos.ts) decide el status HTTP.
 */
export function parseEduPlanRequest(raw: unknown): EduPlanRequestResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "La petición de pago a meses no es válida." };
  }
  const r = raw as Record<string, unknown>;

  const months = enteroDe(r.months);
  if (months === null || months < EDU_PLAN_MIN_MONTHS || months > EDU_PLAN_MAX_MONTHS) {
    return {
      ok: false,
      error: `Elige entre ${EDU_PLAN_MIN_MONTHS} y ${EDU_PLAN_MAX_MONTHS} mensualidades.`,
    };
  }

  let dueDay: number | null = null;
  if (r.dueDay !== undefined && r.dueDay !== null && r.dueDay !== "") {
    dueDay = enteroDe(r.dueDay);
    if (dueDay === null || dueDay < 1 || dueDay > 31) {
      return { ok: false, error: "El día de corte tiene que ser un día del mes (1 a 31)." };
    }
  }

  return { ok: true, plan: { months, dueDay } };
}

function enteroDe(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

export function parseEduPaymentPlanStatus(raw: unknown): EduPaymentPlanStatus | null {
  if (typeof raw !== "string") return null;
  return (EDU_PAYMENT_PLAN_STATUSES as string[]).includes(raw)
    ? (raw as EduPaymentPlanStatus)
    : null;
}

export interface EduPlanFilters {
  /** null = todos los estados. */
  status: EduPaymentPlanStatus | null;
  q: string | null;
}

/**
 * Los filtros de /instituto/caja/planes. El DEFAULT es ACTIVO: lo que caja
 * abre a diario es la cartera viva, no el archivo. "todos" lo pide una
 * persona con el selector; lo que no se reconoce cae al default (mismo
 * criterio que el `ver` de los cobros).
 *
 * 🔴 Aquí NO se lee ningún institutionId. El tenant sale de la sesión.
 */
export function parseEduPlanFilters(
  searchParams: Record<string, string | string[] | undefined> | undefined | null,
): EduPlanFilters {
  const sp = searchParams ?? {};
  const primero = (v: string | string[] | undefined): string | null =>
    Array.isArray(v) ? (v.length > 0 ? String(v[0]) : null) : typeof v === "string" ? v : null;

  const estado = primero(sp.estado);
  const q = primero(sp.q);
  return {
    status: estado === "todos" ? null : (parseEduPaymentPlanStatus(estado) ?? "ACTIVO"),
    q: q && q.trim() ? q.trim().slice(0, 60) : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LAS FORMAS QUE VIAJAN A LA PANTALLA
//
// Todo serializable: fechas en ISO, dinero en centavos. El estado de cada
// mensualidad viaja YA derivado (con el hoy del instituto del momento de
// la lectura): la pantalla pinta, no decide.
// ═══════════════════════════════════════════════════════════════════════

export interface EduInstallmentRow {
  id: string;
  number: number;
  amountCents: number;
  /** "AAAA-MM-DD". */
  dueDateISO: string;
  /** Derivado en la lectura con eduInstallmentStatus. */
  status: EduInstallmentStatus;
  paidAt: string | null;
  /** Cómo se pagó y quién lo recibió, cuando está pagada. */
  method: EduPaymentMethod | null;
  receivedByName: string | null;
}

export interface EduPlanRow {
  id: string;
  status: EduPaymentPlanStatus;
  chargeId: string;
  chargeFolio: string;
  patientId: string;
  patientName: string;
  patientFolio: string;
  months: number;
  /** La mensualidad "pareja"; la PRIMERA puede traer los centavos de más. */
  installmentCents: number;
  /** Lo pagado del cobro al CREAR el plan (el enganche, si lo hubo). */
  downPaymentCents: number;
  dueDay: number;
  /** Total del cobro, para el recibo. */
  chargeTotalCents: number;
  /** Suma de las mensualidades = lo que se difirió. */
  planCents: number;
  paidCount: number;
  /** Suma de las mensualidades sin pagar. */
  pendingCents: number;
  overdueCount: number;
  overdueCents: number;
  /** La siguiente sin pagar, o null si no queda ninguna. */
  nextDueISO: string | null;
  createdByName: string;
  createdAt: string;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
  settledAt: string | null;
  installments: EduInstallmentRow[];
}

export interface EduPlanesPage {
  rows: EduPlanRow[];
  truncated: boolean;
  /** El "hoy" del instituto con el que se derivaron los estados. */
  todayISO: string;
}

/**
 * Los números derivados de un plan a partir de sus mensualidades YA
 * clasificadas. Puro para que el resumen del recibo, el de caja y el de
 * la ficha no puedan discrepar.
 */
export function eduPlanResumen(installments: EduInstallmentRow[]): {
  planCents: number;
  paidCount: number;
  pendingCents: number;
  overdueCount: number;
  overdueCents: number;
  nextDueISO: string | null;
} {
  let planCents = 0;
  let paidCount = 0;
  let pendingCents = 0;
  let overdueCount = 0;
  let overdueCents = 0;
  let nextDueISO: string | null = null;
  for (const i of installments) {
    planCents += i.amountCents;
    if (i.status === "PAGADA") {
      paidCount += 1;
      continue;
    }
    pendingCents += i.amountCents;
    if (i.status === "VENCIDA") {
      overdueCount += 1;
      overdueCents += i.amountCents;
    }
    if (nextDueISO === null || i.dueDateISO < nextDueISO) nextDueISO = i.dueDateISO;
  }
  return { planCents, paidCount, pendingCents, overdueCount, overdueCents, nextDueISO };
}

/** Una mensualidad con su plan al lado, para las listas de "vencen". */
export interface EduInstallmentConPlan {
  plan: EduPlanRow;
  installment: EduInstallmentRow;
}

/**
 * Las mensualidades SIN PAGAR de planes ACTIVOS que vencen dentro de
 * [fromISO, toISO). Extremo derecho EXCLUSIVO, como todos los rangos de
 * fechas del vertical. Ordenadas por fecha: la más urgente primero.
 *
 * Solo de planes ACTIVOS: una mensualidad de un plan cancelado no se le
 * debe a nadie, y una de un plan liquidado no existe sin pagar.
 */
export function eduInstallmentsDueBetween(
  plans: EduPlanRow[],
  fromISO: string,
  toISO: string,
): EduInstallmentConPlan[] {
  const out: EduInstallmentConPlan[] = [];
  for (const plan of plans) {
    if (plan.status !== "ACTIVO") continue;
    for (const installment of plan.installments) {
      if (installment.status === "PAGADA") continue;
      if (installment.dueDateISO >= fromISO && installment.dueDateISO < toISO) {
        out.push({ plan, installment });
      }
    }
  }
  out.sort((a, b) => a.installment.dueDateISO.localeCompare(b.installment.dueDateISO));
  return out;
}

/** Las VENCIDAS de los planes activos, la más vieja primero. */
export function eduInstallmentsVencidas(plans: EduPlanRow[]): EduInstallmentConPlan[] {
  const out: EduInstallmentConPlan[] = [];
  for (const plan of plans) {
    if (plan.status !== "ACTIVO") continue;
    for (const installment of plan.installments) {
      if (installment.status === "VENCIDA") out.push({ plan, installment });
    }
  }
  out.sort((a, b) => a.installment.dueDateISO.localeCompare(b.installment.dueDateISO));
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · PINTAR FECHAS DE CALENDARIO
// ═══════════════════════════════════════════════════════════════════════

const FECHA_LARGA = new Intl.DateTimeFormat("es-MX", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * "2026-09-15" → "15 de septiembre de 2026". Se formatea EN UTC sobre el
 * mediodía UTC: una fecha de calendario no tiene zona, y formatearla en
 * la del navegador la correría un día en media República
 * (feedback documentado: medianoche UTC son las 18:00 de AYER en México).
 */
export function eduFechaLarga(dayISO: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayISO)) return "—";
  return FECHA_LARGA.format(new Date(`${dayISO}T12:00:00.000Z`));
}
