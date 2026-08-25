import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  assertRealtyPermission,
  getAccessibleOfficeIds,
  type RealtyContext,
} from "@/lib/realty-auth";
import { getRealtyPlans } from "@/lib/realty/plans";
import { isRealtyUnlimited, type RealtyPlanId } from "@/lib/realty/plan-shared";
import { RealtyAdminError } from "@/lib/realty/team";

// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES — OFICINAS (sucursales).
//
// El ALCANCE multi-oficina sale SIEMPRE de getAccessibleOfficeIds(ctx)
// (src/lib/realty-auth.ts). Este módulo no inventa su propio filtro: solo
// administra las filas y pinta los números por sede.
//
// ⚠️ Ojo Prisma (regla de la Ola 0): un `accountId: undefined` en un where
// BORRA el filtro de tenant. Aquí SIEMPRE va el accountId de la sesión y el
// id de oficina se comprueba contra la lista de la sesión, nunca se confía.
//
// 🔴 UNA sola oficina principal por cuenta, y la BASE NO LO IMPONE (Prisma
// no expresa únicos parciales). Con dos, el orden de getAccessibleOfficeIds
// deja de ser determinista y la "principal" cambia sola entre peticiones.
// Por eso marcar una matriz quita la anterior en la MISMA transacción.
// ═══════════════════════════════════════════════════════════════════════

export interface RealtyOfficeRow {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  isMain: boolean;
  isActive: boolean;
  createdAt: string;
  /** Liga a Google Maps si hay coordenadas o dirección. null si no hay nada. */
  mapsUrl: string | null;
  /** Personas con acceso EXPLÍCITO a esta oficina. */
  users: number;
  /** Inmuebles de esta oficina. */
  properties: number;
  publishedProperties: number;
}

export interface RealtyOfficeLimit {
  used: number;
  max: number;
  unlimited: boolean;
  canCreate: boolean;
  /** false = el plan ni siquiera trae varias oficinas. */
  featureOn: boolean;
  planId: RealtyPlanId;
  planName: string;
  upgrade: { id: RealtyPlanId; name: string; maxOffices: number; priceMonthly: number } | null;
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

/** Coordenada válida o null. Fuera de rango se descarta, no se recorta. */
function cleanCoord(value: unknown, limit: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "."));
  if (!Number.isFinite(n) || Math.abs(n) > limit) return null;
  // Decimal(10,7) en la base: más de 7 decimales lo redondearía Postgres.
  return Math.round(n * 1e7) / 1e7;
}

/**
 * Liga al mapa. Con coordenadas se usa el punto exacto; si no, la búsqueda
 * por dirección — que es lo que un asesor le manda por WhatsApp al cliente.
 */
export function officeMapsUrl(
  office: { lat: number | null; lng: number | null; address: string | null; name: string },
): string | null {
  if (office.lat !== null && office.lng !== null) {
    return `https://www.google.com/maps/search/?api=1&query=${office.lat},${office.lng}`;
  }
  const q = [office.name, office.address].filter(Boolean).join(" ");
  if (!q.trim()) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Tope maxOffices del plan, con el plan que da para más leído de la tabla. */
export async function getRealtyOfficeLimit(ctx: RealtyContext): Promise<RealtyOfficeLimit> {
  const [used, plans] = await Promise.all([
    prisma.realtyOffice.count({ where: { accountId: ctx.accountId } }),
    getRealtyPlans(),
  ]);
  const plan = ctx.plan;
  const unlimited = isRealtyUnlimited(plan.maxOffices);
  const featureOn = plan.features.multiOffice === true;
  // La matriz siempre existe: con 1 de tope, "puede crear" es false desde el
  // primer minuto y por eso el aviso habla de la feature, no del número.
  const canCreate = featureOn && (unlimited || used < plan.maxOffices);

  const upgrade = canCreate
    ? null
    : (plans
        .filter(
          (p) =>
            p.isActive &&
            p.features.multiOffice === true &&
            (isRealtyUnlimited(p.maxOffices) || p.maxOffices > used),
        )
        .sort((a, b) => a.priceMonthly - b.priceMonthly)[0] ?? null);

  return {
    used,
    max: plan.maxOffices,
    unlimited,
    canCreate,
    featureOn,
    planId: plan.id,
    planName: plan.name,
    upgrade: upgrade
      ? {
          id: upgrade.id,
          name: upgrade.name,
          maxOffices: upgrade.maxOffices,
          priceMonthly: upgrade.priceMonthly,
        }
      : null,
  };
}

/**
 * Oficinas que la sesión puede VER, en el orden del contrato (matriz
 * primero), con sus números. Requiere offices.manage para administrarlas;
 * para SOLO listarlas basta la sesión, porque el selector de sede de
 * cualquier pantalla las necesita.
 */
export async function listOffices(ctx: RealtyContext): Promise<RealtyOfficeRow[]> {
  const ids = await getAccessibleOfficeIds(ctx);
  if (ids.length === 0) return [];

  const [offices, accessGroups, propertyGroups, publishedGroups] = await Promise.all([
    prisma.realtyOffice.findMany({
      where: { accountId: ctx.accountId, id: { in: ids } },
      select: {
        id: true,
        name: true,
        address: true,
        lat: true,
        lng: true,
        phone: true,
        isMain: true,
        isActive: true,
        createdAt: true,
      },
    }),
    prisma.realtyUserOfficeAccess.groupBy({
      by: ["officeId"],
      where: { accountId: ctx.accountId, officeId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.realtyProperty.groupBy({
      by: ["officeId"],
      where: { accountId: ctx.accountId, officeId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.realtyProperty.groupBy({
      by: ["officeId"],
      where: { accountId: ctx.accountId, officeId: { in: ids }, isPublished: true },
      _count: { _all: true },
    }),
  ]);

  const users = new Map(accessGroups.map((g) => [g.officeId, g._count._all]));
  const props = new Map(
    propertyGroups.filter((g) => g.officeId).map((g) => [g.officeId as string, g._count._all]),
  );
  const published = new Map(
    publishedGroups.filter((g) => g.officeId).map((g) => [g.officeId as string, g._count._all]),
  );

  const byId = new Map(offices.map((o) => [o.id, o]));
  // Conserva el orden de getAccessibleOfficeIds (matriz primero).
  return ids
    .map((id) => byId.get(id))
    .filter((o): o is NonNullable<typeof o> => Boolean(o))
    .map((o) => {
      const lat = o.lat === null ? null : Number(o.lat);
      const lng = o.lng === null ? null : Number(o.lng);
      return {
        id: o.id,
        name: o.name,
        address: o.address,
        lat,
        lng,
        phone: o.phone,
        isMain: o.isMain,
        isActive: o.isActive,
        createdAt: o.createdAt.toISOString(),
        mapsUrl: officeMapsUrl({ lat, lng, address: o.address, name: o.name }),
        users: users.get(o.id) ?? 0,
        properties: props.get(o.id) ?? 0,
        publishedProperties: published.get(o.id) ?? 0,
      };
    });
}

/** Una oficina de ESTA cuenta y dentro del alcance de la sesión, o 404. */
async function loadOffice(ctx: RealtyContext, officeId: string) {
  const ids = await getAccessibleOfficeIds(ctx);
  if (!ids.includes(officeId)) {
    throw new RealtyAdminError("Esa oficina no es tuya.", 404, "NOT_FOUND");
  }
  const office = await prisma.realtyOffice.findFirst({
    where: { id: officeId, accountId: ctx.accountId },
    select: { id: true, name: true, isMain: true, isActive: true },
  });
  if (!office) throw new RealtyAdminError("Esa oficina no es tuya.", 404, "NOT_FOUND");
  return office;
}

export interface OfficeInput {
  name?: unknown;
  address?: unknown;
  lat?: unknown;
  lng?: unknown;
  phone?: unknown;
  isMain?: unknown;
  isActive?: unknown;
}

export async function createOffice(
  ctx: RealtyContext,
  input: OfficeInput,
): Promise<RealtyOfficeRow[]> {
  assertRealtyPermission(ctx, "offices.manage");

  const limit = await getRealtyOfficeLimit(ctx);
  if (!limit.featureOn) {
    const suffix = limit.upgrade
      ? ` Con el plan ${limit.upgrade.name} puedes abrir ${
          isRealtyUnlimited(limit.upgrade.maxOffices) ? "las que necesites" : limit.upgrade.maxOffices
        }.`
      : "";
    throw new RealtyAdminError(
      `Tu plan ${limit.planName} trabaja con una sola oficina.${suffix}`,
      403,
      "FEATURE_OFF",
    );
  }
  if (!limit.canCreate) {
    const suffix = limit.upgrade ? ` Con el plan ${limit.upgrade.name} caben más.` : "";
    throw new RealtyAdminError(
      `Tu plan ${limit.planName} permite ${limit.max} ${limit.max === 1 ? "oficina" : "oficinas"} y ya tienes ${limit.used}.${suffix}`,
      409,
      "OFFICE_LIMIT",
    );
  }

  const name = cleanText(input.name, 80);
  if (!name) throw new RealtyAdminError("El nombre de la oficina es obligatorio.");

  const wantsMain = input.isMain === true;

  await prisma.$transaction(async (tx) => {
    if (wantsMain) {
      await tx.realtyOffice.updateMany({
        where: { accountId: ctx.accountId, isMain: true },
        data: { isMain: false },
      });
    }
    await tx.realtyOffice.create({
      data: {
        accountId: ctx.accountId,
        name,
        address: cleanText(input.address, 240) || null,
        lat: coordToDecimal(cleanCoord(input.lat, 90)),
        lng: coordToDecimal(cleanCoord(input.lng, 180)),
        phone: cleanText(input.phone, 40) || null,
        isMain: wantsMain,
        isActive: input.isActive === undefined ? true : input.isActive === true,
      },
    });
  });

  return listOffices(ctx);
}

function coordToDecimal(value: number | null): Prisma.Decimal | null {
  return value === null ? null : new Prisma.Decimal(value.toFixed(7));
}

export async function updateOffice(
  ctx: RealtyContext,
  officeId: string,
  input: OfficeInput,
): Promise<RealtyOfficeRow[]> {
  assertRealtyPermission(ctx, "offices.manage");
  const office = await loadOffice(ctx, officeId);

  const data: Prisma.RealtyOfficeUpdateInput = {};
  if (input.name !== undefined) {
    const v = cleanText(input.name, 80);
    if (!v) throw new RealtyAdminError("El nombre de la oficina es obligatorio.");
    data.name = v;
  }
  if (input.address !== undefined) data.address = cleanText(input.address, 240) || null;
  if (input.phone !== undefined) data.phone = cleanText(input.phone, 40) || null;
  if (input.lat !== undefined) data.lat = coordToDecimal(cleanCoord(input.lat, 90));
  if (input.lng !== undefined) data.lng = coordToDecimal(cleanCoord(input.lng, 180));

  if (input.isActive !== undefined) {
    const next = input.isActive === true;
    if (!next && office.isMain) {
      throw new RealtyAdminError(
        "La oficina principal no se puede cerrar. Nombra principal a otra primero.",
        409,
        "MAIN_OFFICE",
      );
    }
    data.isActive = next;
  }

  await prisma.$transaction(async (tx) => {
    // Marcar principal quita la anterior EN LA MISMA transacción: dos
    // principales dejan el orden de getAccessibleOfficeIds al azar.
    if (input.isMain === true && !office.isMain) {
      await tx.realtyOffice.updateMany({
        where: { accountId: ctx.accountId, isMain: true },
        data: { isMain: false },
      });
      data.isMain = true;
      // Una principal cerrada no tiene sentido: es la que recibe por default.
      data.isActive = true;
    } else if (input.isMain === false && office.isMain) {
      throw new RealtyAdminError(
        "Tiene que haber una oficina principal. Nombra principal a otra y esta deja de serlo sola.",
        409,
        "MAIN_OFFICE",
      );
    }
    await tx.realtyOffice.update({ where: { id: office.id }, data });
  });

  return listOffices(ctx);
}

export interface OfficeDeleteImpact {
  officeId: string;
  name: string;
  isMain: boolean;
  properties: number;
  users: number;
  /** true = se puede borrar de verdad; false = solo cerrar. */
  canDelete: boolean;
}

/** Qué se lleva por delante borrar una oficina. Se enseña ANTES de confirmar. */
export async function getOfficeDeleteImpact(
  ctx: RealtyContext,
  officeId: string,
): Promise<OfficeDeleteImpact> {
  assertRealtyPermission(ctx, "offices.manage");
  const office = await loadOffice(ctx, officeId);
  const [properties, users] = await Promise.all([
    prisma.realtyProperty.count({ where: { accountId: ctx.accountId, officeId } }),
    prisma.realtyUserOfficeAccess.count({ where: { accountId: ctx.accountId, officeId } }),
  ]);
  return {
    officeId,
    name: office.name,
    isMain: office.isMain,
    properties,
    users,
    canDelete: !office.isMain && properties === 0 && users === 0,
  };
}

/**
 * Borra una oficina VACÍA. Con inmuebles o gente dentro no se borra: se
 * cierra (isActive=false) y se conserva. Borrarla dejaría los inmuebles con
 * officeId NULL (el schema es SetNull) y nadie sabría de dónde salieron.
 */
export async function deleteOffice(ctx: RealtyContext, officeId: string): Promise<RealtyOfficeRow[]> {
  assertRealtyPermission(ctx, "offices.manage");
  const impact = await getOfficeDeleteImpact(ctx, officeId);

  if (impact.isMain) {
    throw new RealtyAdminError(
      "La oficina principal no se borra. Nombra principal a otra primero.",
      409,
      "MAIN_OFFICE",
    );
  }
  if (!impact.canDelete) {
    throw new RealtyAdminError(
      `Esa oficina todavía tiene ${impact.properties} ${impact.properties === 1 ? "inmueble" : "inmuebles"} y ${impact.users} ${impact.users === 1 ? "persona" : "personas"}. Muévelos o ciérrala en vez de borrarla.`,
      409,
      "OFFICE_NOT_EMPTY",
    );
  }

  await prisma.realtyOffice.deleteMany({ where: { id: officeId, accountId: ctx.accountId } });
  return listOffices(ctx);
}

// ── Vista consolidada / por sede ───────────────────────────────────────

export interface RealtyOfficeStats {
  officeId: string | null;
  name: string;
  isMain: boolean;
  isActive: boolean;
  properties: number;
  publishedProperties: number;
  soldOrRented: number;
  users: number;
}

export interface RealtyOfficesOverview {
  offices: RealtyOfficeRow[];
  limit: RealtyOfficeLimit;
  stats: RealtyOfficeStats[];
  /** Inmuebles de la cuenta SIN oficina asignada. */
  unassignedProperties: number;
  totals: { properties: number; publishedProperties: number; soldOrRented: number; users: number };
}

/**
 * Números por sede + el consolidado. Los inmuebles SIN oficina se cuentan
 * aparte a propósito: un `{ in: [...] }` los descarta en silencio y la suma
 * por sede no cuadraría con la cartera total (la trampa que documenta
 * getAccessibleOfficeIds).
 */
export async function getOfficesOverview(ctx: RealtyContext): Promise<RealtyOfficesOverview> {
  assertRealtyPermission(ctx, "offices.manage");
  return officesOverviewUnchecked(ctx);
}

/**
 * El MISMO resumen para la pantalla de Equipo, que ya está cerrada con
 * team.manage. Sin esto, un gerente que administra el equipo pero no las
 * oficinas se topaba con un 403 al abrir /inmobiliaria/equipo — necesita ver
 * los nombres de las sedes para saber quién trabaja dónde.
 */
export async function getOfficesForTeamScreen(
  ctx: RealtyContext,
): Promise<RealtyOfficesOverview> {
  assertRealtyPermission(ctx, "team.manage");
  return officesOverviewUnchecked(ctx);
}

async function officesOverviewUnchecked(ctx: RealtyContext): Promise<RealtyOfficesOverview> {
  // 🔴 listOffices se deja sin permiso a propósito (el selector de sede de
  // cualquier pantalla lo necesita), pero ESTO es otra cosa: números por
  // sucursal, cartera total, personas activas y el PRECIO del plan que
  // vendría bien. Eso es material de quien administra, no de cualquiera con
  // sesión: por eso las dos puertas de arriba.
  const ids = await getAccessibleOfficeIds(ctx);
  const [offices, limit, soldGroups, unassignedProperties, activeUsers] = await Promise.all([
    listOffices(ctx),
    getRealtyOfficeLimit(ctx),
    ids.length > 0
      ? prisma.realtyProperty.groupBy({
          by: ["officeId"],
          where: {
            accountId: ctx.accountId,
            officeId: { in: ids },
            status: { in: ["VENDIDO", "RENTADO"] },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    prisma.realtyProperty.count({ where: { accountId: ctx.accountId, officeId: null } }),
    prisma.realtyUser.count({ where: { accountId: ctx.accountId, active: true } }),
  ]);

  const sold = new Map(
    soldGroups.filter((g) => g.officeId).map((g) => [g.officeId as string, g._count._all]),
  );

  const stats: RealtyOfficeStats[] = offices.map((o) => ({
    officeId: o.id,
    name: o.name,
    isMain: o.isMain,
    isActive: o.isActive,
    properties: o.properties,
    publishedProperties: o.publishedProperties,
    soldOrRented: sold.get(o.id) ?? 0,
    users: o.users,
  }));

  return {
    offices,
    limit,
    stats,
    unassignedProperties,
    totals: {
      properties: stats.reduce((a, s) => a + s.properties, 0) + unassignedProperties,
      publishedProperties: stats.reduce((a, s) => a + s.publishedProperties, 0),
      soldOrRented: stats.reduce((a, s) => a + s.soldOrRented, 0),
      users: activeUsers,
    },
  };
}
