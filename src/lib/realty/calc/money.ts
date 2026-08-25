// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · calculadoras — dinero SIN punto flotante.
//
// Módulo PURO y client-safe: lo importan los componentes "use client" para
// recalcular en vivo mientras el usuario escribe, y lo importan también las
// rutas de API para recalcular en el servidor. Sin Prisma, sin server-only.
//
// 🔴 LA REGLA: toda cantidad de dinero viaja en CENTAVOS ENTEROS.
//   · Las SUMAS y RESTAS se hacen entre enteros → exactas siempre.
//     (179.99 + 180 + 180 en pesos da 539.9899999999999; en centavos da
//     53999 y no hay nada que redondear.)
//   · Los PORCENTAJES sí pasan por coma flotante una vez —no hay forma de
//     sacar el 4.97% de algo sin dividir— pero el resultado se redondea a
//     centavo ENTERO en el acto, antes de volver a sumarse con nada. El
//     error nunca se acumula porque nunca sobrevive a la operación.
//   · decimal.js NO viaja al navegador. No es dependencia directa del repo
//     y meter 30 KB para sumar seis renglones no se justifica; el entero ya
//     es exacto. Prisma.Decimal se queda en la frontera de la BD.
//
// El techo: Number.MAX_SAFE_INTEGER son 9e15, o sea 90 mil millones de
// PESOS en centavos. El inmueble más caro del catálogo cabe con 4 órdenes
// de magnitud de sobra.
// ═══════════════════════════════════════════════════════════════════════

/** Centavos enteros. Alias documental: en el código son `number` a secas. */
export type Cents = number;

/** Pesos (con o sin decimales) → centavos enteros. */
export function toCents(pesos: number | string | null | undefined): Cents {
  const n = typeof pesos === "string" ? Number(pesos.replace(/[^0-9.-]/g, "")) : Number(pesos);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Centavos enteros → pesos con decimales. Solo para pintar o serializar. */
export function fromCents(cents: Cents): number {
  return Math.round(cents) / 100;
}

/**
 * Lo que el usuario escribió en un input → centavos, o null si no es un
 * número usable. Devolver null (y no 0) es a propósito: un campo vacío y un
 * cero significan cosas distintas y la UI tiene que poder distinguirlos.
 */
export function parseMoneyInput(raw: string | null | undefined): Cents | null {
  const s = String(raw ?? "").trim().replace(/[$\s,]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  return toCents(s);
}

/** Lo que el usuario escribió → número simple (edad, puntos, años, tasa). */
export function parseNumberInput(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim().replace(/[%\s,]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * El `pct` por ciento de `cents`, redondeado a centavo entero.
 * `pct` viene como 4.97 para "4.97 %", no como 0.0497.
 */
export function pctOfCents(cents: Cents, pct: number): Cents {
  if (!Number.isFinite(cents) || !Number.isFinite(pct)) return 0;
  return Math.round((cents * pct) / 100);
}

/** Suma exacta: los sumandos ya son enteros, así que esto no puede derivar. */
export function sumCents(...values: Cents[]): Cents {
  let total = 0;
  for (const v of values) total += Math.round(v || 0);
  return total;
}

/** Nunca por debajo de cero (una ganancia negativa no es una pérdida fiscal). */
export function clampCents(cents: Cents): Cents {
  return cents > 0 ? Math.round(cents) : 0;
}

/** `part` como porcentaje de `whole`. Devuelve 0 si no hay base. */
export function pctOf(part: Cents, whole: Cents): number {
  if (!whole) return 0;
  return (part / whole) * 100;
}

// ── Formato es-MX ──────────────────────────────────────────────────────
// Los Intl.NumberFormat se construyen UNA vez a nivel de módulo: estas
// funciones se llaman en cada tecleo y construir el formateador dentro
// costaría más que el cálculo entero.

const MXN_0 = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const MXN_2 = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const NUM_2 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });

/** $1,234 — para totales grandes, que es como se habla de una casa. */
export function fmtMXN(cents: Cents): string {
  try {
    return MXN_0.format(fromCents(cents));
  } catch {
    return `$${fromCents(cents)}`;
  }
}

/** $1,234.56 — para renglones donde los centavos importan. */
export function fmtMXN2(cents: Cents): string {
  try {
    return MXN_2.format(fromCents(cents));
  } catch {
    return `$${fromCents(cents)}`;
  }
}

/** "4.97 %" */
export function fmtPct(pct: number, decimals = 2): string {
  if (!Number.isFinite(pct)) return "—";
  const n = Number(pct.toFixed(decimals));
  return `${NUM_2.format(n)} %`;
}

/** "$1,234 a $2,345" o "$1,234" si los dos extremos coinciden. */
export function fmtRange(min: Cents, max: Cents): string {
  if (Math.round(min) === Math.round(max)) return fmtMXN(min);
  return `${fmtMXN(min)} a ${fmtMXN(max)}`;
}

/**
 * Valor presente de una anualidad vencida: cuánto capital soporta un pago
 * mensual de `payment` durante `months` a una tasa mensual `monthlyRate`.
 *
 *   VP = pago × (1 − (1 + i)^−n) / i
 *
 * Es la fórmula estándar de amortización, la misma que usa cualquier
 * simulador hipotecario. Aquí entra y sale en CENTAVOS: el `Math.pow` es
 * inevitable (una potencia no se hace con enteros), pero el resultado se
 * redondea a centavo antes de tocar cualquier otra cifra.
 */
export function presentValueOfAnnuity(
  payment: Cents,
  monthlyRate: number,
  months: number,
): Cents {
  if (payment <= 0 || months <= 0) return 0;
  if (!Number.isFinite(monthlyRate) || monthlyRate <= 0) {
    // Tasa cero: el capital es simplemente la suma de los pagos.
    return Math.round(payment * months);
  }
  const factor = (1 - Math.pow(1 + monthlyRate, -months)) / monthlyRate;
  return Math.round(payment * factor);
}

/**
 * El pago mensual que amortiza `principal` en `months` a tasa `monthlyRate`.
 * Es la inversa exacta de presentValueOfAnnuity.
 */
export function monthlyPayment(
  principal: Cents,
  monthlyRate: number,
  months: number,
): Cents {
  if (principal <= 0 || months <= 0) return 0;
  if (!Number.isFinite(monthlyRate) || monthlyRate <= 0) {
    return Math.round(principal / months);
  }
  const factor = monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));
  return Math.round(principal * factor);
}
