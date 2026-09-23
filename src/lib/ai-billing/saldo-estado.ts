/**
 * Cómo se lee el saldo de un monedero de IA. Módulo PURO (sin prisma, sin
 * `server-only`): lo usan el GET de /api/admin/ai-billing (para marcar «saldo
 * bajo»), la tabla de /admin/ai-billing y la ficha de la clínica, así las tres
 * pantallas dicen lo mismo del mismo número.
 */

/** Saldo bajo de una clínica: por debajo de $50 MXN. */
export const LOW_BALANCE_CENTS = 5000;

export interface MonederoResumen {
  /** false = la clínica no tiene monedero (no es saldo 0: es «no aplica»). */
  hasWallet: boolean;
  /** ACTIVE | PAUSED. null sin monedero. */
  status: string | null;
  /** Centavos MXN. null sin monedero. */
  balanceCents: number | null;
}

export type EstadoMonedero = "sin-monedero" | "pausado" | "negativo" | "saldo-bajo" | "activo";

/** Solo tiene sentido con monedero; sin él no hay saldo que se agote. */
export function esSaldoBajo(m: MonederoResumen): boolean {
  return m.hasWallet && (m.balanceCents ?? 0) < LOW_BALANCE_CENTS;
}

/**
 * El estado con el que se pinta la pastilla, en orden de gravedad: sin
 * monedero, pausado, en negativo, saldo bajo, activo. Es la misma regla que
 * la tabla de Tesorería llevaba escrita en su JSX.
 */
export function estadoMonedero(m: MonederoResumen): EstadoMonedero {
  if (!m.hasWallet) return "sin-monedero";
  if (m.status === "PAUSED") return "pausado";
  if ((m.balanceCents ?? 0) < 0) return "negativo";
  if (esSaldoBajo(m)) return "saldo-bajo";
  return "activo";
}

export const ETIQUETA_ESTADO_MONEDERO: Record<EstadoMonedero, string> = {
  "sin-monedero": "Sin monedero",
  "pausado": "Pausado",
  "negativo": "Negativo",
  "saldo-bajo": "Saldo bajo",
  "activo": "Activo",
};

/** Tonos del sistema de diseño (BadgeNew). */
export const TONO_ESTADO_MONEDERO: Record<
  EstadoMonedero,
  "success" | "warning" | "danger" | "info" | "brand" | "neutral"
> = {
  "sin-monedero": "neutral",
  "pausado": "danger",
  "negativo": "danger",
  "saldo-bajo": "warning",
  "activo": "success",
};
