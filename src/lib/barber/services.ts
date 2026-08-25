// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — catálogo de SERVICIOS (/barber/servicios).
//
// Es la pantalla más consecuente del panel: estos precios son los que ve el
// cliente en la reserva pública, en la mini-web, en el bot de WhatsApp, en
// la agenda y en el ticket. Todos esos consumidores leen BarberService con
// `isActive: true` y el precio vivo, así que aquí no hay caché que refrescar:
// lo que se guarda, se ve.
//
// ── LO QUE NO SE NEGOCIA ──────────────────────────────────────────────
// · barbershopId sale SIEMPRE del contexto de sesión. Ni el body ni el
//   query participan. Un `undefined` en el where BORRA el filtro de tenant
//   en Prisma, por eso cada query escribe `barbershopId: ctx.barbershopId`
//   literalmente.
// · Precios en Decimal (parseMoneyInput → Prisma.Decimal), duraciones en
//   enteros de minutos. Jamás un float.
// · El precio de una cita se CONGELA al agendarla en
//   BarberAppointmentService.priceAtBooking. Cambiar el precio aquí NO toca
//   las citas ya agendadas — y la pantalla se lo dice al dueño ANTES de
//   guardar, con el número de citas futuras que conservan el precio viejo.
// · Un servicio con citas o ventas NO se borra: se retira (isActive=false)
//   y sale de todos los pickers sin romper el historial. Borrar de verdad
//   solo se permite con cero citas y cero ventas, y aun así la FK
//   (BarberAppointmentService.service → NoAction) es la última red.
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertBarberPermission, type BarberContext } from "@/lib/barber-auth";
import { BARBER_DEFAULT_SERVICES, type BarberServiceDTO } from "@/lib/barber/types";
import { BarberAdminError, cleanMultiline, cleanText } from "@/lib/barber/branches";
import { parseMoneyInput, toNum } from "@/lib/barber/commissions";

// ── Límites del catálogo ────────────────────────────────────────────────
export const SERVICE_NAME_MAX = 120;
export const SERVICE_DESCRIPTION_MAX = 600;
export const SERVICE_CATEGORY_MAX = 40;
/** Duración en minutos: escalón de 5, entre 5 min y 10 h (mismo tope que la reserva). */
export const SERVICE_DURATION_MIN = 5;
export const SERVICE_DURATION_MAX = 600;
export const SERVICE_DURATION_STEP = 5;
export const SERVICE_PRICE_MAX = 99_999.99;
/** Tope de servicios por barbería (la mini-web lista hasta 120). */
export const SERVICE_COUNT_MAX = 120;

/** Categoría por defecto del schema (`BarberService.category @default("general")`). */
export const SERVICE_CATEGORY_DEFAULT = "general";

/**
 * Categorías sugeridas en el formulario. Salen de las que ya trae el catálogo
 * semilla (las mismas que agrupa la mini-web) más la del schema: no es una
 * lista cerrada, la barbería puede escribir la suya.
 */
export const SERVICE_CATEGORY_SUGGESTIONS: string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of BARBER_DEFAULT_SERVICES) {
    if (!seen.has(s.category)) {
      seen.add(s.category);
      out.push(s.category);
    }
  }
  if (!seen.has(SERVICE_CATEGORY_DEFAULT)) out.push(SERVICE_CATEGORY_DEFAULT);
  return out;
})();

// ── Tipos ───────────────────────────────────────────────────────────────

/** Fila del catálogo + lo que la pantalla necesita para decidir qué ofrecer. */
export interface BarberServiceRow extends BarberServiceDTO {
  /** Citas (cualquier estado) que ya lo incluyen. */
  appointmentsCount: number;
  /** Citas FUTURAS pendientes o confirmadas: las que conservan su precio congelado. */
  upcomingCount: number;
  /** Líneas de venta (tickets) que lo referencian. */
  salesCount: number;
  /** true = cero citas y cero ventas: se puede borrar de verdad. */
  deletable: boolean;
}

export interface ServiceInput {
  name?: unknown;
  description?: unknown;
  durationMin?: unknown;
  price?: unknown;
  category?: unknown;
  isActive?: unknown;
}

/** Lo que devuelve el listado: filas + categorías en uso (para el formulario). */
export interface ServiceCatalog {
  services: BarberServiceRow[];
  categories: string[];
}

type ServiceRaw = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  price: Prisma.Decimal;
  category: string;
  isActive: boolean;
  sortOrder: number;
};

const SERVICE_SELECT = {
  id: true,
  name: true,
  description: true,
  durationMin: true,
  price: true,
  category: true,
  isActive: true,
  sortOrder: true,
} as const;

const SERVICE_ORDER = [{ sortOrder: "asc" }, { name: "asc" }] as const;

/** Estados de cita que todavía van a ocurrir (la cita existe y aparta hueco). */
const UPCOMING_STATUSES = ["PENDING", "CONFIRMED"] as const;

export function toServiceDTO(s: ServiceRaw): BarberServiceDTO {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    durationMin: s.durationMin,
    price: toNum(s.price),
    category: s.category,
    isActive: s.isActive,
    sortOrder: s.sortOrder,
  };
}

// ── Saneado de entrada ──────────────────────────────────────────────────

/** Categoría en minúsculas, sin controles, ≤40. Vacía → la del schema. */
export function normalizeServiceCategory(raw: unknown): string {
  const v = cleanText(raw, SERVICE_CATEGORY_MAX).toLowerCase();
  return v || SERVICE_CATEGORY_DEFAULT;
}

/**
 * Duración: entero de minutos redondeado al escalón de 5, dentro de
 * [5, 600]. Un valor que no es número es 400, no un silencio.
 */
export function normalizeServiceDuration(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    throw new BarberAdminError("La duración tiene que ser un número de minutos.");
  }
  const stepped = Math.round(n / SERVICE_DURATION_STEP) * SERVICE_DURATION_STEP;
  if (stepped < SERVICE_DURATION_MIN || stepped > SERVICE_DURATION_MAX) {
    throw new BarberAdminError(
      `La duración va de ${SERVICE_DURATION_MIN} a ${SERVICE_DURATION_MAX} minutos.`,
    );
  }
  return stepped;
}

/** Precio: Decimal ≥ 0 con máximo 2 decimales (parseMoneyInput lanza 400 si no). */
export function normalizeServicePrice(raw: unknown): Prisma.Decimal {
  try {
    return parseMoneyInput(raw, { field: "precio", required: true, max: SERVICE_PRICE_MAX });
  } catch (e) {
    throw new BarberAdminError(
      e instanceof Error && e.message ? `Precio no válido: ${e.message}` : "Precio no válido.",
    );
  }
}

// ── Conteos de uso ──────────────────────────────────────────────────────

/**
 * Cuántas citas y ventas referencian cada servicio. Los ids YA vienen
 * filtrados por barbershopId (los sacó listServices), así que el `in` no
 * puede cruzar de barbería; el filtro de la cita se mantiene igual por
 * defensa en profundidad.
 */
async function countUsage(
  barbershopId: string,
  ids: string[],
  now: Date,
): Promise<Map<string, { appointments: number; upcoming: number; sales: number }>> {
  const out = new Map<string, { appointments: number; upcoming: number; sales: number }>();
  for (const id of ids) out.set(id, { appointments: 0, upcoming: 0, sales: 0 });
  if (ids.length === 0) return out;

  const [appts, upcoming, sales] = await Promise.all([
    prisma.barberAppointmentService.groupBy({
      by: ["serviceId"],
      where: { serviceId: { in: ids }, appointment: { barbershopId } },
      _count: { _all: true },
    }),
    prisma.barberAppointmentService.groupBy({
      by: ["serviceId"],
      where: {
        serviceId: { in: ids },
        appointment: {
          barbershopId,
          startAt: { gte: now },
          status: { in: [...UPCOMING_STATUSES] },
        },
      },
      _count: { _all: true },
    }),
    prisma.barberSaleItem.groupBy({
      by: ["serviceId"],
      where: { serviceId: { in: ids }, sale: { barbershopId } },
      _count: { _all: true },
    }),
  ]);

  for (const g of appts) {
    const row = out.get(g.serviceId);
    if (row) row.appointments = g._count._all;
  }
  for (const g of upcoming) {
    const row = out.get(g.serviceId);
    if (row) row.upcoming = g._count._all;
  }
  for (const g of sales) {
    if (!g.serviceId) continue;
    const row = out.get(g.serviceId);
    if (row) row.sales = g._count._all;
  }
  return out;
}

async function toRows(barbershopId: string, raws: ServiceRaw[], now = new Date()): Promise<BarberServiceRow[]> {
  const usage = await countUsage(
    barbershopId,
    raws.map((r) => r.id),
    now,
  );
  return raws.map((r) => {
    const u = usage.get(r.id) ?? { appointments: 0, upcoming: 0, sales: 0 };
    return {
      ...toServiceDTO(r),
      appointmentsCount: u.appointments,
      upcomingCount: u.upcoming,
      salesCount: u.sales,
      deletable: u.appointments === 0 && u.sales === 0,
    };
  });
}

/** Categorías distintas en uso, en el orden del catálogo (sin duplicados). */
export function categoriesInUse(rows: Array<{ category: string }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const k = (r.category || SERVICE_CATEGORY_DEFAULT).trim().toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

// ── Lectura ─────────────────────────────────────────────────────────────

/**
 * Catálogo completo de la barbería en sesión (activos y retirados), en el
 * orden que la barbería definió. Exige services.manage: es la vista de
 * administración, no el picker (la agenda y la caja leen lo suyo aparte).
 */
export async function listServices(ctx: BarberContext): Promise<ServiceCatalog> {
  assertBarberPermission(ctx, "services.manage");
  const raws = await prisma.barberService.findMany({
    where: { barbershopId: ctx.barbershopId },
    select: SERVICE_SELECT,
    orderBy: [...SERVICE_ORDER],
  });
  const services = await toRows(ctx.barbershopId, raws);
  return { services, categories: categoriesInUse(services) };
}

async function getOwned(ctx: BarberContext, id: string): Promise<ServiceRaw> {
  const row = await prisma.barberService.findFirst({
    where: { id, barbershopId: ctx.barbershopId },
    select: SERVICE_SELECT,
  });
  // Un id de otra barbería y un id inexistente responden igual: 404. No se
  // confirma ni se niega que exista en otro lado.
  if (!row) throw new BarberAdminError("Ese servicio no existe en tu barbería.", 404);
  return row;
}

/** Una fila con sus conteos (para responder a un PATCH/POST con lo guardado). */
export async function getServiceRow(ctx: BarberContext, id: string): Promise<BarberServiceRow> {
  assertBarberPermission(ctx, "services.manage");
  const raw = await getOwned(ctx, id);
  const [row] = await toRows(ctx.barbershopId, [raw]);
  return row;
}

// ── Escritura ───────────────────────────────────────────────────────────

export async function createService(ctx: BarberContext, input: ServiceInput): Promise<BarberServiceRow> {
  assertBarberPermission(ctx, "services.manage");

  const name = cleanText(input.name, SERVICE_NAME_MAX);
  if (!name) throw new BarberAdminError("Ponle nombre al servicio.");
  const description = cleanMultiline(input.description, SERVICE_DESCRIPTION_MAX) || null;
  const durationMin = normalizeServiceDuration(input.durationMin ?? 30);
  const price = normalizeServicePrice(input.price);
  const category = normalizeServiceCategory(input.category);
  const isActive = input.isActive === undefined ? true : input.isActive === true;

  const barbershopId = ctx.barbershopId;
  const [count, last] = await Promise.all([
    prisma.barberService.count({ where: { barbershopId } }),
    prisma.barberService.findFirst({
      where: { barbershopId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    }),
  ]);
  if (count >= SERVICE_COUNT_MAX) {
    throw new BarberAdminError(`El catálogo admite hasta ${SERVICE_COUNT_MAX} servicios.`, 409);
  }

  const created = await prisma.barberService.create({
    data: {
      barbershopId,
      name,
      description,
      durationMin,
      price,
      category,
      isActive,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
    select: SERVICE_SELECT,
  });
  const [row] = await toRows(barbershopId, [created]);
  return row;
}

export interface ServiceUpdateResult {
  service: BarberServiceRow;
  /** Precio ANTES del cambio (number) cuando el PATCH lo modificó; si no, null. */
  previousPrice: number | null;
}

/**
 * Edita un servicio de ESTA barbería. Solo se tocan los campos que vienen en
 * el body (undefined = intacto). Cambiar `isActive` a false es "retirar":
 * desaparece de agenda, reserva, mini-web, bot y caja; su historial queda.
 */
export async function updateService(
  ctx: BarberContext,
  id: string,
  input: ServiceInput,
): Promise<ServiceUpdateResult> {
  assertBarberPermission(ctx, "services.manage");
  const current = await getOwned(ctx, id);

  const data: Prisma.BarberServiceUpdateInput = {};
  if (input.name !== undefined) {
    const name = cleanText(input.name, SERVICE_NAME_MAX);
    if (!name) throw new BarberAdminError("El nombre no puede quedar vacío.");
    data.name = name;
  }
  if (input.description !== undefined) {
    data.description = cleanMultiline(input.description, SERVICE_DESCRIPTION_MAX) || null;
  }
  if (input.durationMin !== undefined) data.durationMin = normalizeServiceDuration(input.durationMin);
  let previousPrice: number | null = null;
  if (input.price !== undefined) {
    const price = normalizeServicePrice(input.price);
    if (!price.equals(current.price)) {
      data.price = price;
      previousPrice = toNum(current.price);
    }
  }
  if (input.category !== undefined) data.category = normalizeServiceCategory(input.category);
  if (input.isActive !== undefined) data.isActive = input.isActive === true;

  // Sin cambios reales (p. ej. guardar el mismo precio) no se escribe nada:
  // un updateMany con `data: {}` devuelve count 0 y parecería un 404.
  if (Object.keys(data).length === 0) {
    return { service: await getServiceRow(ctx, id), previousPrice: null };
  }

  // updateMany con el tenant en el where: aunque `getOwned` ya lo comprobó,
  // la escritura vuelve a exigirlo (defensa en profundidad, cero costo).
  const r = await prisma.barberService.updateMany({
    where: { id, barbershopId: ctx.barbershopId },
    data,
  });
  if (r.count === 0) throw new BarberAdminError("Ese servicio no existe en tu barbería.", 404);

  const service = await getServiceRow(ctx, id);
  return { service, previousPrice };
}

/**
 * Borra de verdad — SOLO si nada lo referencia. Con citas o ventas se
 * responde 409 y la pantalla ofrece retirarlo en su lugar. La FK NoAction de
 * barber_appointment_services es la última red: si algo se coló entre el
 * conteo y el DELETE, Postgres lo rechaza (P2003) y también es 409.
 */
export async function deleteService(ctx: BarberContext, id: string): Promise<void> {
  assertBarberPermission(ctx, "services.manage");
  const row = await getServiceRow(ctx, id);
  if (!row.deletable) {
    throw new BarberAdminError(
      "Este servicio ya tiene citas o ventas: retíralo del catálogo en vez de borrarlo, así el historial no se rompe.",
      409,
    );
  }
  try {
    const r = await prisma.barberService.deleteMany({ where: { id, barbershopId: ctx.barbershopId } });
    if (r.count === 0) throw new BarberAdminError("Ese servicio no existe en tu barbería.", 404);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      throw new BarberAdminError(
        "Este servicio ya tiene citas o ventas: retíralo del catálogo en vez de borrarlo.",
        409,
      );
    }
    throw e;
  }
}

/**
 * Reordena el catálogo. `orderedIds` son los ids en el orden nuevo; los que
 * no vengan (p. ej. retirados que la pantalla no muestra) conservan su orden
 * relativo DETRÁS de los enviados. Todos tienen que ser de esta barbería.
 * sortOrder es uno solo: vale para la agenda, la reserva, la mini-web y la
 * caja.
 */
export async function reorderServices(ctx: BarberContext, orderedIds: unknown): Promise<ServiceCatalog> {
  assertBarberPermission(ctx, "services.manage");
  const wanted: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(orderedIds)) {
    for (const v of orderedIds) {
      if (typeof v === "string" && v && !seen.has(v)) {
        seen.add(v);
        wanted.push(v);
      }
    }
  }
  if (wanted.length === 0) throw new BarberAdminError("No llegó ningún servicio que ordenar.");

  const barbershopId = ctx.barbershopId;
  const owned = await prisma.barberService.findMany({
    where: { barbershopId },
    select: { id: true },
    orderBy: [...SERVICE_ORDER],
  });
  const ownedIds = new Set(owned.map((s) => s.id));
  if (wanted.some((id) => !ownedIds.has(id))) {
    throw new BarberAdminError("Hay servicios que no son de tu barbería.", 404);
  }
  const rest = owned.map((s) => s.id).filter((id) => !seen.has(id));
  const finalOrder = [...wanted, ...rest];

  await prisma.$transaction(
    finalOrder.map((id, index) =>
      prisma.barberService.updateMany({ where: { id, barbershopId }, data: { sortOrder: index } }),
    ),
  );
  return listServices(ctx);
}

/**
 * Vuelve a sembrar los 9 servicios de BARBER_DEFAULT_SERVICES. SOLO cuando el
 * catálogo está vacío (ni activos ni retirados): sembrar encima de un
 * catálogo vivo duplicaría nombres y confundiría a la reserva pública.
 */
export async function reseedDefaultServices(ctx: BarberContext): Promise<ServiceCatalog> {
  assertBarberPermission(ctx, "services.manage");
  const barbershopId = ctx.barbershopId;
  const count = await prisma.barberService.count({ where: { barbershopId } });
  if (count > 0) {
    throw new BarberAdminError(
      "Tu catálogo ya tiene servicios. Los sugeridos solo se cargan cuando está vacío.",
      409,
    );
  }
  await prisma.barberService.createMany({
    data: BARBER_DEFAULT_SERVICES.map((s) => ({
      barbershopId,
      name: s.name,
      durationMin: s.durationMin,
      price: new Prisma.Decimal(s.price),
      category: s.category,
      sortOrder: s.sortOrder,
      isActive: true,
    })),
  });
  return listServices(ctx);
}

/** Vista previa del catálogo semilla (para el estado vacío de la pantalla). */
export function defaultServicesPreview(): Array<{
  name: string;
  durationMin: number;
  price: number;
  category: string;
}> {
  return BARBER_DEFAULT_SERVICES.map((s) => ({
    name: s.name,
    durationMin: s.durationMin,
    price: s.price,
    category: s.category,
  }));
}
