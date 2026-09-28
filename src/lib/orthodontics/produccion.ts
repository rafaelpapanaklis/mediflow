// ═══════════════════════════════════════════════════════════════════════════
// PRODUCCIÓN DE ORTODONCIA, POR PAGO (ws1-t5, ronda 6 — filas 88, 89 y 90 de la
// revisión de lógica de uso). Puro, sin I/O: el cargador vive en
// `produccion-db.ts`.
//
// Lo que arregla:
//
//  · Un REEMBOLSO se guarda como un pago más, con método "refund" y monto
//    POSITIVO (ver `REFUND_METHOD` en src/lib/caja.ts). Sumarlo como cobro
//    inflaba la producción justo cuando se devolvía dinero. Aquí resta.
//  · Cada pago se atribuye al doctor que LLEVABA el caso el día del pago, no a
//    quien lo lleva hoy: reasignar un caso ya no le pasa al doctor nuevo todo
//    lo cobrado antes. El historial sale de la bitácora (`CambioDeDoctor`).
//    Un caso sin cambios registrados se atribuye a su doctor actual, como
//    siempre.
//  · «El mes» es el mes de la CLÍNICA, no el de UTC: un cobro del 30 de
//    septiembre a las 19:00 en México es de septiembre, aunque en UTC ya sea
//    1 de octubre.
//
// Lo usan el Tablero del módulo, el bloque «Ortodoncia» de Finanzas y la
// analítica de doctores: una sola forma de contar, tres pantallas.
// ═══════════════════════════════════════════════════════════════════════════

import { calendarDayRangeUtc } from "@/lib/agenda/time-utils";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";

/** Igual que `REFUND_METHOD` de src/lib/caja.ts; se repite aquí para que este archivo siga siendo puro (caja.ts importa Prisma). */
export const METODO_REEMBOLSO = "refund";

/** Un movimiento de dinero de una factura ligada a un caso de ortodoncia. */
export interface PagoDeCaso {
  planId: string;
  invoiceId: string;
  /** Siempre positivo, también en un reembolso. */
  amount: number;
  method: string | null;
  paidAt: Date;
}

/** Una reasignación del doctor tratante de un caso, leída de la bitácora. */
export interface CambioDeDoctor {
  planId: string;
  at: Date;
  /** Quién lo llevaba ANTES del cambio. `null` = el caso no tenía doctor. */
  de: string | null;
  /** Quién lo lleva DESPUÉS. */
  a: string | null;
}

export interface ProduccionDeDoctor {
  doctorId: string | null;
  doctorName: string;
  /** Cobrado menos reembolsado, en pesos. Puede ser negativo si en el periodo se devolvió más de lo que se cobró. */
  amountMxn: number;
}

export const SIN_DOCTOR_TRATANTE = "Sin doctor tratante";

const aCentavos = (pesos: unknown) => Math.round((Number(pesos) || 0) * 100);

/** "YYYY-MM" del instante `d` en la zona de la clínica. */
export function mesEnZona(d: Date, zonaHoraria: string): string {
  return hoyEnZona(d, zonaHoraria).slice(0, 7);
}

/** El mes "YYYY-MM" de la clínica como ventana `[desde, hasta)` de instantes. */
export function rangoDelMes(mes: string, zonaHoraria: string): { desde: Date; hasta: Date } {
  const [a, m] = mes.split("-").map((x) => parseInt(x, 10));
  const sig = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
  return {
    desde: calendarDayRangeUtc(`${mes}-01`, zonaHoraria).startUtc,
    hasta: calendarDayRangeUtc(`${sig}-01`, zonaHoraria).startUtc,
  };
}

/**
 * Quién llevaba el caso en el instante `cuando`.
 *
 * Se busca el PRIMER cambio posterior a `cuando`: quien lo llevaba antes de
 * ese cambio es quien lo llevaba entonces. Si no hay ningún cambio posterior,
 * es el doctor actual. Un cambio exactamente en el mismo instante cuenta como
 * ya hecho (el pago es del doctor nuevo).
 */
export function doctorVigente(
  planId: string,
  cuando: Date,
  doctorActual: string | null,
  cambios: CambioDeDoctor[],
): string | null {
  let siguiente: CambioDeDoctor | null = null;
  for (const c of cambios) {
    if (c.planId !== planId) continue;
    if (c.at.getTime() <= cuando.getTime()) continue;
    if (siguiente === null || c.at.getTime() < siguiente.at.getTime()) siguiente = c;
  }
  return siguiente ? siguiente.de : doctorActual;
}

export interface ProduccionInput {
  pagos: PagoDeCaso[];
  /** Doctor tratante ACTUAL de cada caso. Un pago de un caso que no está aquí se ignora (no es de un caso que el usuario pueda ver). */
  doctorActualPorCaso: ReadonlyMap<string, string | null>;
  cambios: CambioDeDoctor[];
  /** Nombre de cada doctor, por id. Quien falte sale como «Doctor que ya no está en la clínica». */
  nombres: ReadonlyMap<string, string>;
  /** Si se da, solo cuentan los pagos cuyo mes (en `zonaHoraria`) sea este "YYYY-MM". */
  mes?: string;
  zonaHoraria: string;
}

export const DOCTOR_QUE_YA_NO_ESTA = "Doctor que ya no está en la clínica";

/**
 * Producción neta (cobros − reembolsos) por doctor, de mayor a menor. Suma en
 * centavos. Los doctores cuyo neto es exactamente cero no salen: no cobraron
 * nada o lo que cobraron se devolvió entero.
 */
export function produccionPorDoctor(input: ProduccionInput): ProduccionDeDoctor[] {
  const centavos = new Map<string, number>();
  const SIN = "__sin_doctor__";

  for (const p of input.pagos) {
    if (!input.doctorActualPorCaso.has(p.planId)) continue;
    if (input.mes && mesEnZona(p.paidAt, input.zonaHoraria) !== input.mes) continue;
    const doctorId = doctorVigente(p.planId, p.paidAt, input.doctorActualPorCaso.get(p.planId) ?? null, input.cambios);
    const clave = doctorId ?? SIN;
    const signo = p.method === METODO_REEMBOLSO ? -1 : 1;
    centavos.set(clave, (centavos.get(clave) ?? 0) + signo * aCentavos(p.amount));
  }

  const out: ProduccionDeDoctor[] = [];
  for (const [clave, c] of centavos) {
    if (c === 0) continue;
    const doctorId = clave === SIN ? null : clave;
    out.push({
      doctorId,
      doctorName: doctorId === null ? SIN_DOCTOR_TRATANTE : input.nombres.get(doctorId) ?? DOCTOR_QUE_YA_NO_ESTA,
      amountMxn: c / 100,
    });
  }
  return out.sort((a, b) => b.amountMxn - a.amountMxn || a.doctorName.localeCompare(b.doctorName, "es"));
}

/** Cobrado, reembolsado y neto de una lista de pagos, en pesos. Sin atribuir a nadie. */
export function totalesDePagos(pagos: PagoDeCaso[]): { cobrado: number; reembolsado: number; neto: number } {
  let cobrado = 0;
  let reembolsado = 0;
  for (const p of pagos) {
    if (p.method === METODO_REEMBOLSO) reembolsado += aCentavos(p.amount);
    else cobrado += aCentavos(p.amount);
  }
  return { cobrado: cobrado / 100, reembolsado: reembolsado / 100, neto: (cobrado - reembolsado) / 100 };
}

/**
 * Lee de una fila de bitácora si fue una reasignación de doctor. La bitácora
 * guarda `changes` como `{ campo: { before, after } }` (ver `auditOrtho`); solo
 * cuenta si el campo `treatingDoctorId` cambió de verdad.
 */
export function cambioDeDoctorDesdeBitacora(fila: {
  entityId: string;
  createdAt: Date;
  changes: unknown;
}): CambioDeDoctor | null {
  const cambios = fila.changes as Record<string, unknown> | null;
  if (!cambios || typeof cambios !== "object") return null;
  const campo = cambios.treatingDoctorId as { before?: unknown; after?: unknown } | undefined;
  if (!campo || typeof campo !== "object") return null;
  const de = typeof campo.before === "string" && campo.before ? campo.before : null;
  const a = typeof campo.after === "string" && campo.after ? campo.after : null;
  if (de === a) return null;
  return { planId: fila.entityId, at: fila.createdAt, de, a };
}
