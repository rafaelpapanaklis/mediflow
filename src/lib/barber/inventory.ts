// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — productos e inventario.
//
// CONVENCIÓN DE SIGNO (la del schema, BarberStockMovement.qty SIGNADO):
//   IN      compra / entrada        → qty POSITIVO
//   RETURN  devolución del cliente  → qty POSITIVO
//   OUT     merma / salida          → qty NEGATIVO
//   SALE    venta (automático)      → qty NEGATIVO (lo escribe cash.ts)
//   ADJUST  ajuste de conteo        → el delta con su signo (+ sube, − baja)
// Invariante: stock actual = stock inicial + Σ qty de sus movimientos. El
// stock inicial al crear el producto también deja un movimiento IN ("Stock
// inicial"), así la bitácora explica el 100% del número.
//
// STOCK NUNCA NEGATIVO: toda resta pasa por applyStockDelta(), que hace
// `UPDATE … SET stock = stock − n WHERE id = ? AND stock >= n` en la MISMA
// transacción de quien la pide (venta o movimiento manual). Postgres toma el
// candado de fila y re-evalúa el WHERE sobre la versión más reciente, así que
// de dos ventas simultáneas del último producto una gana y la otra recibe
// count = 0 → OUT_OF_STOCK → rollback completo de SU transacción. Además
// sql/barber_caja.sql agrega el CHECK (stock >= 0) como red de seguridad.
//
// Permisos: products.manage = catálogo (crear/editar/retirar) y estadísticas;
// inventory.manage = movimientos manuales; la VENTA descuenta stock bajo
// cash.manage sin pedir inventory.manage (contrato de permissions.ts). El
// listado para el cobrador (picker de la caja) acepta cash.view.
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  assertBarberPermission,
  hasBarberPermission,
  BarberForbiddenError,
  type BarberContext,
} from "@/lib/barber-auth";
import type {
  BarberProductDTO,
  BarberStockMovementDTO,
  BarberStockMovementType,
} from "@/lib/barber/types";
import {
  BarberCajaError,
  D,
  DEFAULT_BARBER_TZ,
  ZERO,
  isSaleCancelled,
  money,
  parseMoneyInput,
  periodRange,
  toNum,
  type Money,
} from "@/lib/barber/commissions";

type Tx = Prisma.TransactionClient;

// ── DTOs ────────────────────────────────────────────────────────────────

export function toProductDTO(p: {
  id: string;
  name: string;
  sku: string | null;
  price: Prisma.Decimal;
  cost: Prisma.Decimal | null;
  stock: number;
  minStock: number | null;
  unit: string | null;
  isActive: boolean;
}): BarberProductDTO {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    price: toNum(p.price),
    cost: p.cost === null ? null : toNum(p.cost),
    stock: p.stock,
    minStock: p.minStock,
    unit: p.unit,
    isActive: p.isActive,
  };
}

export function toMovementDTO(m: {
  id: string;
  productId: string;
  type: BarberStockMovementType;
  qty: number;
  reason: string | null;
  saleId: string | null;
  userId: string;
  createdAt: Date;
}): BarberStockMovementDTO {
  return {
    id: m.id,
    productId: m.productId,
    type: m.type,
    qty: m.qty,
    reason: m.reason,
    saleId: m.saleId,
    userId: m.userId,
    createdAt: m.createdAt.toISOString(),
  };
}

/** Producto + margen calculado (para la tabla del catálogo). */
export interface ProductRow extends BarberProductDTO {
  /** price − cost (null si no hay costo). */
  marginAmount: number | null;
  /** (price − cost) / price × 100, redondeado a 1 decimal (null sin costo o precio 0). */
  marginPct: number | null;
  /** stock ≤ minStock (con minStock definido). */
  lowStock: boolean;
}

export function toProductRow(p: Parameters<typeof toProductDTO>[0]): ProductRow {
  const dto = toProductDTO(p);
  const price = D(p.price);
  const cost = p.cost === null ? null : D(p.cost);
  const marginAmount = cost === null ? null : money(price.minus(cost));
  const marginPct =
    cost === null || price.isZero()
      ? null
      : price.minus(cost).div(price).times(100).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  return {
    ...dto,
    marginAmount: marginAmount === null ? null : marginAmount.toNumber(),
    marginPct,
    lowStock: isLowStock(p),
  };
}

/** Alerta de mínimo: stock EN o POR DEBAJO de minStock (minStock = punto de
 *  reorden; null = sin alerta). */
export function isLowStock(p: { stock: number; minStock: number | null }): boolean {
  return p.minStock !== null && p.minStock !== undefined && p.stock <= p.minStock;
}

// ── Permisos compuestos ─────────────────────────────────────────────────

function assertAnyPermission(
  ctx: BarberContext,
  keys: Array<"products.manage" | "inventory.manage" | "cash.view" | "cash.manage">,
): void {
  const user = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (keys.some((k) => hasBarberPermission(user, k))) return;
  throw new BarberForbiddenError(keys[0]);
}

// ── Catálogo ────────────────────────────────────────────────────────────

/**
 * Lista de productos de la barbería. `forSale` = picker de la caja (solo
 * activos, permitido con cash.view); si no, exige products.manage.
 */
export async function listProducts(
  ctx: BarberContext,
  opts: { includeInactive?: boolean; forSale?: boolean } = {},
): Promise<ProductRow[]> {
  if (opts.forSale) assertAnyPermission(ctx, ["cash.view", "cash.manage", "products.manage"]);
  else assertBarberPermission(ctx, "products.manage");

  const rows = await prisma.barberProduct.findMany({
    where: {
      barbershopId: ctx.barbershopId,
      ...(opts.forSale || !opts.includeInactive ? { isActive: true } : {}),
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return rows.map(toProductRow);
}

export interface ProductInput {
  name?: unknown;
  sku?: unknown;
  price?: unknown;
  cost?: unknown;
  minStock?: unknown;
  unit?: unknown;
  isActive?: unknown;
  /** Solo al crear: stock inicial (deja movimiento IN). */
  initialStock?: unknown;
}

function str(v: unknown, field: string, max = 120, required = false): string | null {
  if (v === undefined || v === null) {
    if (required) throw new BarberCajaError(400, "INVALID_INPUT", `${field}: requerido`);
    return null;
  }
  if (typeof v !== "string") throw new BarberCajaError(400, "INVALID_INPUT", `${field}: inválido`);
  const s = v.trim();
  if (!s) {
    if (required) throw new BarberCajaError(400, "INVALID_INPUT", `${field}: requerido`);
    return null;
  }
  if (s.length > max) throw new BarberCajaError(400, "INVALID_INPUT", `${field}: demasiado largo`);
  return s;
}

function intOrNull(v: unknown, field: string, min = 0): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < min || n > 1_000_000) {
    throw new BarberCajaError(400, "INVALID_INPUT", `${field}: entero inválido`);
  }
  return n;
}

export async function createProduct(ctx: BarberContext, input: ProductInput): Promise<ProductRow> {
  assertBarberPermission(ctx, "products.manage");
  const name = str(input.name, "name", 120, true)!;
  const sku = str(input.sku, "sku", 60);
  const unit = str(input.unit, "unit", 30);
  const price = parseMoneyInput(input.price, { field: "price", required: true });
  const cost = input.cost === undefined || input.cost === null || input.cost === ""
    ? null
    : parseMoneyInput(input.cost, { field: "cost" });
  const minStock = intOrNull(input.minStock, "minStock");
  const initialStock = intOrNull(input.initialStock, "initialStock") ?? 0;

  const created = await prisma.$transaction(async (tx) => {
    const p = await tx.barberProduct.create({
      data: {
        barbershopId: ctx.barbershopId,
        name,
        sku,
        unit,
        price,
        cost,
        minStock,
        stock: initialStock,
        isActive: input.isActive === undefined ? true : Boolean(input.isActive),
      },
    });
    if (initialStock > 0) {
      await tx.barberStockMovement.create({
        data: {
          productId: p.id,
          barbershopId: ctx.barbershopId,
          type: "IN",
          qty: initialStock,
          reason: "Stock inicial",
          userId: ctx.barberUserId,
        },
      });
    }
    return p;
  });
  return toProductRow(created);
}

/**
 * Edita nombre/SKU/precio/costo/mínimo/unidad/activo. El STOCK no se edita
 * aquí: solo cambia por movimientos (registerStockMovement / venta).
 */
export async function updateProduct(
  ctx: BarberContext,
  productId: string,
  input: ProductInput,
): Promise<ProductRow> {
  assertBarberPermission(ctx, "products.manage");
  const data: Prisma.BarberProductUpdateManyMutationInput = {};
  if (input.name !== undefined) data.name = str(input.name, "name", 120, true)!;
  if (input.sku !== undefined) data.sku = str(input.sku, "sku", 60);
  if (input.unit !== undefined) data.unit = str(input.unit, "unit", 30);
  if (input.price !== undefined) data.price = parseMoneyInput(input.price, { field: "price", required: true });
  if (input.cost !== undefined) {
    data.cost = input.cost === null || input.cost === "" ? null : parseMoneyInput(input.cost, { field: "cost" });
  }
  if (input.minStock !== undefined) data.minStock = intOrNull(input.minStock, "minStock");
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);
  if (Object.keys(data).length === 0) {
    throw new BarberCajaError(400, "INVALID_INPUT", "Nada que actualizar");
  }

  // updateMany scopeado por barbershopId: un id ajeno da 0 filas → 404 (no
  // se filtra ni la existencia del producto de otra barbería).
  const r = await prisma.barberProduct.updateMany({
    where: { id: productId, barbershopId: ctx.barbershopId },
    data,
  });
  if (r.count === 0) throw new BarberCajaError(404, "PRODUCT_NOT_FOUND", "Producto no encontrado");
  const p = await prisma.barberProduct.findFirst({ where: { id: productId, barbershopId: ctx.barbershopId } });
  if (!p) throw new BarberCajaError(404, "PRODUCT_NOT_FOUND", "Producto no encontrado");
  return toProductRow(p);
}

// ── Movimientos ─────────────────────────────────────────────────────────

export interface StockDeltaParams {
  barbershopId: string;
  productId: string;
  /** Signado: negativo resta, positivo suma. Nunca 0. */
  delta: number;
  type: BarberStockMovementType;
  reason: string | null;
  saleId?: string | null;
  userId: string;
  /** Una venta exige producto activo; un ajuste/entrada manual no. */
  requireActive?: boolean;
}

/**
 * Aplica un delta al stock y deja su movimiento, DENTRO de la transacción
 * `tx` de quien llama. Es el ÚNICO camino que muta BarberProduct.stock.
 * Resta con guarda `stock >= n` (ver cabecera): count 0 → OUT_OF_STOCK.
 */
export async function applyStockDelta(tx: Tx, params: StockDeltaParams): Promise<void> {
  const { barbershopId, productId, delta, type, reason, saleId, userId, requireActive } = params;
  if (!Number.isInteger(delta) || delta === 0) {
    throw new BarberCajaError(400, "INVALID_QTY", "La cantidad del movimiento no puede ser 0");
  }

  if (delta < 0) {
    const need = -delta;
    const r = await tx.barberProduct.updateMany({
      where: {
        id: productId,
        barbershopId,
        stock: { gte: need },
        ...(requireActive ? { isActive: true } : {}),
      },
      data: { stock: { decrement: need } },
    });
    if (r.count === 0) {
      // Distinguir "no existe / de otra barbería / inactivo" de "sin stock".
      const p = await tx.barberProduct.findFirst({
        where: { id: productId, barbershopId },
        select: { name: true, stock: true, isActive: true },
      });
      if (!p) throw new BarberCajaError(404, "PRODUCT_NOT_FOUND", "Producto no encontrado");
      if (requireActive && !p.isActive) {
        throw new BarberCajaError(409, "PRODUCT_INACTIVE", `"${p.name}" está retirado del catálogo`);
      }
      throw new BarberCajaError(
        409,
        "OUT_OF_STOCK",
        `Stock insuficiente de "${p.name}": hay ${p.stock}, se piden ${need}`,
        { productId, available: p.stock, requested: need },
      );
    }
  } else {
    const r = await tx.barberProduct.updateMany({
      where: { id: productId, barbershopId },
      data: { stock: { increment: delta } },
    });
    if (r.count === 0) throw new BarberCajaError(404, "PRODUCT_NOT_FOUND", "Producto no encontrado");
  }

  await tx.barberStockMovement.create({
    data: {
      productId,
      barbershopId,
      type,
      qty: delta,
      reason,
      saleId: saleId ?? null,
      userId,
    },
  });
}

const MANUAL_TYPES: BarberStockMovementType[] = ["IN", "OUT", "ADJUST", "RETURN"];

/**
 * Movimiento MANUAL (inventory.manage). `qty` llega POSITIVO para IN/OUT/
 * RETURN (el tipo pone el signo) y SIGNADO para ADJUST (delta del conteo).
 * SALE no se registra a mano: lo escribe la venta.
 */
export async function registerStockMovement(
  ctx: BarberContext,
  productId: string,
  input: { type?: unknown; qty?: unknown; reason?: unknown },
): Promise<{ product: ProductRow; movement: BarberStockMovementDTO }> {
  assertBarberPermission(ctx, "inventory.manage");
  const type = input.type as BarberStockMovementType;
  if (!MANUAL_TYPES.includes(type)) {
    throw new BarberCajaError(400, "INVALID_INPUT", "Tipo de movimiento inválido (IN, OUT, ADJUST o RETURN)");
  }
  const rawQty = typeof input.qty === "number" ? input.qty : typeof input.qty === "string" ? Number(input.qty) : NaN;
  if (!Number.isInteger(rawQty) || rawQty === 0 || Math.abs(rawQty) > 1_000_000) {
    throw new BarberCajaError(400, "INVALID_QTY", "Cantidad inválida");
  }
  const reason = str(input.reason, "reason", 300);
  if (!reason) throw new BarberCajaError(400, "INVALID_INPUT", "Indica el motivo del movimiento");

  let delta: number;
  switch (type) {
    case "IN":
    case "RETURN":
      delta = Math.abs(rawQty);
      break;
    case "OUT":
      delta = -Math.abs(rawQty);
      break;
    case "ADJUST":
    default:
      delta = rawQty;
  }

  const movement = await prisma.$transaction(async (tx) => {
    await applyStockDelta(tx, {
      barbershopId: ctx.barbershopId,
      productId,
      delta,
      type,
      reason,
      userId: ctx.barberUserId,
    });
    return tx.barberStockMovement.findFirstOrThrow({
      where: { productId, barbershopId: ctx.barbershopId, userId: ctx.barberUserId },
      orderBy: { createdAt: "desc" },
    });
  });
  const product = await prisma.barberProduct.findFirstOrThrow({
    where: { id: productId, barbershopId: ctx.barbershopId },
  });
  return { product: toProductRow(product), movement: toMovementDTO(movement) };
}

export interface MovementRow extends BarberStockMovementDTO {
  userName: string;
}

export async function listMovements(
  ctx: BarberContext,
  productId: string,
  opts: { limit?: number } = {},
): Promise<MovementRow[]> {
  assertAnyPermission(ctx, ["products.manage", "inventory.manage"]);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await prisma.barberStockMovement.findMany({
    where: { productId, barbershopId: ctx.barbershopId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { firstName: true, lastName: true } } },
  });
  return rows.map((m) => ({
    ...toMovementDTO(m),
    userName: `${m.user.firstName} ${m.user.lastName}`.trim(),
  }));
}

// ── Estadísticas ────────────────────────────────────────────────────────

export interface TopSellerRow {
  productId: string;
  name: string;
  unit: string | null;
  qty: number;
  revenue: number;
  /** revenue − qty × costo ACTUAL del producto (null si no tiene costo). */
  profit: number | null;
}

export interface InventoryStats {
  periodKey: string;
  activeCount: number;
  lowStock: ProductRow[];
  /** Σ stock × costo (a costo) y Σ stock × precio (a venta) de activos. */
  stockValueCost: number;
  stockValuePrice: number;
  /** Margen % promedio ponderado por precio de los productos con costo. */
  avgMarginPct: number | null;
  topSellers: TopSellerRow[];
  periodProductRevenue: number;
  periodProductUnits: number;
}

export async function getInventoryStats(ctx: BarberContext, periodKey: string): Promise<InventoryStats> {
  assertBarberPermission(ctx, "products.manage");
  const tz = ctx.barbershop.timezone || DEFAULT_BARBER_TZ;
  const { start, end } = periodRange(periodKey, tz);

  const [products, items] = await Promise.all([
    prisma.barberProduct.findMany({ where: { barbershopId: ctx.barbershopId }, orderBy: { name: "asc" } }),
    prisma.barberSaleItem.findMany({
      where: {
        productId: { not: null },
        sale: { barbershopId: ctx.barbershopId, createdAt: { gte: start, lt: end } },
      },
      select: {
        productId: true,
        qty: true,
        unitPrice: true,
        sale: { select: { notes: true } },
      },
    }),
  ]);

  const byId = new Map(products.map((p) => [p.id, p]));
  const active = products.filter((p) => p.isActive);
  let stockValueCost = ZERO;
  let stockValuePrice = ZERO;
  let marginWeight = ZERO;
  let marginSum = ZERO;
  for (const p of active) {
    const price = D(p.price);
    stockValuePrice = stockValuePrice.plus(price.times(p.stock));
    if (p.cost !== null) {
      const cost = D(p.cost);
      stockValueCost = stockValueCost.plus(cost.times(p.stock));
      if (!price.isZero()) {
        marginWeight = marginWeight.plus(price);
        marginSum = marginSum.plus(price.minus(cost));
      }
    }
  }

  const agg = new Map<string, { qty: number; revenue: Money }>();
  let periodUnits = 0;
  let periodRevenue = ZERO;
  for (const it of items) {
    // Los tickets cancelados ya no tienen líneas (soft-cancel las borra), pero
    // el predicado se aplica igual por si algún dato llegó por otro camino.
    if (!it.productId || isSaleCancelled(it.sale)) continue;
    const t = D(it.unitPrice).times(it.qty);
    const a = agg.get(it.productId) ?? { qty: 0, revenue: ZERO };
    a.qty += it.qty;
    a.revenue = a.revenue.plus(t);
    agg.set(it.productId, a);
    periodUnits += it.qty;
    periodRevenue = periodRevenue.plus(t);
  }
  const topSellers: TopSellerRow[] = Array.from(agg.entries())
    .map(([productId, a]) => {
      const p = byId.get(productId);
      const cost = p?.cost ?? null;
      return {
        productId,
        name: p?.name ?? "(producto eliminado)",
        unit: p?.unit ?? null,
        qty: a.qty,
        revenue: toNum(a.revenue),
        profit: cost === null ? null : toNum(a.revenue.minus(D(cost).times(a.qty))),
      };
    })
    .sort((x, y) => y.qty - x.qty || y.revenue - x.revenue)
    .slice(0, 10);

  return {
    periodKey,
    activeCount: active.length,
    lowStock: active.filter(isLowStock).map(toProductRow),
    stockValueCost: toNum(stockValueCost),
    stockValuePrice: toNum(stockValuePrice),
    avgMarginPct: marginWeight.isZero()
      ? null
      : marginSum.div(marginWeight).times(100).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP).toNumber(),
    topSellers,
    periodProductRevenue: toNum(periodRevenue),
    periodProductUnits: periodUnits,
  };
}
