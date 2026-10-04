// ═══════════════════════════════════════════════════════════════════════════
// UNA sola definición de «INGRESOS» y de «DEUDA» (ws1-t2, auditoría de dinero
// F4/F8/F9 del 3-oct-2026). Parte PURA: sin Prisma ni red, se prueba sola
// (src/lib/dinero/__tests__/ingresos-y-deuda.test.ts). Las consultas viven en
// `ingresos.server.ts` y las usan Finanzas, Reportes, Inicio, Sabina, la
// analítica de doctores y la nómina.
//
// INGRESOS del periodo = lo COBRADO NETO por FECHA DE COBRO:
//   · Payment con `paidAt` en el periodo (en la zona de la clínica), de
//     facturas no canceladas, menos los reembolsos reales del mismo periodo
//     (el reembolso resta el día que se devolvió el dinero);
//   · fuera la HISTORIA MIGRADA: lo cobrado en el sistema anterior nunca es
//     ingreso de DaleControl. Vive en `migrated_payments` (o como lo `paid` de
//     una factura migrada que no tiene Payment), y las pocas filas viejas de
//     `payments` con método "migrated" tampoco cuentan.
//   · qué método es cobro y cuál no lo decide `revenuePaymentWhere` de
//     src/lib/caja.ts (ws1-t5: la aplicación de saldo a favor no es ingreso,
//     se cuenta el día que se cobró); aquí solo se le SUMA la exclusión de
//     la historia, con AND, para no pisar ese criterio.
//
// DEUDA = saldo de las facturas EMITIDAS: ni borradores (todavía no se le
// cobran a nadie) ni canceladas (conservan su `balance` en la base, por eso
// el filtro de estado es obligatorio). Es `receivableInvoiceWhere`.
//
// COMISIONES / NÓMINA: sobre lo COBRADO, por fecha de cobro (recomendación de
// la auditoría aceptada como valor por defecto; decisión de Rafael anotada en
// REPORTE-ws1-t2). Cada cobro va al doctor de la factura; si la factura no
// tiene, al de su cita; los de casos de ortodoncia sin cita, a quien llevaba
// el caso ese día (produccion.ts). Así la suma por doctor ES el ingreso.
// ═══════════════════════════════════════════════════════════════════════════

import { doctorDeUnCobro, type CambioDeDoctor } from "@/lib/orthodontics/produccion";

/** Métodos de Payment que son HISTORIA de otro sistema, no dinero cobrado aquí. */
export const METODOS_DE_HISTORIA = ["migrated"] as const;

/** Métodos que RESTAN de lo pagado de una factura (no son un cobro). Igual que `REFUND_METHOD` de caja.ts. */
export const METODOS_QUE_RESTAN = ["refund"] as const;

/** Clave del grupo «sin doctor» en el reparto por doctor. */
export const SIN_DOCTOR = null;

const aCentavos = (n: number | null | undefined) => Math.round((Number(n) || 0) * 100);

export interface MovimientoFechado {
  amount: number | null;
  paidAt: Date;
}

export interface NetoDelPeriodo {
  /** Cobrado − reembolsado. Puede ser negativo (se devolvió más de lo que entró). */
  neto: number;
  /** Solo cobros, sin restar nada. */
  cobrado: number;
  reembolsos: number;
  /** Neto por clave (día, mes…), si se pidió `clave`. */
  porClave: Record<string, number>;
}

/**
 * El NETO de un periodo y su reparto por clave. KPI y serie salen de las
 * MISMAS filas, así que la suma de la serie es el KPI por construcción. Suma
 * en centavos: sin ruido de flotantes.
 */
export function netoDelPeriodo(
  cobros: MovimientoFechado[],
  reembolsos: MovimientoFechado[],
  clave?: (d: Date) => string,
): NetoDelPeriodo {
  const porClaveC: Record<string, number> = {};
  let cobradoC = 0;
  let reembolsosC = 0;
  for (const c of cobros) {
    const v = aCentavos(c.amount);
    cobradoC += v;
    if (clave) { const k = clave(c.paidAt); porClaveC[k] = (porClaveC[k] ?? 0) + v; }
  }
  for (const r of reembolsos) {
    const v = aCentavos(r.amount);
    reembolsosC += v;
    if (clave) { const k = clave(r.paidAt); porClaveC[k] = (porClaveC[k] ?? 0) - v; }
  }
  const porClave: Record<string, number> = {};
  for (const [k, v] of Object.entries(porClaveC)) porClave[k] = v / 100;
  return { neto: (cobradoC - reembolsosC) / 100, cobrado: cobradoC / 100, reembolsos: reembolsosC / 100, porClave };
}

/** Un cobro (o reembolso) con lo necesario para saber de qué doctor es. */
export interface MovimientoDeDoctor extends MovimientoFechado {
  invoiceId: string;
  /** `Invoice.doctorId`: el doctor atribuido en la factura. */
  facturaDoctorId: string | null;
  /** La cita de la factura, si nació de una. */
  appointmentId: string | null;
  citaDoctorId: string | null;
}

export interface RepartoInput {
  cobros: MovimientoDeDoctor[];
  reembolsos: MovimientoDeDoctor[];
  /** Factura → caso de ortodoncia, para las facturas de casos (tratamiento, controles, extras). */
  casoPorFactura: ReadonlyMap<string, string>;
  /** Doctor tratante ACTUAL de cada caso. */
  doctorActualPorCaso: ReadonlyMap<string, string | null>;
  /** Reasignaciones de doctor tratante leídas de la bitácora. */
  cambios: CambioDeDoctor[];
}

export interface IngresoDeDoctor {
  /** Neto atribuido al doctor (cobros − reembolsos), en pesos. */
  total: number;
  /** De `total`, lo que viene de casos de ortodoncia sin cita. */
  orto: number;
}

/**
 * ¿De qué doctor es este movimiento? El de la factura; si no tiene, el de su
 * cita. Un cobro de un caso de ortodoncia SIN cita (la factura del tratamiento
 * o un extra) va a quien llevaba el caso el día del cobro.
 */
export function doctorDelMovimiento(
  m: MovimientoDeDoctor,
  input: Pick<RepartoInput, "casoPorFactura" | "doctorActualPorCaso" | "cambios">,
): { doctorId: string | null; orto: boolean } {
  // La regla es UNA (ws1-t2, C-08): la misma que usa el bloque «Ortodoncia».
  const planId = input.casoPorFactura.get(m.invoiceId);
  const caso = planId && input.doctorActualPorCaso.has(planId)
    ? { planId, doctorActual: input.doctorActualPorCaso.get(planId) ?? null, cambios: input.cambios }
    : null;
  return doctorDeUnCobro(m, caso);
}

/**
 * Lo cobrado neto del periodo, por doctor. La suma de todos los grupos
 * (incluido «sin doctor», clave `null`) es EXACTAMENTE `netoDelPeriodo` de las
 * mismas filas: la nómina y Finanzas no pueden contar dinero que no entró.
 */
export function repartirPorDoctor(input: RepartoInput): Map<string | null, IngresoDeDoctor> {
  const c = new Map<string | null, { total: number; orto: number }>();
  const sumar = (m: MovimientoDeDoctor, signo: 1 | -1) => {
    const { doctorId, orto } = doctorDelMovimiento(m, input);
    const g = c.get(doctorId) ?? { total: 0, orto: 0 };
    const v = signo * aCentavos(m.amount);
    g.total += v;
    if (orto) g.orto += v;
    c.set(doctorId, g);
  };
  for (const m of input.cobros) sumar(m, 1);
  for (const m of input.reembolsos) sumar(m, -1);
  const out = new Map<string | null, IngresoDeDoctor>();
  for (const [k, g] of c) out.set(k, { total: g.total / 100, orto: g.orto / 100 });
  return out;
}

/**
 * Lo HISTÓRICO de una factura: lo `paid` que no respalda ningún cobro hecho
 * en DaleControl (la factura migrada llega con su `paid` y sin Payment). Los
 * cobros de aquí son los Payment que ni restan ni son historia. Nunca negativo:
 * una factura normal da 0.
 */
export function historiaDeFactura(paid: number | null | undefined, cobrosDeAqui: number | null | undefined): number {
  const h = aCentavos(paid) - aCentavos(cobrosDeAqui);
  return h > 0 ? h / 100 : 0;
}

/** ¿Este método de Payment es de la historia migrada? */
export function esMetodoDeHistoria(method: string | null | undefined): boolean {
  return (METODOS_DE_HISTORIA as readonly string[]).includes(String(method ?? ""));
}
