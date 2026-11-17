// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — SUELDO DEL BARBERO, núcleo PURO (ws6-t6, 16-nov-2026).
//
// Rafael: «Que sea opcional que se ponga su sueldo semanal, quincenal o
// mensual, si trae sueldo». Sin prisma ni "server-only": lo usan el
// servidor (comisiones, equipo) y la pantalla (validar mientras se teclea).
//
// REGLAS
//  · El sueldo es OPCIONAL: monto y periodo van juntos (los dos o ninguno).
//  · Solo cuenta mientras el barbero cobra por «Sueldo» (commissionType
//    SALARY). Si se cambia a Comisión o Renta, el monto se conserva en la
//    ficha pero no suma en ningún lado.
//  · Sueldo de un rango de días (fechas de calendario, fin EXCLUSIVO):
//      WEEKLY   → monto × semanas del rango; si no son semanas completas,
//                 monto × días / 7, «aprox.».
//      BIWEEKLY → monto × quincenas (1–15 y 16–fin de mes); una quincena
//                 incompleta se prorratea por SUS días, «aprox.».
//      MONTHLY  → monto × meses; un mes incompleto se prorratea por los
//                 días de ESE mes, «aprox.».
//    Comisiones se ve por mes natural: mensual y quincenal salen exactos;
//    semanal solo es exacto en un febrero de 28 días.
//  · Dinero en Prisma.Decimal; redondeo ÚNICO al final (half-up, centavos).
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";

export type BarberSalaryPeriod = "WEEKLY" | "BIWEEKLY" | "MONTHLY";

export const BARBER_SALARY_PERIODS: BarberSalaryPeriod[] = ["WEEKLY", "BIWEEKLY", "MONTHLY"];

export const SALARY_MAX = 9_999_999.99;

export function isSalaryPeriod(v: unknown): v is BarberSalaryPeriod {
  return typeof v === "string" && (BARBER_SALARY_PERIODS as string[]).includes(v);
}

export interface BarberSalary {
  amount: number;
  period: BarberSalaryPeriod;
}

// ── Validación de lo que se teclea ─────────────────────────────────────

export type SalaryInputError = "amountBad" | "amountZero" | "periodMissing";

/** Resultado de validar (el `error?: undefined` deja leer .error sin estrechar: tsconfig no es strict). */
export type SalaryParse =
  | { ok: true; salary: BarberSalary | null; error?: undefined }
  | { ok: false; error: SalaryInputError; salary?: undefined };

/**
 * Lo que llega del formulario → sueldo o null (vacío = «como hoy»).
 * Monto vacío = sin sueldo (aunque haya periodo elegido). Monto escrito:
 * número > 0, máximo 2 decimales, con periodo.
 */
export function parseSalaryInput(
  rawAmount: unknown,
  rawPeriod: unknown,
): SalaryParse {
  const txt =
    typeof rawAmount === "number"
      ? String(rawAmount)
      : typeof rawAmount === "string"
        ? rawAmount.trim().replace(/[$,\s]/g, "")
        : rawAmount === null || rawAmount === undefined
          ? ""
          : null;
  if (txt === null) return { ok: false, error: "amountBad" };
  if (txt === "") return { ok: true, salary: null };
  if (!/^\d+(\.\d{1,2})?$/.test(txt)) return { ok: false, error: "amountBad" };
  const amount = Number(txt);
  if (!Number.isFinite(amount) || amount > SALARY_MAX) return { ok: false, error: "amountBad" };
  if (amount <= 0) return { ok: false, error: "amountZero" };
  if (!isSalaryPeriod(rawPeriod)) return { ok: false, error: "periodMissing" };
  return { ok: true, salary: { amount, period: rawPeriod } };
}

/** ¿Este barbero cobra sueldo AHORA? (cobra por Sueldo y tiene monto). */
export function activeSalary(
  commissionType: string,
  salary: BarberSalary | null | undefined,
): BarberSalary | null {
  return commissionType === "SALARY" && salary && salary.amount > 0 ? salary : null;
}

// ── Sueldo de un rango ─────────────────────────────────────────────────

export interface SalaryForRange {
  /** Monto ya redondeado a centavos. */
  amount: Prisma.Decimal;
  /** true = el rango no cuadra con semanas/quincenas/meses completos: prorrateo por días. */
  approx: boolean;
}

const DAY_MS = 86_400_000;

function parseDay(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`fecha inválida: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/**
 * Sueldo de [from, to) — fechas de calendario "YYYY-MM-DD", fin exclusivo.
 * Rango vacío o invertido = $0 exacto.
 */
export function salaryForRange(
  salary: BarberSalary,
  from: string,
  to: string,
): SalaryForRange {
  const a = parseDay(from);
  const b = parseDay(to);
  const amount = new Prisma.Decimal(salary.amount);
  const zero = { amount: new Prisma.Decimal(0), approx: false };
  if (!(b > a) || amount.lte(0)) return zero;
  const days = Math.round((b - a) / DAY_MS);

  if (salary.period === "WEEKLY") {
    const total = amount.times(days).div(7);
    return { amount: total.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP), approx: days % 7 !== 0 };
  }

  // Quincenal y mensual: se agrupan los días por su quincena / su mes.
  const grupos = new Map<string, { n: number; len: number }>();
  for (let t = a; t < b; t += DAY_MS) {
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m0 = d.getUTCMonth();
    const dia = d.getUTCDate();
    const dim = daysInMonth(y, m0);
    let key: string;
    let len: number;
    if (salary.period === "MONTHLY") {
      key = `${y}-${m0}`;
      len = dim;
    } else {
      const primera = dia <= 15;
      key = `${y}-${m0}-${primera ? 1 : 2}`;
      len = primera ? 15 : dim - 15;
    }
    const g = grupos.get(key);
    if (g) g.n += 1;
    else grupos.set(key, { n: 1, len });
  }
  let total = new Prisma.Decimal(0);
  let approx = false;
  for (const g of Array.from(grupos.values())) {
    if (g.n === g.len) total = total.plus(amount);
    else {
      approx = true;
      total = total.plus(amount.times(g.n).div(g.len));
    }
  }
  return { amount: total.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP), approx };
}

/** Los días de un periodo de Comisiones ("YYYY-MM", mes natural): [from, to), fin exclusivo. */
export function periodKeyDays(periodKey: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!m) throw new Error(`periodo inválido: ${periodKey}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const from = `${y}-${String(mo).padStart(2, "0")}-01`;
  const ny = mo === 12 ? y + 1 : y;
  const nm = mo === 12 ? 1 : mo + 1;
  const to = `${ny}-${String(nm).padStart(2, "0")}-01`;
  return { from, to };
}

// ── Desde el ALTA del barbero (decisión 3 del QA de cierre E, 16-nov-2026) ──
//
// Renta de silla y sueldo cuentan desde el día en que se dio de alta al
// barbero, no desde el día 1 del mes ni en meses anteriores. Antes, un
// barbero creado el 16 «debía» la renta completa del mes (y la de octubre), y
// la Ganancia restaba su sueldo de días en que no existía.

/** «YYYY-MM-DD» de un instante en la zona de la barbería (el día de alta). */
export function dayKeyOf(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Recorta [from, to) para que no empiece antes del alta (`since`, día local
 * «YYYY-MM-DD»; null = sin dato: no se recorta). El día de alta cuenta entero.
 * Si el alta es el fin del rango o después, queda vacío (= $0 en salaryForRange).
 */
export function rangeSince(from: string, to: string, since: string | null | undefined): { from: string; to: string } {
  if (!since || since <= from) return { from, to };
  return { from: since, to };
}

/**
 * Sueldo del periodo de Comisiones ("YYYY-MM", mes natural). Con `since` (día
 * de alta) cuenta solo desde ese día: un mes empezado a medias se prorratea
 * por los días de ese mes («aprox.»), y un mes anterior al alta es $0.
 */
export function salaryForPeriodKey(salary: BarberSalary, periodKey: string, since?: string | null): SalaryForRange {
  const { from, to } = periodKeyDays(periodKey);
  const r = rangeSince(from, to, since);
  return salaryForRange(salary, r.from, r.to);
}

/**
 * Renta de silla de [from, to): es MENSUAL y se prorratea por días con la
 * misma regla que un sueldo mensual; con `since`, solo desde el alta.
 */
export function chairRentForRange(rent: Prisma.Decimal.Value | null | undefined, from: string, to: string, since?: string | null): SalaryForRange {
  const amount = new Prisma.Decimal(rent ?? 0);
  const r = rangeSince(from, to, since);
  return salaryForRange({ amount: amount.toNumber(), period: "MONTHLY" }, r.from, r.to);
}

/** ¿El alta cae DENTRO del periodo (después de su primer día)? Entonces renta y sueldo salen proporcionales. */
export function hiredInside(periodKey: string, since: string | null | undefined): string | null {
  if (!since) return null;
  const { from, to } = periodKeyDays(periodKey);
  return since > from && since < to ? since : null;
}
