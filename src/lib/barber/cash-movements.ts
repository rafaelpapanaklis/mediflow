// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — MOVIMIENTOS DE CAJA, lectura/escritura (ws6-t1).
//
// La tabla "barber_cash_movements" y las columnas "countedBreakdown" /
// "leftForNext" de "barber_cash_sessions" nacen en
// sql/barber_caja_completa.sql, que Rafael pega a mano. El cliente de Prisma
// NO las conoce (no se regenera): todo va en SQL crudo, y TODO degrada: sin
// el SQL, cashMovementsReady() = false, nadie lee ni escribe movimientos y la
// caja se ve y cuadra como antes.
//
// Aislamiento: cada consulta lleva "barbershopId" = la sede de la sesión
// (ctx.barbershopId); un id de otra barbería o sede no existe (404).
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import type { BarberPayoutKind, CashMovementMethod, CashMovementType } from "@/lib/barber/caja-movimientos-core";

/** Lo mínimo que se pide de prisma o de una transacción. */
export type MovementsDb = {
  $queryRaw: <T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Prisma.PrismaPromise<T>;
  $executeRaw: (query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Prisma.PrismaPromise<number>;
};

let seen = false;

/** ¿Ya se pegó sql/barber_caja_completa.sql? (tabla Y columnas). Nunca lanza. */
export async function cashMovementsReady(db: MovementsDb): Promise<boolean> {
  if (seen) return true;
  try {
    const rows = await db.$queryRaw<Array<{ n: number; t: boolean }>>`
      SELECT
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'barber_cash_sessions'
            AND column_name IN ('countedBreakdown', 'leftForNext')) AS "n",
        (to_regclass('public.barber_cash_movements') IS NOT NULL) AS "t"
    `;
    const ok = Number(rows[0]?.n ?? 0) === 2 && rows[0]?.t === true;
    if (ok) seen = true;
    return ok;
  } catch {
    return false;
  }
}

/** Solo para las pruebas: olvida lo visto. */
export function resetCashMovementsReadyCache(): void {
  seen = false;
}

// ── DTO ─────────────────────────────────────────────────────────────────

export interface CashMovementRow {
  id: string;
  sessionId: string | null;
  type: CashMovementType;
  method: CashMovementMethod;
  amount: number;
  category: string | null;
  note: string | null;
  barberId: string | null;
  barberName: string | null;
  payoutKind: BarberPayoutKind | null;
  periodKey: string | null;
  /** Hay foto del comprobante (se ve por GET /api/barber/cash-movements/[id]/receipt). */
  hasReceipt: boolean;
  createdAt: string;
  createdByUserId: string;
  createdByName: string;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
}

interface RawMovement {
  id: string;
  sessionId: string | null;
  type: string;
  method: string;
  amount: Prisma.Decimal | string | number;
  category: string | null;
  note: string | null;
  barberId: string | null;
  barberName: string | null;
  barberNick: string | null;
  payoutKind: string | null;
  periodKey: string | null;
  receiptUrl: string | null;
  createdAt: Date;
  createdByUserId: string;
  cFirst: string | null;
  cLast: string | null;
  voidedAt: Date | null;
  vFirst: string | null;
  vLast: string | null;
  voidReason: string | null;
}

function name(first: string | null, last: string | null): string {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

function toRow(r: RawMovement): CashMovementRow {
  return {
    id: r.id,
    sessionId: r.sessionId,
    type: r.type as CashMovementType,
    method: r.method as CashMovementMethod,
    amount: new Prisma.Decimal(r.amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber(),
    category: r.category,
    note: r.note,
    barberId: r.barberId,
    barberName: r.barberId ? r.barberNick || r.barberName || "—" : null,
    payoutKind: (r.payoutKind as BarberPayoutKind | null) ?? null,
    periodKey: r.periodKey,
    hasReceipt: Boolean(r.receiptUrl),
    createdAt: new Date(r.createdAt).toISOString(),
    createdByUserId: r.createdByUserId,
    createdByName: name(r.cFirst, r.cLast),
    voidedAt: r.voidedAt ? new Date(r.voidedAt).toISOString() : null,
    voidedByName: r.voidedAt ? name(r.vFirst, r.vLast) : null,
    voidReason: r.voidReason,
  };
}

const SELECT_MOVEMENT = Prisma.sql`
  SELECT m."id", m."sessionId", m."type", m."method", m."amount", m."category", m."note",
         m."barberId", b."name" AS "barberName", b."nickname" AS "barberNick",
         m."payoutKind", m."periodKey", m."receiptUrl", m."createdAt", m."createdByUserId",
         cu."firstName" AS "cFirst", cu."lastName" AS "cLast",
         m."voidedAt", vu."firstName" AS "vFirst", vu."lastName" AS "vLast", m."voidReason"
  FROM "barber_cash_movements" m
  LEFT JOIN "barber_barbers" b ON b."id" = m."barberId"
  LEFT JOIN "barber_users" cu ON cu."id" = m."createdByUserId"
  LEFT JOIN "barber_users" vu ON vu."id" = m."voidedByUserId"
`;

export interface MovementFilter {
  barbershopId: string;
  /** Movimientos de estos turnos. */
  sessionIds?: string[];
  /** Rango [from, to) por fecha de registro (todos los turnos y los de fuera de caja). */
  from?: Date;
  to?: Date;
  type?: CashMovementType;
  category?: string;
  limit?: number;
}

/** Movimientos de una barbería (siempre filtrados por "barbershopId"), en orden de hora. */
export async function loadMovements(db: MovementsDb, f: MovementFilter): Promise<CashMovementRow[]> {
  if (!f.barbershopId) return [];
  const conds: Prisma.Sql[] = [Prisma.sql`m."barbershopId" = ${f.barbershopId}`];
  if (f.sessionIds) {
    if (f.sessionIds.length === 0) return [];
    conds.push(Prisma.sql`m."sessionId" = ANY(${f.sessionIds}::text[])`);
  }
  if (f.from) conds.push(Prisma.sql`m."createdAt" >= ${f.from}`);
  if (f.to) conds.push(Prisma.sql`m."createdAt" < ${f.to}`);
  if (f.type) conds.push(Prisma.sql`m."type" = ${f.type}`);
  if (f.category) conds.push(Prisma.sql`m."category" = ${f.category}`);
  const limit = Math.min(Math.max(f.limit ?? 2000, 1), 5000);
  const rows = await db.$queryRaw<RawMovement[]>`
    ${SELECT_MOVEMENT}
    WHERE ${Prisma.join(conds, " AND ")}
    ORDER BY m."createdAt" ASC, m."id" ASC
    LIMIT ${limit}
  `;
  return rows.map(toRow);
}

/** Un movimiento de ESTA barbería (null si no existe o es de otra). */
export async function findMovement(db: MovementsDb, barbershopId: string, id: string): Promise<(CashMovementRow & { receiptPath: string | null }) | null> {
  if (!barbershopId || !id) return null;
  const rows = await db.$queryRaw<RawMovement[]>`
    ${SELECT_MOVEMENT}
    WHERE m."id" = ${id} AND m."barbershopId" = ${barbershopId}
  `;
  const r = rows[0];
  return r ? { ...toRow(r), receiptPath: r.receiptUrl } : null;
}

// ── Columnas nuevas del turno ───────────────────────────────────────────

export interface SessionExtras {
  countedBreakdown: Record<string, number> | null;
  leftForNext: number | null;
}

/** Conteo por denominación y fondo dejado de cada turno (solo los que tienen algo). */
export async function loadSessionExtras(db: MovementsDb, barbershopId: string, sessionIds: string[]): Promise<Map<string, SessionExtras>> {
  const out = new Map<string, SessionExtras>();
  if (!barbershopId || sessionIds.length === 0) return out;
  const rows = await db.$queryRaw<Array<{ id: string; countedBreakdown: unknown; leftForNext: Prisma.Decimal | string | number | null }>>`
    SELECT "id", "countedBreakdown", "leftForNext" FROM "barber_cash_sessions"
    WHERE "barbershopId" = ${barbershopId} AND "id" = ANY(${sessionIds}::text[])
  `;
  for (const r of rows) {
    const breakdown =
      r.countedBreakdown && typeof r.countedBreakdown === "object" && !Array.isArray(r.countedBreakdown)
        ? (r.countedBreakdown as Record<string, number>)
        : null;
    out.set(r.id, {
      countedBreakdown: breakdown,
      leftForNext: r.leftForNext === null ? null : new Prisma.Decimal(r.leftForNext).toNumber(),
    });
  }
  return out;
}

// ── Escritura de bajo nivel (sin permisos: las reglas viven en caja-movimientos.ts) ──

/**
 * El turno ABIERTO de la barbería, bloqueado FOR SHARE dentro de la
 * transacción: dos gastos a la vez entran los dos, pero el cierre (que toma
 * FOR UPDATE) espera a que terminen y un gasto que llega después del cierre
 * ya no encuentra turno abierto. null = no hay caja abierta.
 */
export async function lockOpenSessionShared(db: MovementsDb, barbershopId: string): Promise<{ id: string } | null> {
  if (!barbershopId) return null;
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "barber_cash_sessions"
    WHERE "barbershopId" = ${barbershopId} AND "closedAt" IS NULL
    ORDER BY "openedAt" DESC LIMIT 1
    FOR SHARE
  `;
  return rows[0] ?? null;
}

/** ¿Este turno de ESTA barbería sigue abierto? (FOR SHARE: el cierre espera). */
export async function lockSessionIfOpen(db: MovementsDb, barbershopId: string, sessionId: string): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "barber_cash_sessions"
    WHERE "id" = ${sessionId} AND "barbershopId" = ${barbershopId} AND "closedAt" IS NULL
    FOR SHARE
  `;
  return rows.length > 0;
}

export interface NewMovement {
  id: string;
  barbershopId: string;
  sessionId: string | null;
  type: CashMovementType;
  method: CashMovementMethod;
  /** Ya validado (> 0, 2 decimales). */
  amount: Prisma.Decimal;
  category: string | null;
  note: string | null;
  barberId: string | null;
  payoutKind: BarberPayoutKind | null;
  periodKey: string | null;
  receiptUrl: string | null;
  createdByUserId: string;
  createdAt: Date;
}

export async function insertMovement(db: MovementsDb, m: NewMovement): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "barber_cash_movements"
      ("id", "barbershopId", "sessionId", "type", "method", "amount", "category", "note",
       "barberId", "payoutKind", "periodKey", "receiptUrl", "createdByUserId", "createdAt")
    VALUES (${m.id}, ${m.barbershopId}, ${m.sessionId}, ${m.type}, ${m.method}, ${m.amount.toFixed(2)}::numeric,
            ${m.category}, ${m.note}, ${m.barberId}, ${m.payoutKind}, ${m.periodKey}, ${m.receiptUrl},
            ${m.createdByUserId}, ${m.createdAt})
  `;
}

/** Anula (nunca borra). 0 = ya estaba anulado o no es de esta barbería. */
export async function markMovementVoided(
  db: MovementsDb,
  p: { barbershopId: string; id: string; userId: string; reason: string | null; now: Date },
): Promise<number> {
  return db.$executeRaw`
    UPDATE "barber_cash_movements"
    SET "voidedAt" = ${p.now}, "voidedByUserId" = ${p.userId}, "voidReason" = ${p.reason}
    WHERE "id" = ${p.id} AND "barbershopId" = ${p.barbershopId} AND "voidedAt" IS NULL
  `;
}

/** Adelantos/vales VIVOS por barbero en un periodo de Comisiones («YYYY-MM»). */
export async function sumAdvances(
  db: MovementsDb,
  p: { barbershopId: string; barberIds: string[]; periodKey: string },
): Promise<Map<string, Prisma.Decimal>> {
  const out = new Map<string, Prisma.Decimal>();
  if (!p.barbershopId || p.barberIds.length === 0) return out;
  const rows = await db.$queryRaw<Array<{ barberId: string; total: Prisma.Decimal | string | number }>>`
    SELECT "barberId", SUM("amount") AS "total" FROM "barber_cash_movements"
    WHERE "barbershopId" = ${p.barbershopId} AND "type" = 'BARBER_PAYOUT' AND "payoutKind" = 'ADVANCE'
      AND "periodKey" = ${p.periodKey} AND "voidedAt" IS NULL
      AND "barberId" = ANY(${p.barberIds}::text[])
    GROUP BY "barberId"
  `;
  for (const r of rows) out.set(r.barberId, new Prisma.Decimal(r.total));
  return out;
}

/** El fondo que se dejó en el ÚLTIMO corte de la barbería (para sugerirlo al abrir). */
export async function lastLeftForNext(db: MovementsDb, barbershopId: string): Promise<number | null> {
  if (!barbershopId) return null;
  const rows = await db.$queryRaw<Array<{ leftForNext: Prisma.Decimal | string | number | null }>>`
    SELECT "leftForNext" FROM "barber_cash_sessions"
    WHERE "barbershopId" = ${barbershopId} AND "closedAt" IS NOT NULL
    ORDER BY "closedAt" DESC LIMIT 1
  `;
  const v = rows[0]?.leftForNext;
  return v === null || v === undefined ? null : new Prisma.Decimal(v).toNumber();
}
