// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — TIENDA DE PRODUCTOS: la parte sin sesión.
//
// Sin "server-only" y sin importar prisma: cash.ts (que las pruebas cargan
// en Node pelado) la usa para entregar un pedido dentro de la transacción
// del ticket, y las páginas públicas y el panel la comparten.
//
// Las columnas de la tienda (barber_products.photoUrl/category/description/
// showOnWeb/onlineOrder) y la tabla barber_product_orders nacen en
// sql/barber_tienda.sql. El cliente Prisma compartido NO las conoce (no se
// regenera desde una rama), así que todo lo de aquí va por SQL crudo y
// pregunta antes si existen: sin el SQL pegado, la pantalla sigue como hoy.
//
// CONTRATO CON ws6-t5 (Mercado Pago) — ver sql/barber_tienda.sql:
//   · t1 crea el pedido PENDING con `items` = [{productId, name, unitPrice,
//     qty}] y el precio CONGELADO; t5 lo marca PAID_ONLINE (paid_at,
//     mp_payment_id) desde su webhook y no toca otra columna.
//   · «Pagado» se lee de paid_at (no del status): un pedido pagado que la
//     barbería marca «Listo» sigue pagado.
//
// APARTAR: lo apartado (PENDING/READY sin pagar de menos de 72 h, y todo lo
// pagado que no se ha entregado) se RESTA de lo que la tienda ofrece, pero el
// inventario real (barber_products.stock) solo baja al cobrar en Caja.
// ═══════════════════════════════════════════════════════════════════════
import type { Prisma } from "@prisma/client";

type RawDb = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;
type QueryDb = Pick<Prisma.TransactionClient, "$queryRaw">;

// ── Reglas (una constante cada una; ver DECISIONES PARA RAFAEL) ──────────

/** Horas que un pedido sin pagar aparta las piezas antes de vencer. */
export const TIENDA_HOLD_HOURS = 72;
/** Piezas de un mismo producto en un pedido. */
export const TIENDA_MAX_QTY_PER_LINE = 10;
/** Productos distintos en un pedido. */
export const TIENDA_MAX_LINES = 10;
/** Pedidos vivos (sin entregar ni vencer) por teléfono en una barbería. */
export const TIENDA_MAX_OPEN_PER_PHONE = 3;
/** Largo de la categoría y de la descripción corta. */
export const PRODUCT_CATEGORY_MAX = 40;
export const PRODUCT_DESCRIPTION_MAX = 280;
/** Destacados en la página de la barbería. */
export const TIENDA_FEATURED_MAX = 4;

export const PRODUCT_ORDER_STATUSES = ["PENDING", "PAID_ONLINE", "READY", "PICKED_UP", "CANCELLED", "EXPIRED"] as const;
export type ProductOrderStatus = (typeof PRODUCT_ORDER_STATUSES)[number];
export type ProductOrderPayMethod = "STORE" | "MERCADOPAGO";

/** Estados que todavía esperan al cliente (y pueden apartar piezas). */
export const OPEN_ORDER_STATUSES: readonly ProductOrderStatus[] = ["PENDING", "PAID_ONLINE", "READY"];

export function isOpenOrderStatus(s: unknown): s is ProductOrderStatus {
  return typeof s === "string" && (OPEN_ORDER_STATUSES as readonly string[]).includes(s);
}

export class TiendaError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "TiendaError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ── Etiqueta de existencias ─────────────────────────────────────────────

export type StockTag = "available" | "low" | "out";

/**
 * Disponible / Pocas / Agotado. «Pocas» = en o por debajo del mínimo de la
 * barbería (el mismo umbral de la alerta de Productos); sin mínimo nunca es
 * «Pocas». `available` es lo que se puede vender: en el panel el stock; en la
 * tienda, el stock menos lo apartado.
 */
export function stockTag(available: number, minStock: number | null | undefined): StockTag {
  if (!(available > 0)) return "out";
  if (minStock !== null && minStock !== undefined && available <= minStock) return "low";
  return "available";
}

// ── Pedido: forma ───────────────────────────────────────────────────────

export interface OrderItem {
  productId: string;
  name: string;
  /** Precio unitario CONGELADO al apartar, en pesos con 2 decimales. */
  unitPrice: number;
  qty: number;
}

/** Lee `items` de la base sin fiarse de su forma. */
export function parseOrderItems(raw: unknown): OrderItem[] {
  const arr = typeof raw === "string" ? safeJson(raw) : raw;
  if (!Array.isArray(arr)) return [];
  const out: OrderItem[] = [];
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const productId = typeof o.productId === "string" ? o.productId : "";
    const qty = Number(o.qty);
    const unitPrice = Number(o.unitPrice);
    if (!productId || !Number.isInteger(qty) || qty < 1 || !Number.isFinite(unitPrice) || unitPrice < 0) continue;
    out.push({ productId, name: typeof o.name === "string" ? o.name : "", unitPrice, qty });
  }
  return out;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Total en CENTAVOS (entero): Σ unitPrice × qty sin errores de coma flotante. */
export function orderTotalCents(items: Array<Pick<OrderItem, "unitPrice" | "qty">>): number {
  return items.reduce((s, it) => s + Math.round(it.unitPrice * 100) * it.qty, 0);
}

export interface OrderRequestLine {
  productId: string;
  qty: number;
}

export interface OrderRequest {
  lines: OrderRequestLine[];
  name: string;
  phone: string;
}

/**
 * Valida la FORMA de lo que manda la tienda pública (sin tocar la base). Que
 * los productos existan, se puedan apartar y alcancen lo decide el servidor
 * dentro de la transacción. El nombre y el teléfono los limpia quien llama
 * (las mismas reglas que la reserva), aquí solo se exige que lleguen.
 */
export function normalizeOrderLines(raw: unknown): OrderRequestLine[] {
  const arr = Array.isArray(raw) ? raw : [];
  if (arr.length === 0) throw new TiendaError(400, "EMPTY_ORDER", "Elige al menos un producto.");
  if (arr.length > TIENDA_MAX_LINES) throw new TiendaError(400, "TOO_MANY_LINES", `Máximo ${TIENDA_MAX_LINES} productos por pedido.`);
  const byId = new Map<string, number>();
  for (const it of arr) {
    const o = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
    const productId = typeof o.productId === "string" && o.productId.length > 0 && o.productId.length <= 64 ? o.productId : null;
    const qty = Number(o.qty ?? 1);
    if (!productId) throw new TiendaError(400, "BAD_LINE", "Producto inválido.");
    if (!Number.isInteger(qty) || qty < 1) throw new TiendaError(400, "BAD_QTY", "Cantidad inválida.");
    byId.set(productId, (byId.get(productId) ?? 0) + qty);
  }
  const lines = Array.from(byId.entries()).map(([productId, qty]) => ({ productId, qty }));
  for (const l of lines) {
    if (l.qty > TIENDA_MAX_QTY_PER_LINE) {
      throw new TiendaError(400, "BAD_QTY", `Máximo ${TIENDA_MAX_QTY_PER_LINE} piezas de un mismo producto.`);
    }
  }
  return lines;
}

// ── Folio ───────────────────────────────────────────────────────────────

/** Sin 0/O, 1/I/L, 2/Z, 5/S, 8/B: se dicta por teléfono sin confusiones. */
const FOLIO_ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679";
export const FOLIO_LENGTH = 5;

export function makeFolio(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < FOLIO_LENGTH; i++) s += FOLIO_ALPHABET[Math.floor(rand() * FOLIO_ALPHABET.length) % FOLIO_ALPHABET.length];
  return s;
}

// ── Vencimiento ─────────────────────────────────────────────────────────

export function orderExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + TIENDA_HOLD_HOURS * 3600_000);
}

/** ¿Este pedido ya venció? Lo pagado en línea nunca vence (hay dinero de por medio). */
export function isOrderExpired(o: { status: string; createdAt: Date; paidAt: Date | null }, now: Date = new Date()): boolean {
  if (o.status === "EXPIRED") return true;
  if (o.paidAt) return false;
  if (o.status !== "PENDING" && o.status !== "READY") return false;
  return orderExpiresAt(o.createdAt).getTime() <= now.getTime();
}

// ── Foto del producto ───────────────────────────────────────────────────

/**
 * Carpeta de las fotos de UN producto en el bucket PÚBLICO (la foto sale en
 * la tienda y como og:image, así que no puede ser una liga firmada que
 * caduca). El shopId sale de la FILA del producto, nunca del body.
 */
export function carpetaFotoProducto(barbershopId: string, productId: string): string {
  return `barber/${barbershopId}/productos/${productId}`;
}

// ── Ligas ───────────────────────────────────────────────────────────────

export function rutaTienda(slug: string): string {
  return `/b/${encodeURIComponent(slug)}/tienda`;
}

export function rutaProductoTienda(slug: string, productId: string): string {
  return `${rutaTienda(slug)}/${encodeURIComponent(productId)}`;
}

/**
 * Liga de WhatsApp (wa.me). NUNCA se manda nada por la API: la abre la
 * persona y ella decide si envía. Con teléfono de 10 dígitos va directo a ese
 * chat (lada 52); sin teléfono, WhatsApp pregunta a quién.
 */
export function waMeLink(text: string, phone10?: string | null): string {
  const digits = String(phone10 ?? "").replace(/\D/g, "");
  const to = digits.length === 10 ? `52${digits}` : digits.length === 12 && digits.startsWith("52") ? digits : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

// ── ¿Está pegado el SQL? ────────────────────────────────────────────────

export interface TiendaReady {
  /** Las 5 columnas nuevas de barber_products. */
  columns: boolean;
  /** La tabla barber_product_orders. */
  orders: boolean;
}

const TIENDA_COLUMNS = ["photoUrl", "category", "description", "showOnWeb", "onlineOrder"];
// Una vez vistas, ya no se vuelve a preguntar en este proceso (nunca se quitan).
let seenColumns = false;
let seenOrders = false;

/**
 * Pregunta por catálogo (nunca falla, no aborta una transacción). Sin las
 * columnas, nada de la tienda aparece; sin la tabla, no se puede apartar.
 */
export async function tiendaReady(db: QueryDb): Promise<TiendaReady> {
  if (seenColumns && seenOrders) return { columns: true, orders: true };
  try {
    const rows = await db.$queryRaw<Array<{ n: number; t: boolean }>>`
      SELECT
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'barber_products'
            AND column_name IN ('photoUrl', 'category', 'description', 'showOnWeb', 'onlineOrder')) AS "n",
        (to_regclass('public.barber_product_orders') IS NOT NULL) AS "t"
    `;
    const columns = Number(rows[0]?.n ?? 0) === TIENDA_COLUMNS.length;
    const orders = rows[0]?.t === true;
    if (columns) seenColumns = true;
    if (orders) seenOrders = true;
    return { columns, orders: columns && orders };
  } catch {
    return { columns: false, orders: false };
  }
}

/** Solo para las pruebas: olvida lo visto. */
export function resetTiendaReadyCache(): void {
  seenColumns = false;
  seenOrders = false;
}

// ── Lo apartado y lo vencido ────────────────────────────────────────────

/**
 * Pasa a EXPIRED lo que lleva más de TIENDA_HOLD_HOURS sin pagar ni recoger.
 * Se corre al leer (panel y tienda) y al apartar: no hace falta un cron, y lo
 * apartado nunca cuenta lo vencido aunque esto no haya corrido.
 */
export async function sweepExpiredOrders(db: RawDb, barbershopIds: string[]): Promise<number> {
  if (barbershopIds.length === 0) return 0;
  return db.$executeRaw`
    UPDATE "barber_product_orders"
    SET "status" = 'EXPIRED', "updated_at" = now()
    WHERE "barbershop_id" = ANY(${barbershopIds}::text[])
      AND "status" IN ('PENDING', 'READY')
      AND "paid_at" IS NULL
      AND "created_at" <= now() - make_interval(hours => ${TIENDA_HOLD_HOURS}::int)
  `;
}

/** Piezas apartadas por producto en esas sedes (pedidos vivos sin entregar). */
export async function reservedByProduct(db: QueryDb, barbershopIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (barbershopIds.length === 0) return out;
  const rows = await db.$queryRaw<Array<{ productId: string; qty: number }>>`
    SELECT (it->>'productId') AS "productId", SUM((it->>'qty')::int)::int AS "qty"
    FROM "barber_product_orders" o, jsonb_array_elements(o."items") it
    WHERE o."barbershop_id" = ANY(${barbershopIds}::text[])
      AND (
        (o."paid_at" IS NOT NULL AND o."status" IN ('PENDING', 'PAID_ONLINE', 'READY'))
        OR (o."paid_at" IS NULL AND o."status" IN ('PENDING', 'READY')
            AND o."created_at" > now() - make_interval(hours => ${TIENDA_HOLD_HOURS}::int))
      )
    GROUP BY 1
  `;
  for (const r of rows) out.set(r.productId, Number(r.qty) || 0);
  return out;
}

// ── Entregar desde Caja (dentro de la transacción del ticket) ───────────

export interface OrderForCharge {
  id: string;
  folio: string;
  status: ProductOrderStatus;
  clientId: string | null;
  items: OrderItem[];
  total: number;
  paidAt: Date | null;
}

/**
 * Bloquea el pedido (FOR UPDATE) para cobrarlo. Dos «Entregar y cobrar» del
 * mismo pedido se ponen en fila: el segundo ya lo ve entregado. null si no es
 * de esta barbería o no existe.
 */
export async function lockOrderForChargeTx(
  tx: QueryDb,
  args: { orderId: string; barbershopId: string },
): Promise<OrderForCharge | null> {
  const rows = await tx.$queryRaw<
    Array<{ id: string; folio: string; status: string; client_id: string | null; items: unknown; total: unknown; paid_at: Date | null }>
  >`
    SELECT "id", "folio", "status", "client_id", "items", "total", "paid_at"
    FROM "barber_product_orders"
    WHERE "id" = ${args.orderId} AND "barbershop_id" = ${args.barbershopId}
    FOR UPDATE
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    folio: r.folio,
    status: r.status as ProductOrderStatus,
    clientId: r.client_id,
    items: parseOrderItems(r.items),
    total: Number(r.total),
    paidAt: r.paid_at,
  };
}

/**
 * Las líneas del ticket tienen que traer EXACTAMENTE las piezas del pedido
 * (por producto). Un pedido sin pagar admite además otras líneas (un corte,
 * otro producto); uno pagado en línea, no: se registra tal cual se pagó.
 */
export function checkOrderLines(
  order: Pick<OrderForCharge, "items">,
  lines: Array<{ kind: "service" | "product"; id: string; qty: number }>,
  opts: { exact: boolean },
): string | null {
  const want = new Map<string, number>();
  for (const it of order.items) want.set(it.productId, (want.get(it.productId) ?? 0) + it.qty);
  const got = new Map<string, number>();
  for (const l of lines) if (l.kind === "product" && want.has(l.id)) got.set(l.id, (got.get(l.id) ?? 0) + l.qty);
  for (const [id, qty] of Array.from(want.entries())) {
    if (got.get(id) !== qty) return "Las piezas del ticket no coinciden con las del pedido.";
  }
  if (opts.exact) {
    const others = lines.filter((l) => l.kind !== "product" || !want.has(l.id));
    if (others.length > 0) return "Un pedido pagado en línea se entrega tal cual: sin otras líneas.";
  }
  return null;
}

/** Entregado por ESE ticket. Una sola vez: exige que siga abierto. */
export async function markOrderPickedUpTx(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  args: { orderId: string; barbershopId: string; saleId: string },
): Promise<boolean> {
  const n = await tx.$executeRaw`
    UPDATE "barber_product_orders"
    SET "status" = 'PICKED_UP', "sale_id" = ${args.saleId}, "picked_up_at" = now(), "updated_at" = now()
    WHERE "id" = ${args.orderId} AND "barbershop_id" = ${args.barbershopId}
      AND "status" IN ('PENDING', 'PAID_ONLINE', 'READY')
  `;
  return n === 1;
}

/**
 * Cancelar el ticket que entregó un pedido lo REABRE (como una nota «Por
 * cobrar»): vuelve a «Listo para recoger», o a «Pagado en línea» si se pagó.
 * Misma transacción que la cancelación. Sin la tabla, 0.
 */
export async function reopenOrderOfCancelledSaleTx(
  tx: RawDb,
  args: { saleId: string; barbershopId: string },
): Promise<number> {
  const ready = await tx.$queryRaw<Array<{ ok: boolean }>>`
    SELECT to_regclass('public.barber_product_orders') IS NOT NULL AS "ok"
  `;
  if (ready[0]?.ok !== true) return 0;
  return tx.$executeRaw`
    UPDATE "barber_product_orders"
    SET "status" = CASE WHEN "paid_at" IS NOT NULL THEN 'PAID_ONLINE' ELSE 'READY' END,
        "sale_id" = NULL, "picked_up_at" = NULL, "updated_at" = now()
    WHERE "sale_id" = ${args.saleId} AND "barbershop_id" = ${args.barbershopId} AND "status" = 'PICKED_UP'
  `;
}
