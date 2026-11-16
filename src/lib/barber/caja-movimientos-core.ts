// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — CAJA COMPLETA, núcleo client-safe (ws6-t1, 16-nov-2026).
//
// Tipos, catálogos y validación de lo que se teclea en los movimientos de
// caja (gasto, sacar, meter, pagar a barbero) y en el conteo del corte. Sin
// prisma, sin Decimal y sin "server-only": lo importan la pantalla (vista
// previa en CENTAVOS enteros) y el servidor (que vuelve a validar y calcula
// en Prisma.Decimal, ver caja-resumen.ts). La tabla vive en
// sql/barber_caja_completa.sql.
// ═══════════════════════════════════════════════════════════════════════

export const CASH_MOVEMENT_TYPES = ["EXPENSE", "WITHDRAWAL", "DEPOSIT", "BARBER_PAYOUT"] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

/** ¿Con qué se pagó? Solo CASH mueve el cajón. */
export const CASH_MOVEMENT_METHODS = ["CASH", "CARD", "TRANSFER", "OTHER"] as const;
export type CashMovementMethod = (typeof CASH_MOVEMENT_METHODS)[number];

export const BARBER_PAYOUT_KINDS = ["ADVANCE", "COMMISSION", "SALARY", "OTHER"] as const;
export type BarberPayoutKind = (typeof BARBER_PAYOUT_KINDS)[number];

/**
 * Categorías de gasto. Se guarda la CLAVE (no el texto) para que el panel en
 * inglés las nombre en inglés; la etiqueta sale del diccionario
 * (barber.caja.mov.cat.<clave>). Una categoría que no esté aquí (fila vieja
 * o escrita por otro camino) se enseña tal cual.
 */
export const CASH_EXPENSE_CATEGORIES = [
  "SUPPLIES", // Insumos
  "RESALE", // Productos para venta
  "CLEANING", // Limpieza
  "RENT", // Renta
  "UTILITIES", // Luz/agua/internet
  "FOOD", // Comida
  "ADS", // Publicidad
  "MAINTENANCE", // Mantenimiento
  "PAYROLL", // Sueldos/comisiones
  "OTHER", // Otro
] as const;
export type CashExpenseCategory = (typeof CASH_EXPENSE_CATEGORIES)[number];

/** Retiros y entradas son siempre en efectivo (lo dice también el CHECK de la tabla). */
export const CASH_ONLY_TYPES: readonly CashMovementType[] = ["WITHDRAWAL", "DEPOSIT"];

export const CASH_MOVEMENT_MAX = 9_999_999.99;
export const CASH_NOTE_MAX = 500;

export function isCashMovementType(v: unknown): v is CashMovementType {
  return typeof v === "string" && (CASH_MOVEMENT_TYPES as readonly string[]).includes(v);
}
export function isCashMovementMethod(v: unknown): v is CashMovementMethod {
  return typeof v === "string" && (CASH_MOVEMENT_METHODS as readonly string[]).includes(v);
}
export function isBarberPayoutKind(v: unknown): v is BarberPayoutKind {
  return typeof v === "string" && (BARBER_PAYOUT_KINDS as readonly string[]).includes(v);
}
export function isCashExpenseCategory(v: unknown): v is CashExpenseCategory {
  return typeof v === "string" && (CASH_EXPENSE_CATEGORIES as readonly string[]).includes(v);
}

/** ¿Este movimiento entra o sale del cajón? +1 entra, −1 sale, 0 no toca el efectivo. */
export function drawerSign(m: { type: CashMovementType; method: CashMovementMethod }): -1 | 0 | 1 {
  if (m.method !== "CASH") return 0;
  return m.type === "DEPOSIT" ? 1 : -1;
}

/**
 * ¿Es el movimiento de un pago marcado en Comisiones? (revisión ws6-t8):
 * el pago de comisión/sueldo «sale de la caja» y, con renta de silla a favor
 * del dueño, la entrada «entra a la caja». Anularlo deshace ese pago.
 */
export function isLinkedCommissionMovement(m: {
  type: CashMovementType;
  payoutKind: BarberPayoutKind | null;
  barberId: string | null;
  periodKey: string | null;
}): boolean {
  if (m.type === "BARBER_PAYOUT") return m.payoutKind === "COMMISSION" || m.payoutKind === "SALARY";
  return m.type === "DEPOSIT" && m.barberId !== null && m.periodKey !== null;
}

// ── Monto tecleado ──────────────────────────────────────────────────────

export type AmountError = "required" | "format" | "zero" | "tooBig";

/** Resultado de validar (el `error?: undefined` deja leer .error sin estrechar: tsconfig no es strict). */
export type AmountParse =
  | { ok: true; cents: number; error?: undefined }
  | { ok: false; error: AmountError; cents?: undefined };

/**
 * Monto de un movimiento escrito a mano → centavos ENTEROS. Es el ÚNICO campo
 * obligatorio (decisión de Rafael: motivos y notas opcionales). Acepta «80»,
 * «80.5», «1,000.00» y «$1,000»; rechaza vacío, letras, negativos, 0, más de
 * dos decimales y más del máximo.
 */
export function parseMovementAmount(raw: unknown): AmountParse {
  let txt: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { ok: false, error: "format" };
    txt = String(raw);
  } else if (typeof raw === "string") {
    txt = raw.trim().replace(/[$\s]/g, "").replace(/,/g, "");
  } else if (raw === null || raw === undefined) {
    txt = "";
  } else {
    return { ok: false, error: "format" };
  }
  if (txt === "") return { ok: false, error: "required" };
  if (!/^\d+(\.\d{1,2})?$/.test(txt)) return { ok: false, error: "format" };
  const [ent, dec = ""] = txt.split(".");
  const cents = Number(ent) * 100 + Number((dec + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return { ok: false, error: "tooBig" };
  if (cents === 0) return { ok: false, error: "zero" };
  if (cents > Math.round(CASH_MOVEMENT_MAX * 100)) return { ok: false, error: "tooBig" };
  return { ok: true, cents };
}

/** Mensaje del servidor para cada error de monto (la pantalla usa el diccionario). */
export const AMOUNT_ERROR_MESSAGES: Record<AmountError, string> = {
  required: "Escribe el monto.",
  format: "El monto tiene que ser un número (por ejemplo 80 o 80.50), sin letras ni signo menos.",
  zero: "El monto tiene que ser mayor que $0.",
  tooBig: "El monto es demasiado grande.",
};

/** Nota/motivo opcional: recortado, vacío = null. */
export function cleanOptionalText(raw: unknown, max = CASH_NOTE_MAX): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/\s+/g, " ");
  return s === "" ? null : s.slice(0, max);
}

// ── Conteo del corte por denominación ───────────────────────────────────

/**
 * Billetes y monedas de México, en CENTAVOS (la clave del conteo guardado es
 * el valor en pesos como texto: "1000", "0.5"). Una constante: si la
 * barbería cobra en otra moneda, se cambia aquí.
 */
export const CASH_DENOMINATIONS: ReadonlyArray<{ key: string; cents: number; kind: "bill" | "coin" }> = [
  { key: "1000", cents: 100000, kind: "bill" },
  { key: "500", cents: 50000, kind: "bill" },
  { key: "200", cents: 20000, kind: "bill" },
  { key: "100", cents: 10000, kind: "bill" },
  { key: "50", cents: 5000, kind: "bill" },
  { key: "20", cents: 2000, kind: "bill" },
  { key: "20c", cents: 2000, kind: "coin" },
  { key: "10", cents: 1000, kind: "coin" },
  { key: "5", cents: 500, kind: "coin" },
  { key: "2", cents: 200, kind: "coin" },
  { key: "1", cents: 100, kind: "coin" },
  { key: "0.5", cents: 50, kind: "coin" },
];

export type CashCount = Record<string, number>;

/**
 * Conteo tecleado → piezas por denominación (solo las que llevan algo) y su
 * total en centavos. Claves desconocidas, cantidades negativas o con decimales
 * → null (el servidor responde 400). Vacío o todo en 0 → { count: {}, cents: 0 }.
 */
export function parseCashCount(raw: unknown): { count: CashCount; cents: number } | null {
  if (raw === null || raw === undefined) return { count: {}, cents: 0 };
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const byKey = new Map(CASH_DENOMINATIONS.map((d) => [d.key, d.cents]));
  const count: CashCount = {};
  let cents = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const unit = byKey.get(k);
    if (unit === undefined) return null;
    const n = typeof v === "string" ? (v.trim() === "" ? 0 : Number(v)) : v;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 100000) return null;
    if (n === 0) continue;
    count[k] = n;
    cents += unit * n;
  }
  return { count, cents };
}

/** Diferencia del corte en centavos → «cuadra», «sobra» o «falta». */
export function differenceKind(diffCents: number): "ok" | "over" | "short" {
  return diffCents === 0 ? "ok" : diffCents > 0 ? "over" : "short";
}
