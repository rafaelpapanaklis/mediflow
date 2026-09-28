// ═══════════════════════════════════════════════════════════════════════════
// Reglas de cobro de ortodoncia (ws1-t1, Ola 1 · Cobro) — puro, sin I/O.
//
// F9 (descuentos de contado/hermanos/pago puntual) y F10 (recargo por
// atraso, configurable y APAGADO por default — decisión de Rafael en el
// prompt de esta ola). Las reglas y la config viven por clínica
// (`orthodontic_billing_configs`, leídas por `config-db.ts`); este archivo
// solo hace la aritmética, en centavos enteros, igual que
// `lib/quotes/condiciones-pago.ts`.
//
// Client-safe: sin Prisma, sin `Date.now()` implícito.
// ═══════════════════════════════════════════════════════════════════════════

import { aCentavos, aPesos } from "@/lib/quotes/condiciones-pago";

export type TipoValorRecargo = "PCT" | "FIJO";

export interface ReglaDescuento {
  id: string;
  /** "Contado", "Hermanos", "Pago puntual"… lo que la clínica quiera llamarle. */
  etiqueta: string;
  /** Porcentaje sobre el total del plan (0-100). */
  porcentaje: number;
}

export interface ConfigRecargoPorAtraso {
  /** Apagado por default (decisión de Rafael): la clínica lo prende si quiere. */
  activo: boolean;
  tipo: TipoValorRecargo;
  /** Porcentaje (0-100) si `tipo === "PCT"`, o pesos si `tipo === "FIJO"`. */
  valor: number;
  /** Días de gracia tras el vencimiento antes de que el recargo aplique. */
  diasDeGracia: number;
}

/** Config neutra: sin reglas de descuento, recargo apagado. */
export function configDeCobroPorDefecto(): { discountRules: ReglaDescuento[]; lateFee: ConfigRecargoPorAtraso } {
  return {
    discountRules: [],
    lateFee: { activo: false, tipo: "PCT", valor: 0, diasDeGracia: 5 },
  };
}

/**
 * El descuento de una regla sobre un total, en pesos con centavos exactos.
 * Un porcentaje fuera de [0,100] se acota: una regla mal configurada no
 * puede convertirse en un descuento negativo o mayor que el total.
 */
export function calcularDescuento(porcentaje: number, total: number): number {
  const pct = Math.min(100, Math.max(0, Number(porcentaje) || 0));
  const totalC = Math.max(0, aCentavos(total));
  return aPesos(Math.round((totalC * pct) / 100));
}

/**
 * ¿Cuánto recargo corresponde por una cuota vencida, o `0` si el recargo
 * está apagado, la cuota no lleva días de atraso suficientes, o el importe
 * ya está saldado?
 *
 * NUNCA se aplica solo: quien cobra lo ve como una sugerencia en pantalla
 * («+ $50 de recargo por 12 días de atraso») y decide si lo suma al monto
 * que teclea en Caja — el recargo no bloquea ni fuerza el cobro.
 */
export function calcularRecargo(
  config: ConfigRecargoPorAtraso,
  importeCuota: number,
  diasDeAtraso: number,
): number {
  if (!config.activo) return 0;
  if (!(diasDeAtraso > config.diasDeGracia)) return 0;
  const importeC = Math.max(0, aCentavos(importeCuota));
  if (importeC <= 0) return 0;
  if (config.tipo === "FIJO") return Math.max(0, Number(config.valor) || 0);
  return calcularDescuento(config.valor, importeCuota);
}

/** Días naturales entre dos fechas "YYYY-MM-DD" (b - a). Negativo si b < a. */
export function diasEntre(aISO: string, bISO: string): number {
  const a = new Date(`${aISO}T00:00:00Z`).getTime();
  const b = new Date(`${bISO}T00:00:00Z`).getTime();
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}
