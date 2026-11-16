// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — CAJA COMPLETA: registrar y anular movimientos (ws6-t1).
//
// Reglas (todas se hacen valer AQUÍ, en el servidor):
//  · barbershopId sale SIEMPRE del contexto (la sede de la sesión); un id
//    de otra barbería o sede → 404, sin decir si existe.
//  · Permisos: gasto y entrada → cash.expenses; sacar efectivo y pagar a
//    barbero → cash.withdraw (anular, lo mismo que registrar).
//  · El ÚNICO campo obligatorio es el monto (> 0, 2 decimales). Categoría,
//    nota y comprobante son opcionales. Un pago a barbero dice a quién.
//  · Sacar y meter efectivo son siempre efectivo y exigen caja abierta.
//    Un gasto (o un adelanto) NO exige caja abierta: con caja abierta cae
//    en ella; sin caja, queda «fuera de caja» y la respuesta lo dice.
//  · Anular nunca borra: queda tachado con quién y cuándo. Solo con su caja
//    abierta (un gasto fuera de caja se puede anular siempre). Un pago de
//    comisión/sueldo hecho en Comisiones no se anula desde Caja.
//  · Pagos de comisión y sueldo NO se registran aquí: van por
//    markCommissionsPaid (un solo registro de pago + su movimiento).
//  · Sin sql/barber_caja_completa.sql → 409 CAJA_SQL_PENDING.
// ═══════════════════════════════════════════════════════════════════════
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertBarberPermission, type BarberContext } from "@/lib/barber-auth";
import type { BarberPermissionKey } from "@/lib/barber/permissions";
import {
  BarberCajaError,
  DEFAULT_BARBER_TZ,
  isValidPeriodKey,
  periodKeyFor,
  periodRange,
} from "@/lib/barber/commissions";
import {
  AMOUNT_ERROR_MESSAGES,
  CASH_ONLY_TYPES,
  cleanOptionalText,
  isBarberPayoutKind,
  isCashExpenseCategory,
  isCashMovementMethod,
  isCashMovementType,
  parseMovementAmount,
  type CashMovementMethod,
  type CashMovementType,
} from "@/lib/barber/caja-movimientos-core";
import {
  cashMovementsReady,
  findMovement,
  insertMovement,
  loadMovements,
  lockOpenSessionShared,
  lockSessionIfOpen,
  markMovementVoided,
  type CashMovementRow,
} from "@/lib/barber/cash-movements";
import { cajaResumen, type CajaResumen } from "@/lib/barber/caja-resumen";

/** Qué llave pide cada tipo de movimiento. */
export function permissionForMovement(type: CashMovementType): BarberPermissionKey {
  return type === "EXPENSE" || type === "DEPOSIT" ? "cash.expenses" : "cash.withdraw";
}

export async function assertCashMovementsReady(): Promise<void> {
  if (!(await cashMovementsReady(prisma))) {
    throw new BarberCajaError(
      409,
      "CAJA_SQL_PENDING",
      "Falta aplicar sql/barber_caja_completa.sql: todavía no se pueden registrar gastos ni retiros.",
    );
  }
}

/** Carpeta del comprobante en el bucket privado: siempre la de ESTA barbería. */
export function receiptFolder(barbershopId: string): string {
  return `cash/${barbershopId}/`;
}

/** ¿Esa ruta de comprobante es de esta barbería y tiene la forma que da la subida? */
export function isOwnReceiptPath(barbershopId: string, path: unknown): path is string {
  if (typeof path !== "string") return false;
  const prefix = receiptFolder(barbershopId);
  return path.startsWith(prefix) && /^[\w-]+\/[\w-]+\/\d{4}-\d{2}\/[\w-]+\.webp$/.test(path) && !path.includes("..");
}

export interface CreateMovementResult {
  movement: CashMovementRow;
  /** Se registró sin caja abierta (gasto fuera de caja). */
  outsideSession: boolean;
}

/**
 * Registra un gasto, retiro, entrada o adelanto/otro pago a barbero.
 * `input` es el JSON del cliente tal cual: aquí se valida todo.
 */
export async function createCashMovement(
  ctx: BarberContext,
  input: Record<string, unknown>,
  now: Date = new Date(),
): Promise<CreateMovementResult> {
  const barbershopId = ctx.barbershopId;
  if (!barbershopId) throw new BarberCajaError(401, "NO_SHOP", "Sin barbería");
  if (!isCashMovementType(input.type)) {
    throw new BarberCajaError(400, "INVALID_TYPE", "Tipo de movimiento inválido (gasto, retiro, entrada o pago a barbero).");
  }
  const type = input.type;
  assertBarberPermission(ctx, permissionForMovement(type));
  await assertCashMovementsReady();

  const amount = parseMovementAmount(input.amount);
  if (!amount.ok) throw new BarberCajaError(400, "INVALID_AMOUNT", AMOUNT_ERROR_MESSAGES[amount.error]);

  let method: CashMovementMethod = "CASH";
  if (input.method !== undefined && input.method !== null && input.method !== "") {
    if (!isCashMovementMethod(input.method)) throw new BarberCajaError(400, "INVALID_METHOD", "¿Con qué se pagó? Efectivo, tarjeta, transferencia u otro.");
    method = input.method;
  }
  if (CASH_ONLY_TYPES.includes(type) && method !== "CASH") {
    throw new BarberCajaError(400, "INVALID_METHOD", "Sacar y meter dinero a la caja es siempre en efectivo.");
  }

  let category: string | null = null;
  if (type === "EXPENSE" && input.category !== undefined && input.category !== null && input.category !== "") {
    if (!isCashExpenseCategory(input.category)) throw new BarberCajaError(400, "INVALID_CATEGORY", "Categoría de gasto inválida.");
    category = input.category;
  }

  let barberId: string | null = null;
  let payoutKind: "ADVANCE" | "OTHER" | null = null;
  let periodKey: string | null = null;
  if (type === "BARBER_PAYOUT") {
    const kind = input.payoutKind ?? "ADVANCE";
    if (!isBarberPayoutKind(kind)) throw new BarberCajaError(400, "INVALID_PAYOUT_KIND", "Tipo de pago inválido.");
    if (kind === "COMMISSION" || kind === "SALARY") {
      throw new BarberCajaError(
        400,
        "USE_COMMISSIONS_PAYOUT",
        "La comisión y el sueldo se pagan con «Marcar pagado» (desde Caja o desde Comisiones), para no registrarlos dos veces.",
      );
    }
    payoutKind = kind;
    if (typeof input.barberId !== "string" || !input.barberId) {
      throw new BarberCajaError(400, "BARBER_REQUIRED", "¿A qué barbero le pagas?");
    }
    const barber = await prisma.barber.findFirst({ where: { id: input.barberId, barbershopId }, select: { id: true } });
    if (!barber) throw new BarberCajaError(404, "BARBER_NOT_FOUND", "Barbero no encontrado");
    barberId = barber.id;
    periodKey = periodKeyFor(now, ctx.barbershop.timezone || DEFAULT_BARBER_TZ);
  }

  let receiptUrl: string | null = null;
  if (input.receiptPath !== undefined && input.receiptPath !== null && input.receiptPath !== "") {
    if (!isOwnReceiptPath(barbershopId, input.receiptPath)) throw new BarberCajaError(400, "INVALID_RECEIPT", "Comprobante inválido: vuelve a subir la foto.");
    receiptUrl = input.receiptPath;
  }

  const note = cleanOptionalText(input.note);
  const id = randomUUID();

  const result = await prisma.$transaction(
    async (tx) => {
      const session = await lockOpenSessionShared(tx, barbershopId);
      if (!session && CASH_ONLY_TYPES.includes(type)) {
        throw new BarberCajaError(409, "NO_OPEN_SESSION", "No hay caja abierta: ábrela para sacar o meter efectivo.");
      }
      await insertMovement(tx, {
        id,
        barbershopId,
        sessionId: session?.id ?? null,
        type,
        method,
        amount: new Prisma.Decimal(amount.cents).dividedBy(100),
        category,
        note,
        barberId,
        payoutKind,
        periodKey,
        receiptUrl,
        createdByUserId: ctx.barberUserId,
        createdAt: now,
      });
      return { outsideSession: !session };
    },
    { maxWait: 5000, timeout: 15000 },
  );

  const movement = await findMovement(prisma, barbershopId, id);
  if (!movement) throw new BarberCajaError(500, "INTERNAL", "No se pudo leer el movimiento recién guardado");
  const { receiptPath: _omit, ...row } = movement;
  return { movement: row, outsideSession: result.outsideSession };
}

/** Anula un movimiento (nunca borra). Motivo opcional. */
export async function voidCashMovement(
  ctx: BarberContext,
  movementId: string,
  input: { reason?: unknown },
  now: Date = new Date(),
): Promise<CashMovementRow> {
  const barbershopId = ctx.barbershopId;
  if (!barbershopId) throw new BarberCajaError(401, "NO_SHOP", "Sin barbería");
  await assertCashMovementsReady();
  const found = await findMovement(prisma, barbershopId, movementId);
  if (!found) throw new BarberCajaError(404, "MOVEMENT_NOT_FOUND", "Movimiento no encontrado");
  assertBarberPermission(ctx, permissionForMovement(found.type));
  if (found.voidedAt) throw new BarberCajaError(409, "ALREADY_VOIDED", "Ese movimiento ya estaba anulado.");
  if (found.type === "BARBER_PAYOUT" && (found.payoutKind === "COMMISSION" || found.payoutKind === "SALARY")) {
    throw new BarberCajaError(
      409,
      "LINKED_PAYOUT",
      "Ese pago se marcó en Comisiones (comisión o sueldo) y no se anula desde Caja.",
    );
  }
  const reason = cleanOptionalText(input.reason, 300);

  await prisma.$transaction(
    async (tx) => {
      if (found.sessionId && !(await lockSessionIfOpen(tx, barbershopId, found.sessionId))) {
        throw new BarberCajaError(409, "SESSION_CLOSED", "Esa caja ya se cerró: su corte no se toca.");
      }
      const n = await markMovementVoided(tx, { barbershopId, id: found.id, userId: ctx.barberUserId, reason, now });
      if (n === 0) throw new BarberCajaError(409, "ALREADY_VOIDED", "Ese movimiento ya estaba anulado.");
    },
    { maxWait: 5000, timeout: 15000 },
  );
  const after = await findMovement(prisma, barbershopId, found.id);
  const { receiptPath: _omit, ...row } = after!;
  return row;
}

export interface ExpensesList {
  periodKey: string;
  category: string | null;
  /** Todos los gastos del mes (anulados incluidos, marcados), en orden de hora. */
  items: CashMovementRow[];
  /** Totales de los vivos: total, por categoría y por medio. */
  resumen: CajaResumen["expenses"];
}

/** Pestaña Gastos: TODOS los gastos de un mes (con caja o fuera de caja). cash.view. */
export async function listExpenses(
  ctx: BarberContext,
  params: { periodKey?: unknown; category?: unknown },
  now: Date = new Date(),
): Promise<ExpensesList> {
  assertBarberPermission(ctx, "cash.view");
  await assertCashMovementsReady();
  const tz = ctx.barbershop.timezone || DEFAULT_BARBER_TZ;
  const periodKey = isValidPeriodKey(params.periodKey) ? (params.periodKey as string) : periodKeyFor(now, tz);
  const category = isCashExpenseCategory(params.category) ? params.category : null;
  const { start, end } = periodRange(periodKey, tz);
  const items = await loadMovements(prisma, {
    barbershopId: ctx.barbershopId,
    type: "EXPENSE",
    from: start,
    to: end,
    ...(category ? { category } : {}),
  });
  return { periodKey, category, items, resumen: cajaResumen({ openingAmount: 0, tickets: [], movements: items }).expenses };
}

/** La ruta del comprobante de un movimiento de ESTA barbería (para firmarla). cash.view. */
export async function receiptPathOf(ctx: BarberContext, movementId: string): Promise<string | null> {
  assertBarberPermission(ctx, "cash.view");
  await assertCashMovementsReady();
  const m = await findMovement(prisma, ctx.barbershopId, movementId);
  if (!m) throw new BarberCajaError(404, "MOVEMENT_NOT_FOUND", "Movimiento no encontrado");
  return m.receiptPath && isOwnReceiptPath(ctx.barbershopId, m.receiptPath) ? m.receiptPath : null;
}
