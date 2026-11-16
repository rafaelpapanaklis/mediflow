import "server-only";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { moneyErrorResponse } from "@/lib/barber/cash";
import { prisma } from "@/lib/prisma";
import { assertBarberPermission, hasBarberPermission, type BarberContext } from "@/lib/barber-auth";
import { getBarberPlan } from "@/lib/barber/plans";
import { barberiaAlCorriente } from "@/lib/barber/cobros";
import { rutaWebBarberia } from "@/lib/barber/landing";
import {
  PRODUCT_CATEGORY_MAX,
  PRODUCT_DESCRIPTION_MAX,
  TIENDA_FEATURED_MAX,
  TIENDA_MAX_OPEN_PER_PHONE,
  TiendaError,
  isOpenOrderStatus,
  makeFolio,
  orderExpiresAt,
  orderTotalCents,
  parseOrderItems,
  reservedByProduct,
  rutaProductoTienda,
  rutaTienda,
  stockTag,
  sweepExpiredOrders,
  tiendaReady,
  type OrderItem,
  type OrderRequestLine,
  type ProductOrderPayMethod,
  type ProductOrderStatus,
  type StockTag,
} from "@/lib/barber/tienda-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — TIENDA DE PRODUCTOS (servidor).
 *
 * Panel (con sesión):
 *   · extras del producto (foto, categoría, descripción, «en mi página»,
 *     «se puede apartar»): products.manage;
 *   · pedidos: VER con products.view; «Listo», «Cancelar» y «Entregar y
 *     cobrar» con products.view + cash.manage (Recepción sí, Barbero no:
 *     decisión #13). El cobro en sí es el createSale de Caja.
 *
 * Público (sin sesión): la barbería sale del SLUG; la tienda junta los
 * productos de todas las sedes de la cadena y cada pedido es de UNA sede (la
 * dueña de las existencias). select explícito siempre: el costo, el SKU y
 * las existencias exactas de lo que no se muestra no salen.
 *
 * Todo por SQL crudo: las columnas y la tabla nuevas no están en el cliente
 * Prisma compartido (ver tienda-core.ts).
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── Extras del producto ─────────────────────────────────────────────────

export interface ProductExtras {
  photoUrl: string | null;
  category: string | null;
  description: string | null;
  showOnWeb: boolean;
  onlineOrder: boolean;
}

export interface ProductExtrasLoad {
  /** false = falta sql/barber_tienda.sql: el panel esconde lo de la tienda. */
  ready: boolean;
  /** false = falta la tabla de pedidos (la pestaña Pedidos lo dice). */
  ordersReady: boolean;
  extras: Record<string, ProductExtras>;
  /** Piezas apartadas por producto (pedidos vivos sin entregar). */
  reserved: Record<string, number>;
}

export async function loadProductExtras(barbershopId: string): Promise<ProductExtrasLoad> {
  const ready = await tiendaReady(prisma);
  if (!ready.columns) return { ready: false, ordersReady: false, extras: {}, reserved: {} };
  const rows = await prisma.$queryRaw<Array<{ id: string } & ProductExtras>>`
    SELECT "id", "photoUrl", "category", "description", "showOnWeb", "onlineOrder"
    FROM "barber_products" WHERE "barbershopId" = ${barbershopId}
  `;
  const extras: Record<string, ProductExtras> = {};
  for (const r of rows) {
    extras[r.id] = {
      photoUrl: r.photoUrl,
      category: r.category,
      description: r.description,
      showOnWeb: r.showOnWeb === true,
      onlineOrder: r.onlineOrder === true,
    };
  }
  const reserved: Record<string, number> = {};
  if (ready.orders) {
    await sweepExpiredOrders(prisma, [barbershopId]);
    for (const [id, q] of Array.from((await reservedByProduct(prisma, [barbershopId])).entries())) reserved[id] = q;
  }
  return { ready: true, ordersReady: ready.orders, extras, reserved };
}

export interface ProductExtrasInput {
  category?: unknown;
  description?: unknown;
  showOnWeb?: unknown;
  onlineOrder?: unknown;
}

function optText(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new TiendaError(400, "INVALID_INPUT", `${field}: inválido`);
  const s = v.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!s) return null;
  if (s.length > max) throw new TiendaError(400, "INVALID_INPUT", `${field}: máximo ${max} caracteres`);
  return s;
}

/**
 * Guarda categoría, descripción y los dos interruptores (lo que llegue). La
 * foto va por su propia ruta. «Se puede apartar» sin «Mostrar en mi página»
 * no tiene dónde apartarse: se guarda, pero la tienda solo lo ofrece si se
 * muestra.
 */
export async function saveProductExtras(ctx: BarberContext, productId: string, input: ProductExtrasInput): Promise<ProductExtras> {
  assertBarberPermission(ctx, "products.manage");
  if (!(await tiendaReady(prisma)).columns) {
    throw new TiendaError(409, "TIENDA_SQL_PENDING", "Falta aplicar sql/barber_tienda.sql");
  }
  const cur = await prisma.$queryRaw<Array<{ id: string } & ProductExtras>>`
    SELECT "id", "photoUrl", "category", "description", "showOnWeb", "onlineOrder"
    FROM "barber_products" WHERE "id" = ${productId} AND "barbershopId" = ${ctx.barbershopId}
  `;
  const row = cur[0];
  if (!row) throw new TiendaError(404, "PRODUCT_NOT_FOUND", "Producto no encontrado");
  const next: ProductExtras = {
    photoUrl: row.photoUrl,
    category: input.category !== undefined ? optText(input.category, "Categoría", PRODUCT_CATEGORY_MAX) : row.category,
    description: input.description !== undefined ? optText(input.description, "Descripción", PRODUCT_DESCRIPTION_MAX) : row.description,
    showOnWeb: input.showOnWeb !== undefined ? input.showOnWeb === true : row.showOnWeb === true,
    onlineOrder: input.onlineOrder !== undefined ? input.onlineOrder === true : row.onlineOrder === true,
  };
  await prisma.$executeRaw`
    UPDATE "barber_products"
    SET "category" = ${next.category}, "description" = ${next.description},
        "showOnWeb" = ${next.showOnWeb}, "onlineOrder" = ${next.onlineOrder}, "updatedAt" = now()
    WHERE "id" = ${productId} AND "barbershopId" = ${ctx.barbershopId}
  `;
  revalidarTienda(ctx.barbershop.slug, productId);
  return next;
}

/** La página de la barbería es ISR: que el cambio se vea ya (best-effort). */
export function revalidarTienda(slug: string | null | undefined, productId?: string): void {
  if (!slug) return;
  try {
    revalidatePath(rutaWebBarberia(slug));
    revalidatePath(rutaTienda(slug));
    if (productId) revalidatePath(rutaProductoTienda(slug, productId));
  } catch {
    /* fuera de un request de Next (pruebas) */
  }
}

// ── Pedidos (panel) ─────────────────────────────────────────────────────

export interface ProductOrderRow {
  id: string;
  folio: string;
  status: ProductOrderStatus;
  payMethod: ProductOrderPayMethod;
  /** Se pagó en línea (paid_at), aunque luego se marcara «Listo». */
  paidOnline: boolean;
  clientId: string | null;
  clientName: string;
  clientPhone: string;
  items: OrderItem[];
  total: number;
  createdAt: string;
  /** Cuándo vence si no se paga ni se recoge (null si ya no aplica). */
  expiresAt: string | null;
  pickedUpAt: string | null;
  saleId: string | null;
}

export interface ProductOrderList {
  ready: boolean;
  orders: ProductOrderRow[];
  /** Pedidos que esperan acción (PENDING o pagados sin marcar «Listo»). */
  newCount: number;
}

interface OrderRaw {
  id: string;
  folio: string;
  status: string;
  pay_method: string;
  paid_at: Date | null;
  client_id: string | null;
  client_name: string;
  client_phone: string;
  items: unknown;
  total: unknown;
  created_at: Date;
  picked_up_at: Date | null;
  sale_id: string | null;
}

function toOrderRow(r: OrderRaw): ProductOrderRow {
  const status = r.status as ProductOrderStatus;
  const open = isOpenOrderStatus(status);
  return {
    id: r.id,
    folio: r.folio,
    status,
    payMethod: r.pay_method === "MERCADOPAGO" ? "MERCADOPAGO" : "STORE",
    paidOnline: r.paid_at !== null,
    clientId: r.client_id,
    clientName: r.client_name,
    clientPhone: r.client_phone,
    items: parseOrderItems(r.items),
    total: Number(r.total),
    createdAt: r.created_at.toISOString(),
    expiresAt: open && !r.paid_at ? orderExpiresAt(r.created_at).toISOString() : null,
    pickedUpAt: r.picked_up_at ? r.picked_up_at.toISOString() : null,
    saleId: r.sale_id,
  };
}

const ORDER_LIST_MAX = 100;

/** Vivos primero (los más viejos arriba: vencen antes), luego lo cerrado reciente. */
export async function listProductOrders(ctx: BarberContext): Promise<ProductOrderList> {
  assertBarberPermission(ctx, "products.view");
  if (!(await tiendaReady(prisma)).orders) return { ready: false, orders: [], newCount: 0 };
  await sweepExpiredOrders(prisma, [ctx.barbershopId]);
  const rows = await prisma.$queryRaw<OrderRaw[]>`
    SELECT "id", "folio", "status", "pay_method", "paid_at", "client_id", "client_name", "client_phone",
           "items", "total", "created_at", "picked_up_at", "sale_id"
    FROM "barber_product_orders"
    WHERE "barbershop_id" = ${ctx.barbershopId}
    ORDER BY ("status" IN ('PENDING', 'PAID_ONLINE', 'READY')) DESC,
             CASE WHEN "status" IN ('PENDING', 'PAID_ONLINE', 'READY') THEN "created_at" END ASC,
             "updated_at" DESC
    LIMIT ${ORDER_LIST_MAX}
  `;
  const orders = rows.map(toOrderRow);
  const newCount = orders.filter((o) => o.status === "PENDING" || o.status === "PAID_ONLINE").length;
  return { ready: true, orders, newCount };
}

/** Solo el contador (la pestaña lo enseña sin cargar la lista). */
export async function countNewProductOrders(barbershopId: string): Promise<number> {
  if (!(await tiendaReady(prisma)).orders) return 0;
  await sweepExpiredOrders(prisma, [barbershopId]);
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS "n" FROM "barber_product_orders"
    WHERE "barbershop_id" = ${barbershopId} AND "status" IN ('PENDING', 'PAID_ONLINE')
  `;
  return Number(rows[0]?.n ?? 0);
}

/** ¿Puede actuar sobre pedidos? Ver + cobrar (Recepción sí; Barbero no). */
export function canHandleOrders(ctx: Pick<BarberContext, "role" | "user">): boolean {
  const u = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  return hasBarberPermission(u, "products.view") && hasBarberPermission(u, "cash.manage");
}

function assertCanHandle(ctx: BarberContext): void {
  assertBarberPermission(ctx, "products.view");
  assertBarberPermission(ctx, "cash.manage");
}

async function getOrder(ctx: BarberContext, orderId: string): Promise<ProductOrderRow> {
  const rows = await prisma.$queryRaw<OrderRaw[]>`
    SELECT "id", "folio", "status", "pay_method", "paid_at", "client_id", "client_name", "client_phone",
           "items", "total", "created_at", "picked_up_at", "sale_id"
    FROM "barber_product_orders"
    WHERE "id" = ${orderId} AND "barbershop_id" = ${ctx.barbershopId}
  `;
  if (!rows[0]) throw new TiendaError(404, "ORDER_NOT_FOUND", "Pedido no encontrado");
  return toOrderRow(rows[0]);
}

export async function getProductOrder(ctx: BarberContext, orderId: string): Promise<ProductOrderRow> {
  assertBarberPermission(ctx, "products.view");
  if (!(await tiendaReady(prisma)).orders) throw new TiendaError(409, "ORDERS_SQL_PENDING", "Falta aplicar sql/barber_tienda.sql");
  await sweepExpiredOrders(prisma, [ctx.barbershopId]);
  return getOrder(ctx, orderId);
}

/** «Listo para recoger». De PENDING o pagado en línea; idempotente si ya está listo. */
export async function markProductOrderReady(ctx: BarberContext, orderId: string): Promise<ProductOrderRow> {
  assertCanHandle(ctx);
  if (!(await tiendaReady(prisma)).orders) throw new TiendaError(409, "ORDERS_SQL_PENDING", "Falta aplicar sql/barber_tienda.sql");
  await sweepExpiredOrders(prisma, [ctx.barbershopId]);
  const n = await prisma.$executeRaw`
    UPDATE "barber_product_orders" SET "status" = 'READY', "updated_at" = now()
    WHERE "id" = ${orderId} AND "barbershop_id" = ${ctx.barbershopId} AND "status" IN ('PENDING', 'PAID_ONLINE')
  `;
  const o = await getOrder(ctx, orderId);
  if (n === 0 && o.status !== "READY") throw new TiendaError(409, "ORDER_NOT_OPEN", "Ese pedido ya se entregó, se canceló o venció");
  return o;
}

/**
 * Cancelar libera las piezas. Si se pagó en línea NO se cancela solo: el
 * reembolso se hace en Mercado Pago y aquí hay que confirmar que ya se hizo
 * (`refundConfirmed`); sin eso, 409 PAID_ONLINE_REFUND y nada cambia.
 */
export async function cancelProductOrder(
  ctx: BarberContext,
  orderId: string,
  input: { refundConfirmed?: unknown } = {},
): Promise<ProductOrderRow> {
  assertCanHandle(ctx);
  if (!(await tiendaReady(prisma)).orders) throw new TiendaError(409, "ORDERS_SQL_PENDING", "Falta aplicar sql/barber_tienda.sql");
  const o = await getOrder(ctx, orderId);
  if (!isOpenOrderStatus(o.status)) throw new TiendaError(409, "ORDER_NOT_OPEN", "Ese pedido ya se entregó, se canceló o venció");
  if (o.paidOnline && input.refundConfirmed !== true) {
    throw new TiendaError(409, "PAID_ONLINE_REFUND", "Este pedido se pagó en línea: el reembolso se hace en Mercado Pago. Confírmalo para cancelar.");
  }
  const n = await prisma.$executeRaw`
    UPDATE "barber_product_orders" SET "status" = 'CANCELLED', "updated_at" = now()
    WHERE "id" = ${orderId} AND "barbershop_id" = ${ctx.barbershopId}
      AND "status" IN ('PENDING', 'PAID_ONLINE', 'READY')
      AND ("paid_at" IS NULL OR ${input.refundConfirmed === true})
  `;
  if (n === 0) throw new TiendaError(409, "ORDER_NOT_OPEN", "Ese pedido ya cambió; recarga la lista");
  return getOrder(ctx, orderId);
}

// ── Público ─────────────────────────────────────────────────────────────

const TIENDA_SHOP_SELECT = {
  id: true,
  name: true,
  slug: true,
  phone: true,
  address: true,
  city: true,
  logoUrl: true,
  branchName: true,
  locale: true,
  timezone: true,
  plan: true,
  isActive: true,
  subscriptionStatus: true,
  parentId: true,
} as const;

/** Lo que de una sede viaja al navegador. */
export interface TiendaBranch {
  id: string;
  name: string;
  slug: string;
  branchName: string | null;
  address: string | null;
  city: string | null;
}

export interface TiendaShop extends TiendaBranch {
  phone: string | null;
  logoUrl: string | null;
  locale: string;
  timezone: string;
}

export interface TiendaProduct {
  id: string;
  branchId: string;
  name: string;
  price: number;
  unit: string | null;
  photoUrl: string | null;
  category: string | null;
  description: string | null;
  /** Lo que se puede apartar ahora (stock − apartado), nunca negativo. */
  available: number;
  tag: StockTag;
  /** Se puede apartar en línea (interruptor del producto + tabla de pedidos). */
  orderable: boolean;
}

export interface TiendaGateOk {
  ok: true;
  shop: TiendaShop;
  branches: TiendaBranch[];
  ordersReady: boolean;
}
export interface TiendaGateErr {
  ok: false;
}
export type TiendaGate = TiendaGateOk | TiendaGateErr;

/** Guarda de tipo (strict:false no estrecha uniones por el booleano). */
export function isTiendaGateOk(g: TiendaGate): g is TiendaGateOk {
  return g.ok === true;
}

function branchOf(r: { id: string; name: string; slug: string; branchName: string | null; address: string | null; city: string | null }): TiendaBranch {
  return { id: r.id, name: r.name, slug: r.slug, branchName: r.branchName, address: r.address, city: r.city };
}

/**
 * ¿Hay tienda en este slug? La barbería existe, está activa y al corriente
 * (el criterio único del panel), su plan incluye productos y el SQL está
 * pegado. Devuelve además las sedes activas de la cadena.
 */
export async function resolveTienda(slug: string): Promise<TiendaGate> {
  const s = (slug ?? "").trim().toLowerCase();
  if (!s || s.length > 120) return { ok: false };
  const row = await prisma.barbershop.findUnique({ where: { slug: s }, select: TIENDA_SHOP_SELECT });
  if (!row || !row.isActive) return { ok: false };
  if (!(await barberiaAlCorriente(row))) return { ok: false };
  const plan = await getBarberPlan(row.plan);
  if (plan.features.products !== true) return { ok: false };
  const ready = await tiendaReady(prisma);
  if (!ready.columns) return { ok: false };
  const rootId = row.parentId ?? row.id;
  const sedes = await prisma.barbershop.findMany({
    where: { isActive: true, OR: [{ id: rootId }, { parentId: rootId }] },
    select: { id: true, name: true, slug: true, branchName: true, address: true, city: true },
    orderBy: [{ createdAt: "asc" }],
    take: 50,
  });
  return {
    ok: true,
    shop: { ...branchOf(row), phone: row.phone, logoUrl: row.logoUrl, locale: row.locale, timezone: row.timezone || "America/Mexico_City" },
    branches: sedes.map(branchOf),
    ordersReady: ready.orders,
  };
}

interface WebProductRaw {
  id: string;
  barbershopId: string;
  name: string;
  price: unknown;
  unit: string | null;
  stock: number;
  minStock: number | null;
  photoUrl: string | null;
  category: string | null;
  description: string | null;
  onlineOrder: boolean;
}

async function webProducts(branchIds: string[], ordersReady: boolean, onlyId?: string): Promise<TiendaProduct[]> {
  if (branchIds.length === 0) return [];
  const rows = onlyId
    ? await prisma.$queryRaw<WebProductRaw[]>`
        SELECT "id", "barbershopId", "name", "price", "unit", "stock", "minStock", "photoUrl", "category", "description", "onlineOrder"
        FROM "barber_products"
        WHERE "id" = ${onlyId} AND "barbershopId" = ANY(${branchIds}::text[]) AND "isActive" = true AND "showOnWeb" = true`
    : await prisma.$queryRaw<WebProductRaw[]>`
        SELECT "id", "barbershopId", "name", "price", "unit", "stock", "minStock", "photoUrl", "category", "description", "onlineOrder"
        FROM "barber_products"
        WHERE "barbershopId" = ANY(${branchIds}::text[]) AND "isActive" = true AND "showOnWeb" = true
        ORDER BY ("photoUrl" IS NULL), "category" NULLS LAST, "name"
        LIMIT 300`;
  let reserved = new Map<string, number>();
  if (ordersReady && rows.length > 0) {
    await sweepExpiredOrders(prisma, branchIds);
    reserved = await reservedByProduct(prisma, branchIds);
  }
  return rows.map((r) => {
    const available = Math.max(0, r.stock - (reserved.get(r.id) ?? 0));
    return {
      id: r.id,
      branchId: r.barbershopId,
      name: r.name,
      price: Number(r.price),
      unit: r.unit,
      photoUrl: r.photoUrl,
      category: r.category,
      description: r.description,
      available,
      tag: stockTag(available, r.minStock),
      orderable: ordersReady && r.onlineOrder === true,
    };
  });
}

export async function loadTienda(gate: TiendaGateOk): Promise<TiendaProduct[]> {
  return webProducts(gate.branches.map((b) => b.id), gate.ordersReady);
}

export async function loadTiendaProduct(gate: TiendaGateOk, productId: string): Promise<TiendaProduct | null> {
  if (typeof productId !== "string" || !productId || productId.length > 64) return null;
  const rows = await webProducts(gate.branches.map((b) => b.id), gate.ordersReady, productId);
  return rows[0] ?? null;
}

/**
 * Los destacados para la página de la barbería (solo esa sede): con foto
 * primero, hasta TIENDA_FEATURED_MAX. Nunca lanza: sin SQL o sin plan, [].
 */
export async function loadFeaturedProducts(shop: { id: string; plan?: string | null }): Promise<TiendaProduct[]> {
  try {
    if (!(await tiendaReady(prisma)).columns) return [];
    const planId = shop.plan !== undefined ? shop.plan : (await prisma.barbershop.findUnique({ where: { id: shop.id }, select: { plan: true } }))?.plan;
    const plan = await getBarberPlan(planId ?? null);
    if (plan.features.products !== true) return [];
    const all = await webProducts([shop.id], false);
    return all.slice(0, TIENDA_FEATURED_MAX);
  } catch (e) {
    console.warn("[barber/tienda] destacados:", (e as Error).message);
    return [];
  }
}

export interface WebTiendaResumen {
  /** Plan con productos y SQL de la tienda pegado: hay sección «Tienda» que ofrecer. */
  disponible: boolean;
  /** Los que salen en la sección de la página: hasta TIENDA_FEATURED_MAX, los de esta sede primero. */
  products: TiendaProduct[];
  /** Cuántos productos se ven en /b/<slug>/tienda (activos y con «Mostrar en mi página», de toda la cadena). */
  total: number;
}

/**
 * La sección «Tienda» de la página de la barbería y de Mi web (16-nov).
 * Cuenta lo MISMO que la tienda pública: los productos de toda la cadena
 * (la tienda de un slug junta las sedes activas). Nunca lanza.
 */
export async function loadWebTienda(shopId: string): Promise<WebTiendaResumen> {
  const vacio: WebTiendaResumen = { disponible: false, products: [], total: 0 };
  try {
    if (!(await tiendaReady(prisma)).columns) return vacio;
    const shop = await prisma.barbershop.findUnique({ where: { id: shopId }, select: { id: true, plan: true, parentId: true } });
    if (!shop) return vacio;
    const plan = await getBarberPlan(shop.plan ?? null);
    if (plan.features.products !== true) return vacio;
    const rootId = shop.parentId ?? shop.id;
    const sedes = await prisma.barbershop.findMany({
      where: { isActive: true, OR: [{ id: rootId }, { parentId: rootId }] },
      select: { id: true },
      take: 50,
    });
    const ids = Array.from(new Set([shop.id, ...sedes.map((s) => s.id)]));
    const all = await webProducts(ids, false);
    // Los de esta sede primero; dentro, el orden de siempre (foto, categoría, nombre).
    const propios = all.filter((p) => p.branchId === shop.id);
    const otros = all.filter((p) => p.branchId !== shop.id);
    return { disponible: true, products: [...propios, ...otros].slice(0, TIENDA_FEATURED_MAX), total: all.length };
  } catch (e) {
    console.warn("[barber/tienda] sección de la página:", (e as Error).message);
    return vacio;
  }
}

// ── Apartar ─────────────────────────────────────────────────────────────

export interface CreatedOrder {
  id: string;
  folio: string;
  total: number;
  items: OrderItem[];
  branch: TiendaBranch;
  expiresAt: string;
}

/**
 * Crea el pedido (PENDING, pago en la barbería). Todo en UNA transacción:
 *   1. vence lo viejo de esa sede;
 *   2. tope de pedidos vivos por teléfono;
 *   3. BLOQUEA las filas de los productos (FOR UPDATE, en orden de id): dos
 *      personas apartando la última pieza se ponen en fila y la segunda ya
 *      ve lo que apartó la primera;
 *   4. exige que cada producto se muestre, se pueda apartar y alcance
 *      (stock − apartado);
 *   5. congela el precio y escribe el pedido con un folio libre.
 * Nunca toca barber_products.stock: el inventario baja al cobrar en Caja.
 */
export async function createTiendaOrder(args: {
  gate: TiendaGateOk;
  lines: OrderRequestLine[];
  name: string;
  phone: string;
  /** Cliente del portal («mi cuenta») de ESA sede, si entró. */
  portalClient: { barbershopId: string; clientId: string } | null;
  /** Eligió «Pagar ahora en línea» (pay_method MERCADOPAGO; el pago lo marca ws6-t5). */
  payOnline?: boolean;
}): Promise<CreatedOrder> {
  const { gate, lines } = args;
  if (!gate.ordersReady) throw new TiendaError(409, "ORDERS_SQL_PENDING", "Esta tienda todavía no recibe pedidos en línea.");
  const branchIds = gate.branches.map((b) => b.id);
  const ids = Array.from(new Set(lines.map((l) => l.productId))).sort();

  return prisma.$transaction(
    async (tx) => {
      const products = await tx.$queryRaw<Array<WebProductRaw & { isActive: boolean; showOnWeb: boolean }>>`
        SELECT "id", "barbershopId", "name", "price", "unit", "stock", "minStock", "photoUrl", "category", "description",
               "onlineOrder", "isActive", "showOnWeb"
        FROM "barber_products"
        WHERE "id" = ANY(${ids}::text[]) AND "barbershopId" = ANY(${branchIds}::text[])
        ORDER BY "id"
        FOR UPDATE
      `;
      const byId = new Map(products.map((p) => [p.id, p]));
      for (const id of ids) {
        const p = byId.get(id);
        if (!p || !p.isActive || !p.showOnWeb || !p.onlineOrder) {
          throw new TiendaError(409, "NOT_ORDERABLE", "Uno de los productos ya no se puede apartar en línea.");
        }
      }
      const shopIds = Array.from(new Set(products.map((p) => p.barbershopId)));
      if (shopIds.length !== 1) throw new TiendaError(400, "MIXED_BRANCHES", "Un pedido se recoge en una sola sucursal.");
      const barbershopId = shopIds[0];
      const branch = gate.branches.find((b) => b.id === barbershopId);
      if (!branch) throw new TiendaError(409, "NOT_ORDERABLE", "Esa sucursal no está disponible.");

      await sweepExpiredOrders(tx, [barbershopId]);

      const open = await tx.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS "n" FROM "barber_product_orders"
        WHERE "barbershop_id" = ${barbershopId} AND "client_phone" = ${args.phone}
          AND "status" IN ('PENDING', 'PAID_ONLINE', 'READY')
      `;
      if (Number(open[0]?.n ?? 0) >= TIENDA_MAX_OPEN_PER_PHONE) {
        throw new TiendaError(409, "TOO_MANY_OPEN", "Ya tienes pedidos apartados en esta barbería. Recógelos o escríbeles para apartar más.");
      }

      const reserved = await reservedByProduct(tx, [barbershopId]);
      const items: OrderItem[] = lines.map((l) => {
        const p = byId.get(l.productId)!;
        const available = Math.max(0, p.stock - (reserved.get(p.id) ?? 0));
        if (l.qty > available) {
          throw new TiendaError(
            409,
            "OUT_OF_STOCK",
            available > 0 ? `De «${p.name}» solo quedan ${available} para apartar.` : `«${p.name}» se agotó.`,
            { productId: p.id, available },
          );
        }
        return { productId: p.id, name: p.name, unitPrice: Number(Number(p.price).toFixed(2)), qty: l.qty };
      });
      const totalCents = orderTotalCents(items);
      const total = (totalCents / 100).toFixed(2);
      const clientId = args.portalClient && args.portalClient.barbershopId === barbershopId ? args.portalClient.clientId : null;
      const payMethod: ProductOrderPayMethod = args.payOnline === true ? "MERCADOPAGO" : "STORE";

      for (let intento = 0; intento < 8; intento++) {
        const folio = makeFolio();
        const rows = await tx.$queryRaw<Array<{ id: string; created_at: Date }>>`
          INSERT INTO "barber_product_orders"
            ("id", "barbershop_id", "branch_id", "folio", "client_id", "client_name", "client_phone", "items", "total", "status", "pay_method")
          VALUES (gen_random_uuid()::text, ${barbershopId}, ${barbershopId}, ${folio}, ${clientId}, ${args.name}, ${args.phone},
                  ${JSON.stringify(items)}::jsonb, ${total}::numeric, 'PENDING', ${payMethod})
          ON CONFLICT ("barbershop_id", "folio") DO NOTHING
          RETURNING "id", "created_at"
        `;
        if (rows[0]) {
          return {
            id: rows[0].id,
            folio,
            total: totalCents / 100,
            items,
            branch,
            expiresAt: orderExpiresAt(rows[0].created_at).toISOString(),
          };
        }
      }
      throw new TiendaError(503, "FOLIO_BUSY", "No pudimos apartar tu pedido. Intenta de nuevo.");
    },
    { maxWait: 5000, timeout: 15000 },
  );
}

/**
 * Nombre y teléfono del cliente que ya entró a «mi cuenta» de alguna sede de
 * esta cadena (la cookie del portal vale solo para la sede que la emitió).
 */
export async function portalPrefill(
  gate: TiendaGateOk,
  getSession: (barbershopId: string) => Promise<{ clientId: string } | null>,
): Promise<{ name: string; phone: string } | null> {
  for (const b of gate.branches) {
    const s = await getSession(b.id);
    if (!s) continue;
    const c = await prisma.barberClient.findFirst({ where: { id: s.clientId, barbershopId: b.id }, select: { name: true, phone: true } });
    return c ? { name: c.name, phone: c.phone ?? "" } : null;
  }
  return null;
}

/** Para el «mi cuenta» del cliente y la pantalla del folio: el pedido por id. */
export interface PublicOrderView {
  id: string;
  folio: string;
  status: ProductOrderStatus;
  paidOnline: boolean;
  total: number;
  items: OrderItem[];
  branch: TiendaBranch | null;
  /** Hasta cuándo se aparta (null si ya se pagó o ya no está vivo). */
  expiresAt: string | null;
}

/**
 * La página del folio (/b/<slug>/tienda/pedido/<id>). El id es un UUID que
 * solo conoce quien apartó; aun así no sale ni el teléfono ni el nombre.
 */
export async function getPublicOrder(gate: TiendaGateOk, orderId: string): Promise<PublicOrderView | null> {
  if (!gate.ordersReady || typeof orderId !== "string" || !orderId || orderId.length > 64) return null;
  const ids = gate.branches.map((b) => b.id);
  await sweepExpiredOrders(prisma, ids);
  const rows = await prisma.$queryRaw<Array<{ id: string; folio: string; status: string; paid_at: Date | null; total: unknown; items: unknown; created_at: Date; branch_id: string }>>`
    SELECT "id", "folio", "status", "paid_at", "total", "items", "created_at", "branch_id" FROM "barber_product_orders"
    WHERE "id" = ${orderId} AND "barbershop_id" = ANY(${ids}::text[])
  `;
  const r = rows[0];
  if (!r) return null;
  const status = r.status as ProductOrderStatus;
  return {
    id: r.id,
    folio: r.folio,
    status,
    paidOnline: r.paid_at !== null,
    total: Number(r.total),
    items: parseOrderItems(r.items),
    branch: gate.branches.find((b) => b.id === r.branch_id) ?? null,
    expiresAt: isOpenOrderStatus(status) && !r.paid_at ? orderExpiresAt(r.created_at).toISOString() : null,
  };
}

/** Respuesta HTTP uniforme para TiendaError (y 500 para lo demás). */
export function tiendaErrorBody(e: unknown): { status: number; body: Record<string, unknown> } | null {
  if (e instanceof TiendaError) {
    return { status: e.status, body: { error: e.message, code: e.code, ...(e.details ?? {}) } };
  }
  return null;
}

/** Para las rutas del panel: TiendaError → su status; lo demás, como Caja. */
export function tiendaPanelError(e: unknown): NextResponse {
  const t = tiendaErrorBody(e);
  if (t) return NextResponse.json(t.body, { status: t.status });
  return moneyErrorResponse(e);
}
