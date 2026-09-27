// Inventario B (WS1-T5) — capa de Prisma sobre las reglas puras de
// lots-core.ts: lotes, reconciliación con el agregado de InventoryItem,
// consumo FEFO transaccional y avisos de caducidad.
//
// Tolerancia a que el SQL aún no esté aplicado (regla común de la ola):
// cualquier lectura sobre las tablas nuevas que reciba P2021/P2022 se trata
// como "todavía no hay nada de lotes" (listas vacías, sin avisos), nunca
// tumba la pantalla. Las escrituras si fallan por lo mismo SÍ se propagan:
// no tiene sentido fingir que un lote se creó cuando no hay dónde guardarlo.
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ALERT_DAYS_DEFAULT,
  isExpired,
  isExpiringSoon,
  planFefoConsumption,
  round3,
  type FefoInsufficient,
  type FefoPlan,
  type LotForFefo,
} from "./lots-core";

type Tx = Prisma.TransactionClient | PrismaClient;
/** Inyectable para pruebas (mismo patrón que src/lib/anticipos/panel.server.ts): las
 * funciones de arriba reciben `db` opcional, por defecto el `prisma` real. Las
 * pruebas pasan un doble en memoria — ver __tests__/lots-server.test.ts. */
export type Db = Tx;

// P2021/P2022 = la tabla/columna no existe (el SQL aún no está aplicado).
// El TypeError es el mismo caso visto desde OTRO ángulo: un proceso de
// `next dev` que ya tenía el singleton de Prisma vivo (globalForPrisma, ver
// src/lib/prisma.ts) desde ANTES de correr `npx prisma generate` no
// reconstruye el cliente solo porque el archivo generado cambió en disco —
// Next.js recarga el código de la app, no el singleton ya instanciado. Ese
// proceso nunca llega a lanzar P2021: `db.inventoryLot` es `undefined` y
// Prisma ni se entera. Medido en vivo en dev.108 el 27-sep-2026.
// Ajuste 2 (aviso de ws1-t4, §6 de su reporte): un campo NUEVO en un modelo
// VIEJO (InventoryItem.quantityPrecise, TreatmentSession.procedureId) no da
// TypeError — el delegate SÍ existe, el modelo es antiguo — da
// PrismaClientValidationError: el cliente viejo valida la FORMA de `data`
// contra su DMMF (lo que sabía al generarse) antes de tocar la base, y
// rechaza una llave que no conoce, con cualquier valor, incluido `null`.
function isMissingRelation(e: any): boolean {
  if (e?.code === "P2021" || e?.code === "P2022") return true;
  if (e instanceof Prisma.PrismaClientValidationError) return true;
  if (e instanceof TypeError && /Cannot read propert(y|ies) of undefined/.test(e.message ?? "")) return true;
  return false;
}

/** Export para las rutas: mismo criterio, para devolver 503 en vez de 500 crudo. */
export const esErrorDeLotesNoAplicados = isMissingRelation;

export class InsufficientStockError extends Error {
  code = "INSUFFICIENT_STOCK" as const;
  constructor(public itemId: string, public itemName: string, public needed: number, public available: number) {
    super(`Stock insuficiente de "${itemName}": disponible ${available}, necesitas ${needed}`);
  }
}

export class LotesNoDisponiblesError extends Error {
  code = "LOTES_NO_DISPONIBLES" as const;
  constructor() {
    super("El SQL de lotes (sql/inventario-lotes-caducidad-t5.sql) todavía no está aplicado en esta base.");
  }
}

// ── Configuración de avisos (InventoryAlertSettings) ───────────────────────

export async function getAlertDaysAhead(clinicId: string, db: Db = prisma): Promise<number> {
  try {
    const row = await (db as PrismaClient).inventoryAlertSettings.findUnique({ where: { clinicId } });
    return row?.alertDaysAhead ?? ALERT_DAYS_DEFAULT;
  } catch (e) {
    if (isMissingRelation(e)) return ALERT_DAYS_DEFAULT;
    throw e;
  }
}

export async function setAlertDaysAhead(clinicId: string, days: number, db: Db = prisma): Promise<number> {
  const clamped = Math.min(365, Math.max(1, Math.round(days)));
  await (db as PrismaClient).inventoryAlertSettings.upsert({
    where:  { clinicId },
    create: { clinicId, alertDaysAhead: clamped },
    update: { alertDaysAhead: clamped },
  });
  return clamped;
}

// ── Lectura de lotes ────────────────────────────────────────────────────

export interface LotDTO {
  id: string;
  lotNumber: string | null;
  expiresAt: string | null;
  quantity: number;
  remaining: number;
  unitCost: number | null;
  purchaseLineId: string | null;
  createdAt: string;
  estado: "ok" | "por_caducar" | "caducado";
}

export async function listLotsForItem(clinicId: string, itemId: string, db: Db = prisma): Promise<LotDTO[]> {
  try {
    // Ajuste 1 del gerente: reconciliar ANTES de listar, no solo antes de
    // consumir. Así "Lotes" nunca sale vacío mientras el artículo tenga
    // existencias reales — no hace falta esperar al primer consumo (ni al
    // backfill SQL, que ahora es opcional) para que el lote "sin lote"
    // aparezca con la cantidad de HOY.
    await (db as PrismaClient).$transaction(tx => reconcileAndLock(tx, clinicId, itemId));

    const [lots, alertDays] = await Promise.all([
      (db as PrismaClient).inventoryLot.findMany({
        where:   { clinicId, itemId },
        orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
      }),
      getAlertDaysAhead(clinicId, db),
    ]);
    const now = new Date();
    return lots.map(l => ({
      id:             l.id,
      lotNumber:      l.lotNumber,
      expiresAt:      l.expiresAt ? l.expiresAt.toISOString() : null,
      quantity:       Number(l.quantity),
      remaining:      Number(l.remaining),
      unitCost:       l.unitCost,
      purchaseLineId: l.purchaseLineId,
      createdAt:      l.createdAt.toISOString(),
      estado: isExpired(l.expiresAt, now)
        ? "caducado"
        : isExpiringSoon(l.expiresAt, now, alertDays)
        ? "por_caducar"
        : "ok",
    }));
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}

// ── Reconciliación: alinea los lotes con InventoryItem.quantity ───────────
//
// Se llama SIEMPRE antes de crear un lote, consumir o dar de baja, con el
// item YA bloqueado (FOR UPDATE) por el llamador. Cubre el drift que deja
// cualquier alta/baja de existencias que NO pasa por el sistema de lotes:
// el ajuste manual de hoy (api/inventory/[id]/route.ts) o una compra futura
// de ws1-t4. El lote "sin lote" (lotNumber NULL) es el colchón: absorbe lo
// que sobra o presta lo que falta.

interface LotRow {
  id: string;
  lotNumber: string | null;
  expiresAt: Date | null;
  remaining: Prisma.Decimal | number;
}

async function ensureSinLote(tx: Tx, clinicId: string, itemId: string): Promise<string> {
  const existing = await (tx as PrismaClient).inventoryLot.findFirst({
    where: { clinicId, itemId, lotNumber: null },
  });
  if (existing) return existing.id;
  const created = await (tx as PrismaClient).inventoryLot.create({
    data: { clinicId, itemId, lotNumber: null, expiresAt: null, quantity: 0, remaining: 0 },
  });
  return created.id;
}

async function reconcileAndLock(tx: Tx, clinicId: string, itemId: string): Promise<LotForFefo[]> {
  // Bloquea el artículo: serializa cualquier consumo/alta/baja concurrente
  // sobre este mismo artículo (mismo patrón que el FOR UPDATE de facturas).
  const itemRows = await (tx as PrismaClient).$queryRaw<{ quantity: number; quantityPrecise: Prisma.Decimal | null }[]>`
    SELECT "quantity", "quantityPrecise" FROM "inventory_items" WHERE "id" = ${itemId} AND "clinicId" = ${clinicId} FOR UPDATE
  `;
  const item = itemRows[0];
  if (!item) throw new Error("Insumo no encontrado");

  await (tx as PrismaClient).$queryRaw`SELECT "id" FROM "inventory_lots" WHERE "itemId" = ${itemId} FOR UPDATE`;
  const lots = await (tx as PrismaClient).inventoryLot.findMany({ where: { clinicId, itemId } });

  if (lots.length === 0) {
    const aggregate = item.quantityPrecise != null ? Number(item.quantityPrecise) : item.quantity;
    const nuevo = await (tx as PrismaClient).inventoryLot.create({
      data: { clinicId, itemId, lotNumber: null, expiresAt: null, quantity: aggregate, remaining: aggregate },
    });
    return [{ id: nuevo.id, expiresAt: null, remaining: round3(aggregate) }];
  }

  const aggregate  = item.quantityPrecise != null ? Number(item.quantityPrecise) : item.quantity;
  const asFefo: LotForFefo[] = lots.map(l => ({ id: l.id, expiresAt: l.expiresAt, remaining: Number(l.remaining) }));
  const lotsSum = round3(asFefo.reduce((s, l) => s + Math.max(0, l.remaining), 0));
  const delta   = round3(aggregate - lotsSum);

  if (delta === 0) return asFefo;

  const sinLoteId = await ensureSinLote(tx, clinicId, itemId);

  if (delta > 0) {
    // Faltan unidades en los lotes: alguien subió existencias fuera del
    // sistema de lotes. Engorda el sin-lote.
    await (tx as PrismaClient).inventoryLot.update({
      where: { id: sinLoteId },
      data:  { remaining: { increment: delta }, quantity: { increment: delta } },
    });
    await (tx as PrismaClient).inventoryLotMovement.create({
      data: { lotId: sinLoteId, clinicId, change: delta, reason: "Reconciliación: alta de existencias fuera del sistema de lotes" },
    });
  } else {
    // Sobran unidades en los lotes (una baja manual bajó el agregado sin
    // tocar lotes): se recorta, primero del sin-lote, luego por FEFO.
    const refreshed = await (tx as PrismaClient).inventoryLot.findMany({ where: { clinicId, itemId } });
    const refreshedFefo: LotForFefo[] = refreshed.map(l => ({ id: l.id, expiresAt: l.expiresAt, remaining: Number(l.remaining) }));
    const plan = planFefoConsumption(refreshedFefo, -delta, sinLoteId);
    if (plan.ok) {
      for (const alloc of plan.allocations) {
        await (tx as PrismaClient).inventoryLot.update({
          where: { id: alloc.lotId },
          data:  { remaining: { decrement: alloc.qty } },
        });
        await (tx as PrismaClient).inventoryLotMovement.create({
          data: { lotId: alloc.lotId, clinicId, change: -alloc.qty, reason: "Reconciliación: baja de existencias fuera del sistema de lotes" },
        });
      }
    }
    // Si ni así alcanza (no debería pasar: lotsSum > aggregate implica que
    // hay al menos -delta disponible), se deja como está — no se inventa
    // stock negativo. La próxima reconciliación lo vuelve a intentar.
  }

  const final = await (tx as PrismaClient).inventoryLot.findMany({ where: { clinicId, itemId } });
  return final.map(l => ({ id: l.id, expiresAt: l.expiresAt, remaining: Number(l.remaining) }));
}

async function syncItemAggregate(tx: Tx, clinicId: string, itemId: string): Promise<void> {
  const lots = await (tx as PrismaClient).inventoryLot.findMany({ where: { clinicId, itemId }, select: { remaining: true } });
  const sum  = round3(lots.reduce((s, l) => s + Math.max(0, Number(l.remaining)), 0));
  try {
    await (tx as PrismaClient).inventoryItem.update({
      where: { id: itemId },
      data:  { quantity: Math.max(0, Math.round(sum)), quantityPrecise: sum },
    });
  } catch (e) {
    // Ajuste 2: quantityPrecise es un campo NUEVO en InventoryItem (modelo
    // viejo) — un cliente de Prisma sin reiniciar desde antes de este schema
    // no lo reconoce y rechaza el `data` completo con PrismaClientValidationError,
    // aunque `quantity` sí sea válido. Se reintenta SOLO con `quantity`: el
    // agregado que lee el resto del panel se mantiene correcto igual; el
    // espejo decimal se pone al día solo cuando el proceso se reinicie.
    if (!isMissingRelation(e)) throw e;
    await (tx as PrismaClient).inventoryItem.update({
      where: { id: itemId },
      data:  { quantity: Math.max(0, Math.round(sum)) },
    });
  }
}

// ── Alta de lote ────────────────────────────────────────────────────────

export async function createLot(params: {
  clinicId: string;
  itemId: string;
  lotNumber: string | null;
  expiresAt: Date | null;
  quantity: number;
  unitCost: number | null;
  purchaseLineId: string | null;
  userId?: string | null;
}, db: Db = prisma): Promise<LotDTO> {
  if (params.quantity <= 0) throw new Error("La cantidad del lote debe ser mayor a 0");

  return (db as PrismaClient).$transaction(async tx => {
    await reconcileAndLock(tx, params.clinicId, params.itemId);

    const qty = round3(params.quantity);
    const lot = await (tx as PrismaClient).inventoryLot.create({
      data: {
        clinicId:       params.clinicId,
        itemId:         params.itemId,
        lotNumber:      params.lotNumber,
        expiresAt:      params.expiresAt,
        quantity:       qty,
        remaining:      qty,
        unitCost:       params.unitCost,
        purchaseLineId: params.purchaseLineId,
      },
    });
    await (tx as PrismaClient).inventoryLotMovement.create({
      data: { lotId: lot.id, clinicId: params.clinicId, change: qty, reason: "Alta de lote", userId: params.userId ?? null },
    });
    await (tx as PrismaClient).inventoryHistory.create({
      // ws1-t4: clinicId/userId/type — ya los tenías en params, solo faltaba
      // pasarlos (ver la nota del bloque de InventoryHistory en schema.prisma).
      data: {
        itemId: params.itemId, change: Math.round(qty),
        reason: `Alta de lote${params.lotNumber ? ` ${params.lotNumber}` : ""}`,
        clinicId: params.clinicId, userId: params.userId ?? null,
        type: params.purchaseLineId ? "purchase" : "adjust",
      },
    });
    await syncItemAggregate(tx, params.clinicId, params.itemId);

    return {
      id:             lot.id,
      lotNumber:      lot.lotNumber,
      expiresAt:      lot.expiresAt ? lot.expiresAt.toISOString() : null,
      quantity:       Number(lot.quantity),
      remaining:      Number(lot.remaining),
      unitCost:       lot.unitCost,
      purchaseLineId: lot.purchaseLineId,
      createdAt:      lot.createdAt.toISOString(),
      estado:         "ok" as const,
    };
  });
}

// ── Baja por caducidad ──────────────────────────────────────────────────

export async function writeOffExpiredLot(params: {
  clinicId: string;
  lotId: string;
  userId?: string | null;
  reason?: string;
}, db: Db = prisma): Promise<void> {
  await (db as PrismaClient).$transaction(async tx => {
    const lot = await (tx as PrismaClient).inventoryLot.findFirst({ where: { id: params.lotId, clinicId: params.clinicId } });
    if (!lot) throw new Error("Lote no encontrado");

    await reconcileAndLock(tx, params.clinicId, lot.itemId);

    const fresh = await (tx as PrismaClient).inventoryLot.findUniqueOrThrow({ where: { id: params.lotId } });
    const remaining = Number(fresh.remaining);
    if (remaining <= 0) return;

    await (tx as PrismaClient).inventoryLot.update({ where: { id: params.lotId }, data: { remaining: 0 } });
    await (tx as PrismaClient).inventoryLotMovement.create({
      data: {
        lotId:    params.lotId,
        clinicId: params.clinicId,
        change:   -remaining,
        reason:   params.reason ?? "Caducado — dado de baja",
        userId:   params.userId ?? null,
      },
    });
    await (tx as PrismaClient).inventoryHistory.create({
      // ws1-t4: clinicId/userId/type.
      data: {
        itemId: lot.itemId, change: -Math.round(remaining),
        reason: params.reason ?? "Caducado — dado de baja",
        clinicId: params.clinicId, userId: params.userId ?? null, type: "adjust",
      },
    });
    await syncItemAggregate(tx, params.clinicId, lot.itemId);
  });
}

// ── Consumo FEFO transaccional ──────────────────────────────────────────
//
// SIEMPRE dentro de una transacción abierta por el llamador (tx): así el
// descuento de insumos vive en la MISMA transacción que crea la sesión de
// tratamiento, como pide el prompt. Si el stock no alcanza, lanza
// InsufficientStockError y la transacción entera se revierte (no se crea
// la sesión con el descuento a medias).

export async function consumeFefoTx(
  tx: Tx,
  params: {
    clinicId: string;
    itemId: string;
    itemName: string;
    qty: number;
    reason: string;
    userId?: string | null;
    treatmentSessionId?: string | null;
    preferredLotId?: string | null;
  },
): Promise<{ allocations: { lotId: string; qty: number }[] }> {
  if (params.qty <= 0) throw new Error(`Cantidad inválida para "${params.itemName}": ${params.qty}`);

  const lots = await reconcileAndLock(tx, params.clinicId, params.itemId);
  const plan: FefoPlan | FefoInsufficient = planFefoConsumption(lots, round3(params.qty), params.preferredLotId ?? null);
  // "strict": false en este repo (tsconfig.json) apaga strictNullChecks, y
  // sin él tsc NO estrecha uniones discriminadas de forma fiable con
  // `if (!plan.ok)` — deja `plan` como la unión completa y el acceso a
  // `.available` no compila. Se evita del todo con un cast explícito en vez
  // de depender del estrechamiento.
  if (plan.ok === false) {
    throw new InsufficientStockError(params.itemId, params.itemName, params.qty, (plan as FefoInsufficient).available);
  }

  for (const alloc of plan.allocations) {
    await (tx as PrismaClient).inventoryLot.update({
      where: { id: alloc.lotId },
      data:  { remaining: { decrement: alloc.qty } },
    });
    await (tx as PrismaClient).inventoryLotMovement.create({
      data: {
        lotId:              alloc.lotId,
        clinicId:           params.clinicId,
        change:             -alloc.qty,
        reason:             params.reason,
        userId:             params.userId ?? null,
        treatmentSessionId: params.treatmentSessionId ?? null,
      },
    });
  }
  await (tx as PrismaClient).inventoryHistory.create({
    // ws1-t4: clinicId/userId/type — "session" porque este consumo SIEMPRE
    // viene de una sesión de tratamiento (ver la nota del bloque de arriba).
    data: {
      itemId: params.itemId, change: -Math.round(round3(params.qty)), reason: params.reason,
      clinicId: params.clinicId, userId: params.userId ?? null, type: "session",
    },
  });
  await syncItemAggregate(tx, params.clinicId, params.itemId);

  return { allocations: plan.allocations };
}

// ── Avisos de caducidad (Inventario y "Hoy" del admin) ─────────────────

export interface AvisoLote {
  lotId: string;
  itemId: string;
  itemName: string;
  unit: string;
  lotNumber: string | null;
  expiresAt: string;
  remaining: number;
}

export async function getExpiryAlerts(clinicId: string, db: Db = prisma): Promise<{ porCaducar: AvisoLote[]; caducado: AvisoLote[] }> {
  try {
    const [alertDays, lots] = await Promise.all([
      getAlertDaysAhead(clinicId, db),
      (db as PrismaClient).inventoryLot.findMany({
        where:   { clinicId, remaining: { gt: 0 }, expiresAt: { not: null } },
        include: { item: { select: { id: true, name: true, unit: true } } },
        orderBy: { expiresAt: "asc" },
      }),
    ]);
    const now = new Date();
    const porCaducar: AvisoLote[] = [];
    const caducado: AvisoLote[]   = [];
    for (const l of lots) {
      if (!l.expiresAt) continue;
      const dto: AvisoLote = {
        lotId:     l.id,
        itemId:    l.itemId,
        itemName:  l.item.name,
        unit:      l.item.unit,
        lotNumber: l.lotNumber,
        expiresAt: l.expiresAt.toISOString(),
        remaining: Number(l.remaining),
      };
      if (isExpired(l.expiresAt, now)) caducado.push(dto);
      else if (isExpiringSoon(l.expiresAt, now, alertDays)) porCaducar.push(dto);
    }
    return { porCaducar, caducado };
  } catch (e) {
    if (isMissingRelation(e)) return { porCaducar: [], caducado: [] };
    throw e;
  }
}
