// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — SUELDO DEL BARBERO, lectura/escritura (ws6-t6).
//
// Las columnas ("salaryAmount", "salaryPeriod") y la tabla
// "barber_salary_payments" nacen en sql/barber_sueldo.sql, que Rafael pega a
// mano. El cliente de Prisma NO las conoce (no se regenera): todo va en SQL
// crudo, y TODO degrada: sin el SQL, salaryReady() = false, nadie lee ni
// escribe y la pantalla se ve como hoy.
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { isSalaryPeriod, type BarberSalary, type BarberSalaryPeriod } from "@/lib/barber/sueldo-core";

/** Lo mínimo que se pide de prisma o de una transacción. */
export type SalaryDb = {
  $queryRaw: <T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Prisma.PrismaPromise<T>;
  $executeRaw: (query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Prisma.PrismaPromise<number>;
};

let seen = false;

/** ¿Ya se pegó sql/barber_sueldo.sql? (columnas Y tabla). Nunca lanza. */
export async function salaryReady(db: SalaryDb): Promise<boolean> {
  if (seen) return true;
  try {
    const rows = await db.$queryRaw<Array<{ n: number; t: boolean }>>`
      SELECT
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'barber_barbers'
            AND column_name IN ('salaryAmount', 'salaryPeriod')) AS "n",
        (to_regclass('public.barber_salary_payments') IS NOT NULL) AS "t"
    `;
    const ok = Number(rows[0]?.n ?? 0) === 2 && rows[0]?.t === true;
    if (ok) seen = true;
    return ok;
  } catch {
    return false;
  }
}

/** Solo para las pruebas: olvida lo visto. */
export function resetSalaryReadyCache(): void {
  seen = false;
}

/** Sueldo guardado de cada barbero (null = sin sueldo). Sin ids, mapa vacío. */
export async function loadSalaries(db: SalaryDb, barberIds: string[]): Promise<Map<string, BarberSalary | null>> {
  const out = new Map<string, BarberSalary | null>();
  if (barberIds.length === 0) return out;
  const rows = await db.$queryRaw<Array<{ id: string; salaryAmount: Prisma.Decimal | string | number | null; salaryPeriod: string | null }>>`
    SELECT "id", "salaryAmount", "salaryPeriod" FROM "barber_barbers" WHERE "id" = ANY(${barberIds}::text[])
  `;
  for (const r of rows) {
    const amount = r.salaryAmount === null ? null : Number(r.salaryAmount);
    out.set(r.id, amount !== null && amount > 0 && isSalaryPeriod(r.salaryPeriod) ? { amount, period: r.salaryPeriod } : null);
  }
  return out;
}

/** Guarda (o quita, con null) el sueldo de UN barbero ya validado por su sede. */
export async function saveSalary(db: SalaryDb, barberId: string, salary: BarberSalary | null): Promise<void> {
  const amount = salary ? new Prisma.Decimal(salary.amount).toFixed(2) : null;
  const period: BarberSalaryPeriod | null = salary ? salary.period : null;
  await db.$executeRaw`
    UPDATE "barber_barbers" SET "salaryAmount" = ${amount}::numeric, "salaryPeriod" = ${period}
    WHERE "id" = ${barberId}
  `;
}

/** Sueldo YA PAGADO por barbero en el periodo (monto congelado al pagar). */
export async function loadSalaryPaid(
  db: SalaryDb,
  args: { barbershopId: string; barberIds: string[]; periodKey: string },
): Promise<Map<string, { amount: Prisma.Decimal; paidAt: Date }>> {
  const out = new Map<string, { amount: Prisma.Decimal; paidAt: Date }>();
  if (args.barberIds.length === 0) return out;
  const rows = await db.$queryRaw<Array<{ barberId: string; amount: Prisma.Decimal | string | number; paidAt: Date }>>`
    SELECT "barberId", "amount", "paidAt" FROM "barber_salary_payments"
    WHERE "barbershopId" = ${args.barbershopId} AND "periodKey" = ${args.periodKey}
      AND "barberId" = ANY(${args.barberIds}::text[])
  `;
  for (const r of rows) out.set(r.barberId, { amount: new Prisma.Decimal(r.amount), paidAt: new Date(r.paidAt) });
  return out;
}

/**
 * Registra el sueldo pagado del periodo. Un renglón por barbero y periodo
 * (índice único): si ya existía, no hace nada y devuelve false.
 */
export async function insertSalaryPayment(
  db: SalaryDb,
  p: {
    id: string;
    barbershopId: string;
    barberId: string;
    periodKey: string;
    amount: Prisma.Decimal;
    approx: boolean;
    salary: BarberSalary;
    paidAt: Date;
    paidByUserId: string | null;
  },
): Promise<boolean> {
  const n = await db.$executeRaw`
    INSERT INTO "barber_salary_payments"
      ("id", "barbershopId", "barberId", "periodKey", "amount", "approx", "salaryAmount", "salaryPeriod", "paidAt", "paidByUserId")
    VALUES (${p.id}, ${p.barbershopId}, ${p.barberId}, ${p.periodKey}, ${p.amount.toFixed(2)}::numeric, ${p.approx},
            ${new Prisma.Decimal(p.salary.amount).toFixed(2)}::numeric, ${p.salary.period}, ${p.paidAt}, ${p.paidByUserId})
    ON CONFLICT ("barberId", "periodKey") DO NOTHING
  `;
  return n > 0;
}
