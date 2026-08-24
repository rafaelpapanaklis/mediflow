import "server-only";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import {
  assertBarberPermission,
  getAccessibleBranchIds,
  type BarberContext,
} from "@/lib/barber-auth";
import {
  BARBER_PERMISSIONS,
  BARBER_PERMISSION_KEYS,
  BARBER_ROLE_DEFAULT_PERMISSIONS,
  resolveBarberPermissions,
  type BarberPermissionKey,
} from "@/lib/barber/permissions";
import {
  BarberAdminError,
  chainRootId,
  cleanMultiline,
  cleanText,
} from "@/lib/barber/branches";
import { getBarberPlan } from "@/lib/barber/plans";
import { barberPlanHasFeature, isBarberUnlimited } from "@/lib/barber/plan-shared";
import type { BarberCommissionType, BarberRole } from "@/lib/barber/types";

// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — EQUIPO: la ficha del barbero y los usuarios del panel.
//
// Dos cosas distintas que aquí conviven a propósito:
//   · Barber      = el PROFESIONAL (puede no tener login). Su ficha la
//     consumen agenda (T1/T2), caja y comisiones (T3) y la mini-web (T8):
//     aquí SOLO se administran los campos, jamás se recalcula su pago.
//   · BarberUser  = quien ENTRA al panel, con su rol y sus permisos.
//
// PERMISOS — la lección del dental. El motor (src/lib/barber/permissions.ts)
// dice que permissionsOverride REEMPLAZA los defaults del rol. Eso, editado
// a ciegas, es justo el bug que se sufrió: al ponerle un override a alguien
// se le apagaba todo lo demás. Aquí NUNCA se guarda un delta: la UI edita el
// conjunto EFECTIVO completo y este módulo guarda ese conjunto entero, o []
// cuando coincide exactamente con el rol (herencia pura, para que un permiso
// nuevo del rol le siga llegando). describeMemberPermissions() devuelve, por
// clave, si viene del rol o si es una excepción puesta a mano — y la pantalla
// enseña siempre el resultado final.
//
// El gate REAL es del servidor: cada endpoint llama assertBarberPermission().
// Esconder un menú no es un permiso.
//
// Multi-tenant: la lista de sedes SIEMPRE sale de getAccessibleBranchIds(ctx)
// y se usa como `{ barbershopId: { in } }`. Un undefined ahí borraría el
// filtro de tenant (regla dura de la Ola 0).
// ═══════════════════════════════════════════════════════════════════════

export { BarberAdminError };

export const BARBER_ROLES: BarberRole[] = ["OWNER", "MANAGER", "RECEPTION", "BARBER"];
export const BARBER_COMMISSION_TYPES: BarberCommissionType[] = [
  "COMMISSION",
  "CHAIR_RENT",
  "SALARY",
];

function isRole(v: unknown): v is BarberRole {
  return typeof v === "string" && (BARBER_ROLES as string[]).includes(v);
}
function isCommissionType(v: unknown): v is BarberCommissionType {
  return typeof v === "string" && (BARBER_COMMISSION_TYPES as string[]).includes(v);
}

function adminSupabase() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Plan de la CADENA (la suscripción vive en la matriz, no en cada sede). */
async function chainPlan(ctx: BarberContext) {
  const root = await prisma.barbershop.findUnique({
    where: { id: chainRootId(ctx) },
    select: { plan: true },
  });
  return getBarberPlan(root?.plan ?? ctx.barbershop.plan);
}

// ═══════════════════════════════════════════════════════════════════════
// PERMISOS — lectura explicada
// ═══════════════════════════════════════════════════════════════════════

/** Origen de un permiso en la ficha de un usuario. */
export type BarberPermissionOrigin = "inherited" | "added" | "removed" | "roleOnly";

export interface BarberPermissionState {
  key: BarberPermissionKey;
  label: string;
  /** ¿El ROL lo trae de fábrica? */
  fromRole: boolean;
  /** ¿Lo tiene AL FINAL? Esto es lo que valida el servidor. */
  effective: boolean;
  /**
   *  inherited -> lo tiene y viene del rol
   *  added     -> lo tiene porque se lo dieron a mano (el rol no lo trae)
   *  removed   -> el rol lo trae pero se lo quitaron a mano
   *  roleOnly  -> ni el rol lo trae ni se lo dieron
   */
  origin: BarberPermissionOrigin;
}

export interface BarberPermissionSummary {
  role: BarberRole;
  /** true = tiene excepciones guardadas (permissionsOverride no vacío). */
  hasOverride: boolean;
  items: BarberPermissionState[];
  /** Claves que el rol NO trae y se dieron a mano. */
  added: BarberPermissionKey[];
  /** Claves que el rol SÍ trae y se quitaron a mano. */
  removed: BarberPermissionKey[];
  /** El conjunto final, en el orden canónico de BARBER_PERMISSIONS. */
  effective: BarberPermissionKey[];
}

/** Ordena y deduplica según el orden canónico de BARBER_PERMISSIONS. */
export function canonicalPermissions(
  keys: Iterable<string>,
): BarberPermissionKey[] {
  const wanted = new Set(Array.from(keys));
  return BARBER_PERMISSION_KEYS.filter((k) => wanted.has(k));
}

function sameKeySet(a: BarberPermissionKey[], b: BarberPermissionKey[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Explica, clave por clave, qué tiene un usuario y POR QUÉ. Es lo que pinta
 * la matriz: nunca se enseña un checkbox suelto sin decir si es herencia del
 * rol o una excepción puesta a mano.
 */
export function describeMemberPermissions(
  role: BarberRole,
  permissionsOverride?: string[] | null,
): BarberPermissionSummary {
  const roleSet = new Set<string>(BARBER_ROLE_DEFAULT_PERMISSIONS[role] ?? []);
  // resolveBarberPermissions es el MISMO motor que usa assertBarberPermission:
  // la pantalla no puede mentir sobre lo que el servidor va a validar.
  const effectiveSet = resolveBarberPermissions(role, permissionsOverride);
  const hasOverride = canonicalPermissions(permissionsOverride ?? []).length > 0;

  const items: BarberPermissionState[] = BARBER_PERMISSIONS.map((p) => {
    const fromRole = roleSet.has(p.key);
    const effective = effectiveSet.has(p.key);
    let origin: BarberPermissionOrigin;
    if (effective && fromRole) origin = "inherited";
    else if (effective && !fromRole) origin = "added";
    else if (!effective && fromRole) origin = "removed";
    else origin = "roleOnly";
    return { key: p.key, label: p.label, fromRole, effective, origin };
  });

  return {
    role,
    hasOverride,
    items,
    added: items.filter((i) => i.origin === "added").map((i) => i.key),
    removed: items.filter((i) => i.origin === "removed").map((i) => i.key),
    effective: items.filter((i) => i.effective).map((i) => i.key),
  };
}

/**
 * Traduce el conjunto EFECTIVO que mandó la pantalla al valor que se guarda
 * en permissionsOverride.
 *
 * · Si coincide exactamente con los defaults del rol -> [] (herencia pura:
 *   así un permiso NUEVO que se agregue al rol mañana le llega solo).
 * · Si no -> el conjunto COMPLETO, nunca un delta. Ese es el contrato del
 *   motor y es lo que evita que darle un permiso apague los demás.
 */
export function overrideFromEffective(
  role: BarberRole,
  effectiveKeys: Iterable<string>,
): BarberPermissionKey[] {
  const effective = canonicalPermissions(effectiveKeys);
  const roleDefaults = canonicalPermissions(BARBER_ROLE_DEFAULT_PERMISSIONS[role] ?? []);
  return sameKeySet(effective, roleDefaults) ? [] : effective;
}

// ═══════════════════════════════════════════════════════════════════════
// BARBEROS — la ficha del profesional
// ═══════════════════════════════════════════════════════════════════════

export interface BarberProfileRow {
  id: string;
  barbershopId: string;
  name: string;
  nickname: string | null;
  photoUrl: string | null;
  bio: string | null;
  commissionType: BarberCommissionType;
  commissionPct: number | null;
  chairRent: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  /** Usuarios del panel ligados a esta ficha (normalmente 0 o 1). */
  linkedUserIds: string[];
}

export interface BarberProfileInput {
  name?: unknown;
  nickname?: unknown;
  photoUrl?: unknown;
  bio?: unknown;
  commissionType?: unknown;
  commissionPct?: unknown;
  chairRent?: unknown;
  isActive?: unknown;
  barbershopId?: unknown;
}

const BARBER_SELECT = {
  id: true,
  barbershopId: true,
  name: true,
  nickname: true,
  photoUrl: true,
  bio: true,
  commissionType: true,
  commissionPct: true,
  chairRent: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  users: { select: { id: true } },
} as const;

type BarberRowRaw = {
  id: string;
  barbershopId: string;
  name: string;
  nickname: string | null;
  photoUrl: string | null;
  bio: string | null;
  commissionType: BarberCommissionType;
  commissionPct: unknown;
  chairRent: unknown;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  users: Array<{ id: string }>;
};

function toBarberRow(r: BarberRowRaw): BarberProfileRow {
  return {
    id: r.id,
    barbershopId: r.barbershopId,
    name: r.name,
    nickname: r.nickname,
    photoUrl: r.photoUrl,
    bio: r.bio,
    commissionType: r.commissionType,
    commissionPct: r.commissionPct === null || r.commissionPct === undefined
      ? null
      : Number(r.commissionPct),
    chairRent: r.chairRent === null || r.chairRent === undefined ? null : Number(r.chairRent),
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt.toISOString(),
    linkedUserIds: r.users.map((u) => u.id),
  };
}

/** URL de foto: solo http/https y longitud sana (se pinta en la mini-web). */
function cleanPhotoUrl(value: unknown): string | null {
  const raw = cleanText(value, 500);
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) {
    throw new BarberAdminError("La foto debe ser una liga que empiece con http o https.");
  }
  return raw;
}

/**
 * Valida el esquema de pago. NO calcula nada: el cálculo de comisiones es de
 * T3 y esta pantalla solo administra los campos que T3 lee.
 */
function payFields(input: BarberProfileInput, current?: {
  commissionType: BarberCommissionType;
  commissionPct: number | null;
  chairRent: number | null;
}) {
  const type = input.commissionType === undefined
    ? current?.commissionType ?? "COMMISSION"
    : input.commissionType;
  if (!isCommissionType(type)) throw new BarberAdminError("Esquema de pago inválido.");

  const num = (v: unknown, fallback: number | null): number | null => {
    if (v === undefined) return fallback;
    if (v === null || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  if (type === "COMMISSION") {
    const pct = num(input.commissionPct, current?.commissionPct ?? null);
    if (pct === null) throw new BarberAdminError("Escribe el porcentaje de comisión.");
    if (pct < 0 || pct > 100) {
      throw new BarberAdminError("El porcentaje de comisión va de 0 a 100.");
    }
    return { commissionType: type, commissionPct: Math.round(pct * 100) / 100, chairRent: null };
  }
  if (type === "CHAIR_RENT") {
    const rent = num(input.chairRent, current?.chairRent ?? null);
    if (rent === null) throw new BarberAdminError("Escribe cuánto paga de renta de silla.");
    if (rent < 0 || rent > 9999999) throw new BarberAdminError("La renta de silla no es válida.");
    return { commissionType: type, commissionPct: null, chairRent: Math.round(rent * 100) / 100 };
  }
  return { commissionType: type, commissionPct: null, chairRent: null };
}

/** Sede donde escribir: la pedida (si la sesión la puede ver) o la propia. */
async function targetBranchId(ctx: BarberContext, requested: unknown): Promise<string> {
  if (typeof requested !== "string" || !requested) return ctx.barbershopId;
  const ids = await getAccessibleBranchIds(ctx);
  if (!ids.includes(requested)) {
    throw new BarberAdminError("Esa sede no es de tu barbería.", 404);
  }
  return requested;
}

export interface BarberSeatLimit {
  used: number;
  max: number;
  unlimited: boolean;
  canCreate: boolean;
  planName: string;
}

/**
 * Tope maxBarbers del plan. Se cuenta sobre la CADENA COMPLETA (matriz +
 * sucursales), no sobre las sedes que el usuario alcanza a ver: si no, un
 * gerente con acceso a una sola sede podría rebasar el tope de la cadena.
 */
export async function getBarberSeatLimit(ctx: BarberContext): Promise<BarberSeatLimit> {
  const plan = await chainPlan(ctx);
  const rootId = chainRootId(ctx);
  const used = await prisma.barber.count({
    where: {
      isActive: true,
      barbershop: { OR: [{ id: rootId }, { parentId: rootId }] },
    },
  });
  const unlimited = isBarberUnlimited(plan.maxBarbers);
  return {
    used,
    max: plan.maxBarbers,
    unlimited,
    canCreate: unlimited || used < plan.maxBarbers,
    planName: plan.name,
  };
}

/** Fichas de barbero de las sedes en alcance. Exige barbers.manage. */
export async function listBarbers(
  ctx: BarberContext,
  branchIds: string[],
): Promise<BarberProfileRow[]> {
  assertBarberPermission(ctx, "barbers.manage");
  if (branchIds.length === 0) return [];
  const rows = await prisma.barber.findMany({
    where: { barbershopId: { in: branchIds } },
    select: BARBER_SELECT,
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => toBarberRow(r as BarberRowRaw));
}

export async function createBarberProfile(
  ctx: BarberContext,
  input: BarberProfileInput,
): Promise<BarberProfileRow> {
  assertBarberPermission(ctx, "barbers.manage");

  const seat = await getBarberSeatLimit(ctx);
  if (!seat.canCreate) {
    throw new BarberAdminError(
      `Tu plan (${seat.planName}) incluye ${seat.max} ${seat.max === 1 ? "barbero" : "barberos"} y ya tienes ${seat.used} activos.`,
      403,
    );
  }

  const name = cleanText(input.name, 80);
  if (!name) throw new BarberAdminError("El nombre del barbero es obligatorio.");

  const barbershopId = await targetBranchId(ctx, input.barbershopId);
  const pay = payFields(input);

  const last = await prisma.barber.findFirst({
    where: { barbershopId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const created = await prisma.barber.create({
    data: {
      barbershopId,
      name,
      nickname: cleanText(input.nickname, 40) || null,
      photoUrl: cleanPhotoUrl(input.photoUrl),
      bio: cleanMultiline(input.bio, 1000) || null,
      isActive: input.isActive === undefined ? true : input.isActive === true,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      ...pay,
    },
    select: BARBER_SELECT,
  });
  return toBarberRow(created as BarberRowRaw);
}

export async function updateBarberProfile(
  ctx: BarberContext,
  barberId: string,
  input: BarberProfileInput,
): Promise<BarberProfileRow> {
  assertBarberPermission(ctx, "barbers.manage");
  const ids = await getAccessibleBranchIds(ctx);
  if (ids.length === 0) throw new BarberAdminError("Barbero no encontrado.", 404);

  const current = await prisma.barber.findFirst({
    where: { id: barberId, barbershopId: { in: ids } },
    select: {
      id: true,
      isActive: true,
      commissionType: true,
      commissionPct: true,
      chairRent: true,
    },
  });
  if (!current) throw new BarberAdminError("Barbero no encontrado.", 404);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const v = cleanText(input.name, 80);
    if (!v) throw new BarberAdminError("El nombre del barbero es obligatorio.");
    data.name = v;
  }
  if (input.nickname !== undefined) data.nickname = cleanText(input.nickname, 40) || null;
  if (input.photoUrl !== undefined) data.photoUrl = cleanPhotoUrl(input.photoUrl);
  if (input.bio !== undefined) data.bio = cleanMultiline(input.bio, 1000) || null;
  if (input.isActive !== undefined) data.isActive = input.isActive === true;

  const touchesPay =
    input.commissionType !== undefined ||
    input.commissionPct !== undefined ||
    input.chairRent !== undefined;
  if (touchesPay) {
    Object.assign(
      data,
      payFields(input, {
        commissionType: current.commissionType,
        commissionPct: current.commissionPct === null ? null : Number(current.commissionPct),
        chairRent: current.chairRent === null ? null : Number(current.chairRent),
      }),
    );
  }

  // Reactivar consume asiento del plan: se valida igual que dar de alta.
  if (data.isActive === true && !current.isActive) {
    const seat = await getBarberSeatLimit(ctx);
    if (!seat.canCreate) {
      throw new BarberAdminError(
        `Tu plan (${seat.planName}) incluye ${seat.max} ${seat.max === 1 ? "barbero" : "barberos"} activos.`,
        403,
      );
    }
  }

  const updated = await prisma.barber.update({
    where: { id: barberId },
    data,
    select: BARBER_SELECT,
  });
  return toBarberRow(updated as BarberRowRaw);
}

/**
 * Reordena las fichas de UNA sede. El orden vale para la agenda y para la
 * mini-web (Barber.sortOrder es uno solo en el contrato de la Ola 0).
 */
export async function reorderBarbers(
  ctx: BarberContext,
  barbershopId: string,
  orderedIds: string[],
): Promise<void> {
  assertBarberPermission(ctx, "barbers.manage");
  const branchId = await targetBranchId(ctx, barbershopId);
  const ids = Array.from(new Set(orderedIds.filter((id) => typeof id === "string" && id)));
  if (ids.length === 0) return;

  const owned = await prisma.barber.findMany({
    where: { id: { in: ids }, barbershopId: branchId },
    select: { id: true },
  });
  if (owned.length !== ids.length) {
    throw new BarberAdminError("Hay barberos que no son de esa sede.", 404);
  }

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.barber.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );
}

// ═══════════════════════════════════════════════════════════════════════
// USUARIOS DEL PANEL (BarberUser)
// ═══════════════════════════════════════════════════════════════════════

export interface BarberMemberRow {
  id: string;
  barbershopId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: BarberRole;
  barberId: string | null;
  barberName: string | null;
  isActive: boolean;
  lastLogin: string | null;
  createdAt: string;
  /** true = es la sesión que está mirando la pantalla. */
  isSelf: boolean;
  permissions: BarberPermissionSummary;
  /** Sedes EXTRA a las que tiene acceso (BarberUserBranchAccess). */
  branchAccessIds: string[];
}

/**
 * LISTA BLANCA DE SALIDA. supabaseId JAMÁS sale del servidor: es el
 * identificador de la cuenta de autenticación, no un dato de negocio.
 * Cualquier columna nueva de BarberUser tiene que agregarse aquí a mano.
 */
const MEMBER_SELECT = {
  id: true,
  barbershopId: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  barberId: true,
  isActive: true,
  permissionsOverride: true,
  lastLogin: true,
  createdAt: true,
  barber: { select: { name: true } },
  branchAccess: { select: { barbershopId: true } },
} as const;

type MemberRowRaw = {
  id: string;
  barbershopId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: BarberRole;
  barberId: string | null;
  isActive: boolean;
  permissionsOverride: string[];
  lastLogin: Date | null;
  createdAt: Date;
  barber: { name: string } | null;
  branchAccess: Array<{ barbershopId: string }>;
};

function toMemberRow(r: MemberRowRaw, ctx: BarberContext): BarberMemberRow {
  return {
    id: r.id,
    barbershopId: r.barbershopId,
    email: r.email,
    firstName: r.firstName,
    lastName: r.lastName,
    role: r.role,
    barberId: r.barberId,
    barberName: r.barber?.name ?? null,
    isActive: r.isActive,
    lastLogin: r.lastLogin ? r.lastLogin.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    isSelf: r.id === ctx.barberUserId,
    permissions: describeMemberPermissions(r.role, r.permissionsOverride),
    branchAccessIds: r.branchAccess.map((b) => b.barbershopId),
  };
}

export async function listMembers(
  ctx: BarberContext,
  branchIds: string[],
): Promise<BarberMemberRow[]> {
  assertBarberPermission(ctx, "team.manage");
  if (branchIds.length === 0) return [];
  const rows = await prisma.barberUser.findMany({
    where: { barbershopId: { in: branchIds } },
    select: MEMBER_SELECT,
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { firstName: "asc" }],
  });
  return rows.map((r) => toMemberRow(r as MemberRowRaw, ctx));
}

/** Carga un miembro comprobando que sea de una sede que la sesión alcanza. */
async function loadMemberInScope(ctx: BarberContext, memberId: string) {
  const ids = await getAccessibleBranchIds(ctx);
  if (ids.length === 0) throw new BarberAdminError("Usuario no encontrado.", 404);
  const member = await prisma.barberUser.findFirst({
    where: { id: memberId, barbershopId: { in: ids } },
    select: MEMBER_SELECT,
  });
  if (!member) throw new BarberAdminError("Usuario no encontrado.", 404);
  return member as MemberRowRaw;
}

/** Solo un dueño reparte el rol de dueño (freno a la escalada de privilegios). */
function assertCanAssignRole(ctx: BarberContext, role: BarberRole): void {
  if (role === "OWNER" && ctx.role !== "OWNER") {
    throw new BarberAdminError("Solo el dueño puede nombrar a otro dueño.", 403);
  }
}

/**
 * ¿Queda alguien más que pueda administrar el equipo en esa sede? Sin este
 * freno una barbería se puede dejar fuera de su propio panel.
 */
async function hasAnotherTeamAdmin(
  barbershopId: string,
  exceptUserId: string,
): Promise<boolean> {
  const others = await prisma.barberUser.findMany({
    where: { barbershopId, isActive: true, id: { not: exceptUserId } },
    select: { role: true, permissionsOverride: true },
  });
  return others.some((u) =>
    resolveBarberPermissions(u.role, u.permissionsOverride).has("team.manage"),
  );
}

async function assertNotLastTeamAdmin(
  member: MemberRowRaw,
  reason: string,
): Promise<void> {
  const isAdminNow = resolveBarberPermissions(
    member.role,
    member.permissionsOverride,
  ).has("team.manage");
  if (!isAdminNow) return;
  if (await hasAnotherTeamAdmin(member.barbershopId, member.id)) return;
  throw new BarberAdminError(
    `${reason} Es la única persona que puede administrar el equipo de esta sede: nombra a alguien más antes.`,
    409,
  );
}

export interface InviteMemberInput {
  email?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  role?: unknown;
  barberId?: unknown;
  barbershopId?: unknown;
}

/** Contraseña temporal legible. Se le enseña UNA vez a quien da de alta. */
function tempPassword(): string {
  const letters = Math.random().toString(36).slice(2, 6).toUpperCase();
  const digits = String(Math.floor(100 + Math.random() * 900));
  return `Barber${letters}${digits}!`;
}

/** La ficha de barbero existe y es de la MISMA sede que el usuario. */
async function assertBarberBelongsTo(barberId: string, barbershopId: string): Promise<void> {
  const barber = await prisma.barber.findFirst({
    where: { id: barberId, barbershopId },
    select: { id: true },
  });
  if (!barber) throw new BarberAdminError("Ese barbero no es de esa sede.", 404);
}

/**
 * Da de alta a alguien en el panel. Crea la cuenta en Supabase Auth con una
 * contraseña temporal (mismo patrón que el alta de equipo del dental: no se
 * manda correo, la contraseña se le entrega en mano) y la fila BarberUser.
 *
 * Nace SIN override: hereda los permisos de su rol. Las excepciones se ponen
 * después, y siempre sobre el conjunto completo.
 */
export async function inviteMember(
  ctx: BarberContext,
  input: InviteMemberInput,
): Promise<{ member: BarberMemberRow; tempPassword: string }> {
  assertBarberPermission(ctx, "team.manage");

  const firstName = cleanText(input.firstName, 60);
  const lastName = cleanText(input.lastName, 60);
  const email = cleanText(input.email, 160).toLowerCase();
  const role: BarberRole = isRole(input.role) ? input.role : "RECEPTION";

  if (!firstName) throw new BarberAdminError("El nombre es obligatorio.");
  if (!lastName) throw new BarberAdminError("El apellido es obligatorio.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new BarberAdminError("Escribe un correo válido.");
  }
  assertCanAssignRole(ctx, role);

  const barbershopId = await targetBranchId(ctx, input.barbershopId);

  const dupe = await prisma.barberUser.findFirst({
    where: { barbershopId, email },
    select: { id: true },
  });
  if (dupe) throw new BarberAdminError("Ya hay alguien con ese correo en esta sede.", 409);

  const barberId = typeof input.barberId === "string" && input.barberId ? input.barberId : null;
  if (barberId) await assertBarberBelongsTo(barberId, barbershopId);

  const password = tempPassword();
  const { data: created, error } = await adminSupabase().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { firstName, lastName, barbershopName: ctx.barbershop.name },
  });

  if (error || !created?.user) {
    const msg = error?.message ?? "";
    if (msg.includes("already been registered") || msg.includes("already exists")) {
      throw new BarberAdminError(
        "Ese correo ya tiene cuenta en DaleControl. Usa otro correo para esta persona.",
        409,
      );
    }
    throw new BarberAdminError(msg || "No se pudo crear la cuenta.", 400);
  }

  let row: MemberRowRaw;
  try {
    row = (await prisma.barberUser.create({
      data: {
        barbershopId,
        supabaseId: created.user.id,
        email,
        firstName,
        lastName,
        role,
        barberId,
        isActive: true,
        // Nace heredando el rol. Nunca con un override "de arranque".
        permissionsOverride: [],
      },
      select: MEMBER_SELECT,
    })) as MemberRowRaw;
  } catch (err) {
    // Rollback best-effort de la cuenta de Supabase, igual que el registro.
    try {
      await adminSupabase().auth.admin.deleteUser(created.user.id);
    } catch {
      /* best-effort */
    }
    throw err;
  }

  return { member: toMemberRow(row, ctx), tempPassword: password };
}

export interface UpdateMemberInput {
  firstName?: unknown;
  lastName?: unknown;
  role?: unknown;
  barberId?: unknown;
  isActive?: unknown;
}

/**
 * Edita a un miembro. El CORREO no se toca aquí a propósito: es su identidad
 * de acceso y cambiarlo obliga a mover también la cuenta de Supabase (el
 * dental ya se quemó con eso). Se da de baja y se vuelve a dar de alta.
 */
export async function updateMember(
  ctx: BarberContext,
  memberId: string,
  input: UpdateMemberInput,
): Promise<BarberMemberRow> {
  assertBarberPermission(ctx, "team.manage");
  const member = await loadMemberInScope(ctx, memberId);
  const isSelf = member.id === ctx.barberUserId;

  const data: Record<string, unknown> = {};

  if (input.firstName !== undefined) {
    const v = cleanText(input.firstName, 60);
    if (!v) throw new BarberAdminError("El nombre es obligatorio.");
    data.firstName = v;
  }
  if (input.lastName !== undefined) {
    const v = cleanText(input.lastName, 60);
    if (!v) throw new BarberAdminError("El apellido es obligatorio.");
    data.lastName = v;
  }

  if (input.role !== undefined && input.role !== member.role) {
    if (!isRole(input.role)) throw new BarberAdminError("Rol inválido.");
    if (isSelf) throw new BarberAdminError("No puedes cambiarte el rol a ti mismo.", 409);
    assertCanAssignRole(ctx, input.role);
    if (member.role === "OWNER") assertCanAssignRole(ctx, "OWNER");
    // Cambiar de rol con override guardado dejaría el override viejo mandando
    // sobre el rol nuevo: se limpia y vuelve a heredar (y se avisa en la UI).
    const nextGrants = resolveBarberPermissions(input.role, []);
    if (!nextGrants.has("team.manage")) {
      await assertNotLastTeamAdmin(member, "No puedes quitarle la administración del equipo.");
    }
    data.role = input.role;
    data.permissionsOverride = [];
  }

  if (input.barberId !== undefined) {
    const barberId = typeof input.barberId === "string" && input.barberId ? input.barberId : null;
    if (barberId) await assertBarberBelongsTo(barberId, member.barbershopId);
    data.barberId = barberId;
  }

  if (input.isActive !== undefined && input.isActive !== member.isActive) {
    const next = input.isActive === true;
    if (!next) {
      if (isSelf) throw new BarberAdminError("No puedes darte de baja a ti mismo.", 409);
      await assertNotLastTeamAdmin(member, "No puedes darle de baja.");
    }
    data.isActive = next;
  }

  const updated = (await prisma.barberUser.update({
    where: { id: memberId },
    data,
    select: MEMBER_SELECT,
  })) as MemberRowRaw;
  return toMemberRow(updated, ctx);
}

/**
 * Guarda los permisos de un usuario a partir del conjunto EFECTIVO que
 * mandó la pantalla (nunca un delta).
 *
 * Reglas que evitan el bug del dental:
 *  1. Lo que llega es "lo que esta persona debe poder hacer", completo.
 *  2. Si eso es exactamente lo del rol -> se guarda [] y vuelve a heredar.
 *  3. Si no -> se guarda el conjunto entero, que es lo que el motor lee.
 * Así ningún permiso se apaga sin que alguien lo haya apagado a propósito.
 */
export async function setMemberPermissions(
  ctx: BarberContext,
  memberId: string,
  effectiveKeys: unknown,
): Promise<BarberMemberRow> {
  assertBarberPermission(ctx, "team.manage");
  const member = await loadMemberInScope(ctx, memberId);

  if (!Array.isArray(effectiveKeys)) {
    throw new BarberAdminError("Lista de permisos inválida.");
  }
  const unknownKey = effectiveKeys.find(
    (k) => typeof k !== "string" || !(BARBER_PERMISSION_KEYS as string[]).includes(k),
  );
  if (unknownKey !== undefined) {
    throw new BarberAdminError("Hay un permiso que no existe en la lista.");
  }

  const nextOverride = overrideFromEffective(member.role, effectiveKeys as string[]);
  const backToRole = nextOverride.length === 0;

  // La matriz fina es del plan Profesional. Volver a los permisos del rol
  // (limpiar el override) se permite SIEMPRE: es la válvula de escape de
  // quien bajó de plan con excepciones guardadas.
  if (!backToRole) {
    const plan = await chainPlan(ctx);
    if (!barberPlanHasFeature(plan, "advancedRoles")) {
      throw new BarberAdminError(
        `Los permisos por persona son del plan Profesional. En tu plan (${plan.name}) mandan los roles de fábrica.`,
        403,
      );
    }
  }

  const nextGrants = resolveBarberPermissions(member.role, nextOverride);
  if (!nextGrants.has("team.manage")) {
    if (member.id === ctx.barberUserId) {
      throw new BarberAdminError(
        "No puedes quitarte a ti mismo la administración del equipo.",
        409,
      );
    }
    await assertNotLastTeamAdmin(member, "No puedes quitarle la administración del equipo.");
  }

  const updated = (await prisma.barberUser.update({
    where: { id: memberId },
    data: { permissionsOverride: nextOverride },
    select: MEMBER_SELECT,
  })) as MemberRowRaw;
  return toMemberRow(updated, ctx);
}

/**
 * Reparte el acceso de una persona a otras sedes de la cadena
 * (BarberUserBranchAccess). Es un permiso de SUCURSALES, no de equipo: así
 * lo fija el contrato de la Ola 0-B.
 *
 * El dueño no necesita filas: getAccessibleBranchIds ya le da la cadena
 * completa. Se guardan igual si se mandan (no estorban).
 */
export async function setMemberBranchAccess(
  ctx: BarberContext,
  memberId: string,
  branchIds: unknown,
): Promise<BarberMemberRow> {
  assertBarberPermission(ctx, "branches.manage");
  const member = await loadMemberInScope(ctx, memberId);

  const plan = await chainPlan(ctx);
  if (!barberPlanHasFeature(plan, "multiBranch")) {
    throw new BarberAdminError(
      `Las sucursales son del plan Profesional. Tu plan (${plan.name}) no las incluye.`,
      403,
    );
  }
  if (!Array.isArray(branchIds)) throw new BarberAdminError("Lista de sedes inválida.");

  const accessible = await getAccessibleBranchIds(ctx);
  const wanted = Array.from(
    new Set(branchIds.filter((id): id is string => typeof id === "string" && id.length > 0)),
  )
    // Nadie puede repartir acceso a una sede que ni él mismo alcanza, y la
    // sede propia del usuario no se guarda (ya la trae su fila BarberUser).
    .filter((id) => accessible.includes(id) && id !== member.barbershopId);

  await prisma.$transaction([
    prisma.barberUserBranchAccess.deleteMany({ where: { userId: memberId } }),
    ...(wanted.length > 0
      ? [
          prisma.barberUserBranchAccess.createMany({
            data: wanted.map((barbershopId) => ({ userId: memberId, barbershopId })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  const updated = (await prisma.barberUser.findUniqueOrThrow({
    where: { id: memberId },
    select: MEMBER_SELECT,
  })) as MemberRowRaw;
  return toMemberRow(updated, ctx);
}

/**
 * Contexto que necesita la pantalla de equipo: los planes que mandan, quién
 * eres tú y qué puedes repartir. La UI no vuelve a calcular nada de esto.
 */
export interface BarberTeamContext {
  selfUserId: string;
  selfRole: BarberRole;
  canAssignOwner: boolean;
  advancedRoles: boolean;
  multiBranch: boolean;
  planName: string;
  canManageBranches: boolean;
}

export async function getTeamContext(ctx: BarberContext): Promise<BarberTeamContext> {
  const plan = await chainPlan(ctx);
  const grants = resolveBarberPermissions(ctx.role, ctx.user.permissionsOverride);
  return {
    selfUserId: ctx.barberUserId,
    selfRole: ctx.role,
    canAssignOwner: ctx.role === "OWNER",
    advancedRoles: barberPlanHasFeature(plan, "advancedRoles"),
    multiBranch: barberPlanHasFeature(plan, "multiBranch"),
    planName: plan.name,
    canManageBranches: grants.has("branches.manage"),
  };
}
