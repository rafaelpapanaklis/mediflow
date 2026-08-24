import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  assertBarberPermission,
  BarberForbiddenError,
  getAccessibleBranchIds,
  type BarberContext,
} from "@/lib/barber-auth";
import { getBarberPlan } from "@/lib/barber/plans";
import { barberPlanHasFeature, isBarberUnlimited } from "@/lib/barber/plan-shared";
import { makeBarberSlug } from "@/lib/barber/types";

// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — SUCURSALES (sedes de una cadena).
//
// Punto único del ALCANCE multisede del panel de administración. El filtro
// de tenant NUNCA sale del request: la lista de sedes visibles siempre nace
// de getAccessibleBranchIds(ctx) (src/lib/barber-auth.ts) y lo que manda el
// cliente solo puede RECORTARLA, jamás ampliarla.
//
// Ojo Prisma (regla de la Ola 0): un `barbershopId: undefined` en un where
// BORRA el filtro. Por eso aquí SIEMPRE se filtra con
// `barbershopId: { in: <lista de la sesión> }`, que con lista vacía no
// devuelve nada en vez de devolverlo todo.
//
// Este archivo es además el módulo de más bajo nivel del trío de
// administración (branches <- team, branches <- support): por eso viven aquí
// el error tipado y los saneadores de texto que los tres comparten.
// ═══════════════════════════════════════════════════════════════════════

/** Error de validación/permiso que los route handlers mapean a HTTP. */
export class BarberAdminError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "BarberAdminError";
    this.status = status;
  }
}

/** Cookie con la sede elegida en el selector. Se VALIDA en cada lectura. */
export const BARBER_BRANCH_COOKIE = "dcb_branch";
/** Valor especial de la cookie: vista consolidada de toda la cadena. */
export const BARBER_BRANCH_ALL = "all";

export const BARBER_BRANCH_NAME_MAX = 60;
export const BARBER_BRANCH_ADDRESS_MAX = 200;

// ── Saneado de texto de usuario ────────────────────────────────────────
// Se hace por código de carácter (no por clase de regex) para no depender
// de escapes en el fuente y para poder conservar el salto de línea en los
// campos largos sin arrastrar el resto de los controles.

const TAB = 9;
const NEWLINE = 10;
const CARRIAGE_RETURN = 13;
const SPACE = 32;
const DELETE_CHAR = 127;

function stripControlChars(input: string, keepNewlines: boolean): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === CARRIAGE_RETURN) {
      // CRLF -> LF; un CR suelto también se normaliza a LF.
      if (keepNewlines && input.charCodeAt(i + 1) !== NEWLINE) out += "\n";
      continue;
    }
    if (code === NEWLINE) {
      if (keepNewlines) out += "\n";
      else out += " ";
      continue;
    }
    if (code === TAB) {
      out += " ";
      continue;
    }
    if (code < SPACE || code === DELETE_CHAR) continue;
    out += input[i];
  }
  return out;
}

/** Texto de una línea: quita controles, colapsa espacios y recorta. */
export function cleanText(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  return stripControlChars(value, false).replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/** Texto largo: igual que cleanText pero conserva los saltos de línea. */
export function cleanMultiline(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  return stripControlChars(value, true).trim().slice(0, maxLen);
}

// ── Alcance multisede ──────────────────────────────────────────────────

export interface BarberBranchRow {
  id: string;
  name: string;
  branchName: string | null;
  isMainBranch: boolean;
  isActive: boolean;
  address: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  timezone: string;
  slug: string;
  parentId: string | null;
  createdAt: string;
  barbersCount: number;
  usersCount: number;
  /** true = es la sede a la que pertenece la fila BarberUser de la sesión. */
  isHome: boolean;
}

/**
 * Alcance resuelto para una pantalla del panel.
 *  · branchIds  -> SIEMPRE se usa tal cual en `{ barbershopId: { in } }`.
 *  · activeId   -> null cuando el usuario pidió la vista consolidada.
 *  · accessible -> todas las sedes que la sesión puede ver (para el selector).
 */
export interface BarberBranchScope {
  branchIds: string[];
  activeId: string | null;
  accessible: string[];
  isConsolidated: boolean;
  canConsolidate: boolean;
}

/** Sede elegida en la cookie (sin validar todavía: solo la lee). */
export function readBranchCookie(): string | null {
  try {
    return cookies().get(BARBER_BRANCH_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Traduce lo que pidió el cliente (cookie o query) al alcance REAL.
 * Pedir una sede que la sesión no puede ver NO es un error: se degrada a la
 * sede propia (la cookie queda vieja cuando a alguien le retiran un acceso).
 */
export async function resolveBranchScope(
  ctx: BarberContext,
  requested?: string | null,
): Promise<BarberBranchScope> {
  const accessible = await getAccessibleBranchIds(ctx);
  const safeAccessible = accessible.length > 0 ? accessible : [ctx.barbershopId];
  const canConsolidate = safeAccessible.length > 1;

  if (requested === BARBER_BRANCH_ALL && canConsolidate) {
    return {
      branchIds: safeAccessible,
      activeId: null,
      accessible: safeAccessible,
      isConsolidated: true,
      canConsolidate,
    };
  }
  if (requested && safeAccessible.includes(requested)) {
    return {
      branchIds: [requested],
      activeId: requested,
      accessible: safeAccessible,
      isConsolidated: false,
      canConsolidate,
    };
  }
  return {
    branchIds: [ctx.barbershopId],
    activeId: ctx.barbershopId,
    accessible: safeAccessible,
    isConsolidated: false,
    canConsolidate,
  };
}

/** Alcance leyendo la cookie del selector (lo que usan las páginas). */
export async function getBranchScopeFromCookie(
  ctx: BarberContext,
): Promise<BarberBranchScope> {
  return resolveBranchScope(ctx, readBranchCookie());
}

/** id de la matriz de la cadena a la que pertenece la sesión. */
export function chainRootId(ctx: BarberContext): string {
  return ctx.barbershop.parentId ?? ctx.barbershopId;
}

// ── Lectura ────────────────────────────────────────────────────────────

/** Etiqueta visible de una sede: "Centro" si tiene branchName, si no el nombre. */
export function branchLabel(row: { name: string; branchName: string | null }): string {
  return row.branchName?.trim() || row.name;
}

/**
 * Sedes para el SELECTOR. No exige permiso: son las sedes que la propia
 * sesión ya puede ver (getAccessibleBranchIds); ocultarles el nombre no
 * protegería nada y rompería el switcher de un gerente multisede.
 */
export async function listBranchOptions(
  ctx: BarberContext,
): Promise<Array<{ id: string; label: string; isMainBranch: boolean; isActive: boolean }>> {
  const ids = await getAccessibleBranchIds(ctx);
  if (ids.length === 0) return [];
  const rows = await prisma.barbershop.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, branchName: true, isMainBranch: true, isActive: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Conserva el orden de getAccessibleBranchIds (matriz primero).
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({
      id: r.id,
      label: branchLabel(r),
      isMainBranch: r.isMainBranch,
      isActive: r.isActive,
    }));
}

/** Sedes de la cadena con sus conteos. Exige branches.manage. */
export async function listBranches(ctx: BarberContext): Promise<BarberBranchRow[]> {
  assertBarberPermission(ctx, "branches.manage");
  const ids = await getAccessibleBranchIds(ctx);
  if (ids.length === 0) return [];

  const [shops, barberCounts, userCounts] = await Promise.all([
    prisma.barbershop.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        slug: true,
        branchName: true,
        isMainBranch: true,
        isActive: true,
        address: true,
        phone: true,
        city: true,
        state: true,
        timezone: true,
        parentId: true,
        createdAt: true,
      },
      orderBy: [{ isMainBranch: "desc" }, { createdAt: "asc" }],
    }),
    prisma.barber.groupBy({
      by: ["barbershopId"],
      where: { barbershopId: { in: ids }, isActive: true },
      _count: { _all: true },
    }),
    prisma.barberUser.groupBy({
      by: ["barbershopId"],
      where: { barbershopId: { in: ids }, isActive: true },
      _count: { _all: true },
    }),
  ]);

  const barbersBy = new Map(barberCounts.map((c) => [c.barbershopId, c._count._all]));
  const usersBy = new Map(userCounts.map((c) => [c.barbershopId, c._count._all]));

  return shops.map((s) => ({
    id: s.id,
    name: s.name,
    branchName: s.branchName,
    isMainBranch: s.isMainBranch,
    isActive: s.isActive,
    address: s.address,
    phone: s.phone,
    city: s.city,
    state: s.state,
    timezone: s.timezone,
    slug: s.slug,
    parentId: s.parentId,
    createdAt: s.createdAt.toISOString(),
    barbersCount: barbersBy.get(s.id) ?? 0,
    usersCount: usersBy.get(s.id) ?? 0,
    isHome: s.id === ctx.barbershopId,
  }));
}

// ── Límite del plan ────────────────────────────────────────────────────

export interface BarberBranchLimit {
  /** Sedes que ya existen en la cadena (matriz incluida). */
  used: number;
  /** Tope del plan; -1 = ilimitado. */
  max: number;
  unlimited: boolean;
  /** ¿El plan de la cadena trae multisucursal? */
  featureOn: boolean;
  canCreate: boolean;
  planName: string;
}

/**
 * Estado del límite maxBranches. El plan se lee de la MATRIZ: la suscripción
 * es de la cadena, no de cada sede (una sucursal recién creada hereda plan y
 * subscriptionStatus, pero la fuente sigue siendo la matriz).
 */
export async function getBranchLimit(ctx: BarberContext): Promise<BarberBranchLimit> {
  const rootId = chainRootId(ctx);
  const root = await prisma.barbershop.findUnique({
    where: { id: rootId },
    select: { plan: true },
  });
  const plan = await getBarberPlan(root?.plan ?? ctx.barbershop.plan);
  const used = await prisma.barbershop.count({
    where: { OR: [{ id: rootId }, { parentId: rootId }] },
  });
  const featureOn = barberPlanHasFeature(plan, "multiBranch");
  const unlimited = isBarberUnlimited(plan.maxBranches);
  return {
    used,
    max: plan.maxBranches,
    unlimited,
    featureOn,
    canCreate: featureOn && (unlimited || used < plan.maxBranches),
    planName: plan.name,
  };
}

// ── Escritura ──────────────────────────────────────────────────────────

export interface BranchInput {
  branchName?: unknown;
  name?: unknown;
  address?: unknown;
  phone?: unknown;
  city?: unknown;
  state?: unknown;
  timezone?: unknown;
}

const BRANCH_SELECT = {
  id: true,
  name: true,
  slug: true,
  branchName: true,
  isMainBranch: true,
  isActive: true,
  address: true,
  phone: true,
  city: true,
  state: true,
  timezone: true,
  parentId: true,
  createdAt: true,
} as const;

/** Slug libre a partir de un nombre (con sufijo aleatorio si choca). */
async function uniqueSlug(base: string): Promise<string> {
  let slug = makeBarberSlug(base);
  for (let i = 0; i < 6; i++) {
    const taken = await prisma.barbershop.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!taken) return slug;
    slug = `${makeBarberSlug(base)}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${makeBarberSlug(base)}-${Date.now().toString(36)}`;
}

/** La sede pertenece a la cadena Y la sesión puede verla. */
async function assertBranchInScope(ctx: BarberContext, branchId: string): Promise<void> {
  const ids = await getAccessibleBranchIds(ctx);
  if (!ids.includes(branchId)) {
    throw new BarberAdminError("Esa sede no es de tu barbería.", 404);
  }
}

/**
 * Crea una sede HIJA de la matriz de la cadena. El tope maxBranches y la
 * feature multiBranch se validan AQUÍ (servidor): la UI solo los refleja.
 */
export async function createBranch(
  ctx: BarberContext,
  input: BranchInput,
): Promise<BarberBranchRow> {
  assertBarberPermission(ctx, "branches.manage");

  const limit = await getBranchLimit(ctx);
  if (!limit.featureOn) {
    throw new BarberAdminError(
      `Las sucursales son del plan Profesional. Tu plan (${limit.planName}) no las incluye.`,
      403,
    );
  }
  if (!limit.canCreate) {
    const unidad = limit.max === 1 ? "sede" : "sedes";
    throw new BarberAdminError(
      `Tu plan (${limit.planName}) permite ${limit.max} ${unidad} y ya tienes ${limit.used}.`,
      403,
    );
  }

  const branchName = cleanText(input.branchName, BARBER_BRANCH_NAME_MAX);
  if (!branchName) throw new BarberAdminError("Ponle un nombre corto a la sede (ej. Centro).");

  const rootId = chainRootId(ctx);
  const root = await prisma.barbershop.findUnique({
    where: { id: rootId },
    select: {
      name: true,
      timezone: true,
      locale: true,
      plan: true,
      subscriptionStatus: true,
      logoUrl: true,
      email: true,
    },
  });
  if (!root) throw new BarberAdminError("No encontramos la barbería principal.", 404);

  const displayName = cleanText(input.name, 120) || `${root.name} ${branchName}`;
  const slug = await uniqueSlug(displayName);

  const created = await prisma.barbershop.create({
    data: {
      name: displayName,
      slug,
      branchName,
      isMainBranch: false,
      parentId: rootId,
      address: cleanText(input.address, BARBER_BRANCH_ADDRESS_MAX) || null,
      phone: cleanText(input.phone, 20) || null,
      city: cleanText(input.city, 80) || null,
      state: cleanText(input.state, 80) || null,
      timezone: cleanText(input.timezone, 60) || root.timezone,
      locale: root.locale,
      logoUrl: root.logoUrl,
      email: root.email,
      // La suscripción es de la CADENA: la sede espeja plan y estado de la
      // matriz y NO copia los ids de Stripe (los conserva la matriz).
      plan: root.plan,
      subscriptionStatus: root.subscriptionStatus,
    },
    select: BRANCH_SELECT,
  });

  return {
    ...created,
    createdAt: created.createdAt.toISOString(),
    barbersCount: 0,
    usersCount: 0,
    isHome: false,
  };
}

/**
 * Edita una sede. El `name` (nombre visible y base del slug público) solo se
 * toca en las SUCURSALES: el de la matriz es el nombre del negocio y lo
 * administra /barber/configuracion (T5).
 */
export async function updateBranch(
  ctx: BarberContext,
  branchId: string,
  input: BranchInput,
): Promise<BarberBranchRow> {
  assertBarberPermission(ctx, "branches.manage");
  await assertBranchInScope(ctx, branchId);

  const current = await prisma.barbershop.findUnique({
    where: { id: branchId },
    select: { isMainBranch: true },
  });
  if (!current) throw new BarberAdminError("Sede no encontrada.", 404);

  const data: Record<string, unknown> = {};
  if (input.branchName !== undefined) {
    const v = cleanText(input.branchName, BARBER_BRANCH_NAME_MAX);
    if (!v) throw new BarberAdminError("Ponle un nombre corto a la sede (ej. Centro).");
    data.branchName = v;
  }
  if (input.name !== undefined && !current.isMainBranch) {
    const v = cleanText(input.name, 120);
    if (!v) throw new BarberAdminError("El nombre de la sede no puede quedar vacío.");
    data.name = v;
  }
  if (input.address !== undefined) {
    data.address = cleanText(input.address, BARBER_BRANCH_ADDRESS_MAX) || null;
  }
  if (input.phone !== undefined) data.phone = cleanText(input.phone, 20) || null;
  if (input.city !== undefined) data.city = cleanText(input.city, 80) || null;
  if (input.state !== undefined) data.state = cleanText(input.state, 80) || null;
  if (input.timezone !== undefined) {
    const tz = cleanText(input.timezone, 60);
    if (tz) data.timezone = tz;
  }

  const updated = await prisma.barbershop.update({
    where: { id: branchId },
    data,
    select: BRANCH_SELECT,
  });

  const [barbersCount, usersCount] = await Promise.all([
    prisma.barber.count({ where: { barbershopId: branchId, isActive: true } }),
    prisma.barberUser.count({ where: { barbershopId: branchId, isActive: true } }),
  ]);

  return {
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    barbersCount,
    usersCount,
    isHome: updated.id === ctx.barbershopId,
  };
}

/**
 * Abre o cierra una sede. NO se borra: detrás hay citas, ventas y caja;
 * cerrarla es isActive=false (mismo criterio que un barbero que se va). La
 * matriz nunca se cierra desde aquí.
 */
export async function setBranchActive(
  ctx: BarberContext,
  branchId: string,
  isActive: boolean,
): Promise<void> {
  assertBarberPermission(ctx, "branches.manage");
  await assertBranchInScope(ctx, branchId);

  const branch = await prisma.barbershop.findUnique({
    where: { id: branchId },
    select: { isMainBranch: true, parentId: true },
  });
  if (!branch) throw new BarberAdminError("Sede no encontrada.", 404);
  if (branch.isMainBranch || branch.parentId === null) {
    throw new BarberAdminError("La barbería principal no se puede cerrar desde aquí.", 409);
  }
  await prisma.barbershop.update({ where: { id: branchId }, data: { isActive } });
}

// ── Puente a HTTP ──────────────────────────────────────────────────────

/**
 * Mapea los errores del vertical a una respuesta HTTP. Lo usan TODOS los
 * route handlers de administración para que un fallo de permiso siempre
 * salga como 403 y nunca como 500 con traza.
 */
export function barberApiError(err: unknown, tag: string): NextResponse {
  if (err instanceof BarberForbiddenError) {
    return NextResponse.json(
      { error: "No tienes permiso para esta acción.", permission: err.permission },
      { status: 403 },
    );
  }
  if (err instanceof BarberAdminError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(`[barber/${tag}]`, err);
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}

/** 401 estándar del vertical (sin sesión de barbería). */
export function barberUnauthorized(): NextResponse {
  return NextResponse.json({ error: "No autorizado" }, { status: 401 });
}
