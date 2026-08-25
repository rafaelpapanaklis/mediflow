import "server-only";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import {
  assertRealtyPermission,
  getAccessibleOfficeIds,
  hasRealtyPermission,
  RealtyForbiddenError,
  type RealtyContext,
} from "@/lib/realty-auth";
import {
  REALTY_PERMISSIONS,
  REALTY_PERMISSION_KEYS,
  REALTY_ROLE_DEFAULT_PERMISSIONS,
  resolveRealtyPermissions,
  type RealtyPermissionKey,
} from "@/lib/realty/permissions";
import { getRealtyPlans } from "@/lib/realty/plans";
import { isRealtyUnlimited, type RealtyPlanId } from "@/lib/realty/plan-shared";
import {
  makeRealtySlug,
  navItemAllowsMode,
  REALTY_NAV_ITEMS,
  type RealtyRole,
} from "@/lib/realty/types";

// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES — EQUIPO: personas, roles, permisos, ficha pública
// del asesor y la BAJA de un asesor.
//
// Todo lo de aquí exige `team.manage` y filtra SIEMPRE por ctx.accountId. Un
// id que llega del navegador jamás se usa solo: se busca `findFirst({ where:
// { id, accountId } })`, así un id de otra inmobiliaria simplemente no
// existe (404), no "existe y no tienes permiso".
//
// PERMISOS — la lección del dental y de barber. El motor
// (realty/permissions.ts) dice que permissionsOverride REEMPLAZA los
// defaults del rol. Editar eso a ciegas es EL bug: al darle un permiso a
// alguien se le apagaban los demás. Aquí NUNCA se guarda un delta: la
// pantalla edita el conjunto EFECTIVO completo y este módulo guarda ese
// conjunto entero, o [] cuando coincide exactamente con el rol (herencia
// pura, para que un permiso nuevo del rol le siga llegando).
// describeRealtyPermissions() devuelve, clave por clave, si viene del rol o
// si es una excepción a mano — y la pantalla siempre enseña el resultado
// final más el aviso de que el override congela la herencia.
// ═══════════════════════════════════════════════════════════════════════

export const REALTY_ROLES: RealtyRole[] = ["OWNER", "MANAGER", "AGENT", "ASSISTANT"];

function isRealtyRole(v: unknown): v is RealtyRole {
  return typeof v === "string" && (REALTY_ROLES as string[]).includes(v);
}

// ── Errores ────────────────────────────────────────────────────────────

/** Error tipado del área de equipo. Las APIs lo mapean con realtyApiError. */
export class RealtyAdminError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 400, code = "INVALID_INPUT") {
    super(message);
    this.name = "RealtyAdminError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Traduce cualquier error de este módulo a la respuesta JSON de la API.
 * Espejo de moneyErrorResponse (barber): un solo sitio decide el status y
 * ninguna route handler inventa su propio catch.
 */
export function realtyApiError(e: unknown): NextResponse {
  if (e instanceof RealtyForbiddenError) {
    return NextResponse.json(
      { error: "No tienes permiso para hacer eso.", code: "FORBIDDEN", permission: e.permission },
      { status: 403 },
    );
  }
  if (e instanceof RealtyAdminError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return NextResponse.json(
      { error: "Ya existe un registro igual.", code: "CONFLICT" },
      { status: 409 },
    );
  }
  console.error("[realty-team]", e);
  return NextResponse.json({ error: "Error interno.", code: "INTERNAL" }, { status: 500 });
}

/**
 * 🔴 El MODO de la cuenta y la FEATURE del plan, comprobados EN LA API.
 *
 * El layout ya esconde del menú lo que no aplica y cada página redirige,
 * pero esconder un botón no es control de acceso: quien llame a
 * /api/realty/team con curl desde una cuenta en modo AGENT llegaría igual.
 * Esto lo corta, y sale del MISMO campo `modes`/`featureKey` del contrato
 * (REALTY_NAV_ITEMS) — no de un if inventado aquí, que se quedaría viejo el
 * día que el contrato cambie.
 *
 * 404 cuando el área no existe para ese modo (no es "no tienes permiso": es
 * que esa pantalla no forma parte de su producto) y 402 cuando falta el plan.
 */
export function assertRealtyArea(ctx: RealtyContext, areaKey: string): void {
  const item = REALTY_NAV_ITEMS.find((i) => i.key === areaKey);
  if (!item) return;
  if (!navItemAllowsMode(item, ctx.mode)) {
    throw new RealtyAdminError(
      "Esta sección no existe para tu tipo de cuenta.",
      404,
      "AREA_NOT_IN_MODE",
    );
  }
  if (item.featureKey && ctx.plan.features[item.featureKey] !== true) {
    throw new RealtyAdminError(
      `Tu plan ${ctx.plan.name} no incluye esta sección.`,
      402,
      "PLAN_FEATURE",
    );
  }
}

// ── Utilidades de texto ────────────────────────────────────────────────

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function cleanMultiline(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim().slice(0, max);
}

function cleanList(value: unknown, max: number, itemMax = 60): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const t = cleanText(item, itemMax);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function adminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new RealtyAdminError(
      "Falta la configuración del servidor para dar de alta usuarios.",
      500,
      "SUPABASE_NOT_CONFIGURED",
    );
  }
  return createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * ¿El error de createUser significa "ese correo ya existe en Supabase Auth"?
 * El login es COMPARTIDO entre los tres productos de DaleControl, así que un
 * asesor que ya trabajó en otra cuenta (o que tiene el dental) ya existe.
 * El SDK instalado no busca por correo, así que createUser se usa de sonda:
 * es un INSERT puro que no toca al usuario existente si ya está.
 */
function isEmailTakenError(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  const code = (err as { code?: string }).code ?? "";
  if (code === "email_exists" || code === "user_already_exists") return true;
  const msg = err.message ?? "";
  return /already\s+(been\s+)?registered|already\s+exists|email\s+address\s+is\s+already/i.test(msg);
}

// ═══════════════════════════════════════════════════════════════════════
// PERMISOS — lectura explicada
// ═══════════════════════════════════════════════════════════════════════

export type RealtyPermissionOrigin = "inherited" | "added" | "removed" | "none";

export interface RealtyPermissionState {
  key: RealtyPermissionKey;
  label: string;
  /** ¿El ROL lo trae de fábrica? */
  fromRole: boolean;
  /** ¿Lo tiene AL FINAL? Esto es lo que valida el servidor. */
  effective: boolean;
  /**
   *  inherited → lo tiene y viene del rol
   *  added     → lo tiene porque se lo dieron a mano
   *  removed   → el rol lo trae pero se lo quitaron a mano
   *  none      → ni el rol lo trae ni se lo dieron
   */
  origin: RealtyPermissionOrigin;
}

export interface RealtyPermissionSummary {
  role: RealtyRole;
  /** true = tiene excepciones guardadas (permissionsOverride no vacío). */
  hasOverride: boolean;
  items: RealtyPermissionState[];
  added: RealtyPermissionKey[];
  removed: RealtyPermissionKey[];
  /** El conjunto final, en el orden canónico de REALTY_PERMISSIONS. */
  effective: RealtyPermissionKey[];
}

/** Ordena y deduplica según el orden canónico de REALTY_PERMISSIONS. */
export function canonicalRealtyPermissions(keys: Iterable<string>): RealtyPermissionKey[] {
  const wanted = new Set(Array.from(keys));
  return REALTY_PERMISSION_KEYS.filter((k) => wanted.has(k));
}

function sameKeySet(a: RealtyPermissionKey[], b: RealtyPermissionKey[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Explica, clave por clave, qué tiene alguien y POR QUÉ. Es lo que pinta la
 * matriz: nunca se enseña un interruptor suelto sin decir si es herencia del
 * rol o una excepción puesta a mano.
 */
export function describeRealtyPermissions(
  role: RealtyRole,
  permissionsOverride?: string[] | null,
): RealtyPermissionSummary {
  const roleSet = new Set<string>(REALTY_ROLE_DEFAULT_PERMISSIONS[role] ?? []);
  // Mismo motor que assertRealtyPermission: la pantalla no puede mentir
  // sobre lo que el servidor va a validar.
  const effectiveSet = resolveRealtyPermissions(role, permissionsOverride);
  const hasOverride = canonicalRealtyPermissions(permissionsOverride ?? []).length > 0;

  const items: RealtyPermissionState[] = REALTY_PERMISSIONS.map((p) => {
    const fromRole = roleSet.has(p.key);
    const effective = effectiveSet.has(p.key);
    let origin: RealtyPermissionOrigin;
    if (effective && fromRole) origin = "inherited";
    else if (effective && !fromRole) origin = "added";
    else if (!effective && fromRole) origin = "removed";
    else origin = "none";
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
 * · Si coincide exactamente con los defaults del rol → [] (herencia pura:
 *   así un permiso NUEVO que se agregue al rol mañana le llega solo).
 * · Si no → el conjunto COMPLETO, nunca un delta. Ese es el contrato del
 *   motor y es lo que evita que dar un permiso apague los demás.
 */
export function overrideFromEffective(
  role: RealtyRole,
  effectiveKeys: Iterable<string>,
): RealtyPermissionKey[] {
  const effective = canonicalRealtyPermissions(effectiveKeys);
  const roleDefaults = canonicalRealtyPermissions(REALTY_ROLE_DEFAULT_PERMISSIONS[role] ?? []);
  return sameKeySet(effective, roleDefaults) ? [] : effective;
}

// ═══════════════════════════════════════════════════════════════════════
// Cupo de usuarios del plan
// ═══════════════════════════════════════════════════════════════════════

export interface RealtySeatLimit {
  used: number;
  max: number;
  unlimited: boolean;
  canInvite: boolean;
  planId: RealtyPlanId;
  planName: string;
  /**
   * Plan más barato que SÍ da lugar para uno más. null = ya está en el
   * tope de la escalera (o el suyo es ilimitado). El precio sale de la
   * tabla realty_plan_configs, jamás escrito en la pantalla.
   */
  upgrade: { id: RealtyPlanId; name: string; maxUsers: number; priceMonthly: number } | null;
}

/**
 * Tope maxUsers del plan. Cuentan los usuarios ACTIVOS: alguien dado de baja
 * libera su lugar (es justo lo que espera quien acaba de dar de baja a un
 * asesor y quiere contratar al siguiente).
 */
export async function getRealtySeatLimit(ctx: RealtyContext): Promise<RealtySeatLimit> {
  const [used, plans] = await Promise.all([
    prisma.realtyUser.count({ where: { accountId: ctx.accountId, active: true } }),
    getRealtyPlans(),
  ]);
  const plan = ctx.plan;
  const unlimited = isRealtyUnlimited(plan.maxUsers);
  const canInvite = unlimited || used < plan.maxUsers;

  const upgrade = canInvite
    ? null
    : (plans
        .filter((p) => p.isActive && (isRealtyUnlimited(p.maxUsers) || p.maxUsers > used))
        .sort((a, b) => a.priceMonthly - b.priceMonthly)[0] ?? null);

  return {
    used,
    max: plan.maxUsers,
    unlimited,
    canInvite,
    planId: plan.id,
    planName: plan.name,
    upgrade: upgrade
      ? {
          id: upgrade.id,
          name: upgrade.name,
          maxUsers: upgrade.maxUsers,
          priceMonthly: upgrade.priceMonthly,
        }
      : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Ficha pública del asesor — forma de los Json `credentials` y `socials`
// ═══════════════════════════════════════════════════════════════════════
//
// 🔴 CONTRATO CON LA WEB PÚBLICA (T5, /i/[slug]/agentes/[agente]): el schema
// deja `credentials` y `socials` como Json libre "que define la ola de
// equipo". Esta es esa definición y no cambia sin avisar.
//
// credentials = {
//   ec0110: { has: boolean, folio: string|null, issuedAt: "YYYY-MM-DD"|null },
//   ampi:   { member: boolean, memberId: string|null, section: string|null },
//   state:  { number: string|null, state: string|null, expiresAt: "YYYY-MM-DD"|null },
//   others: [{ label: string, value: string|null, expiresAt: string|null }]
// }
// socials = { facebook, instagram, linkedin, youtube, tiktok, website } (URLs
//   absolutas https) + whatsapp (10 dígitos, sin lada internacional).
//
// EC0110.02 es el estándar de competencia de "Comercialización de servicios
// inmobiliarios"; AMPI es la asociación; el registro estatal lo exigen
// Jalisco, CDMX, Q. Roo y varios más, y VENCE — por eso lleva fecha.

export interface RealtyAgentCredentials {
  ec0110: { has: boolean; folio: string | null; issuedAt: string | null };
  ampi: { member: boolean; memberId: string | null; section: string | null };
  state: { number: string | null; state: string | null; expiresAt: string | null };
  others: { label: string; value: string | null; expiresAt: string | null }[];
}

export interface RealtyAgentSocials {
  facebook: string | null;
  instagram: string | null;
  linkedin: string | null;
  youtube: string | null;
  tiktok: string | null;
  website: string | null;
  whatsapp: string | null;
}

export const EMPTY_CREDENTIALS: RealtyAgentCredentials = {
  ec0110: { has: false, folio: null, issuedAt: null },
  ampi: { member: false, memberId: null, section: null },
  state: { number: null, state: null, expiresAt: null },
  others: [],
};

export const EMPTY_SOCIALS: RealtyAgentSocials = {
  facebook: null,
  instagram: null,
  linkedin: null,
  youtube: null,
  tiktok: null,
  website: null,
  whatsapp: null,
};

/** "2027-01-31" o null. Acepta un ISO completo y se queda con la fecha. */
function cleanDate(value: unknown): string | null {
  const s = cleanText(value, 32);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

/** URL https absoluta o null. Nada de javascript: ni de rutas relativas. */
function cleanUrl(value: unknown): string | null {
  const s = cleanText(value, 200);
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Los 10 dígitos mexicanos, o null. */
function cleanPhone(value: unknown): string | null {
  const digits = cleanText(value, 32).replace(/\D/g, "");
  if (digits.length === 10) return digits;
  // +52 33 1234 5678 → se queda con los últimos 10.
  if (digits.length > 10 && digits.length <= 13) return digits.slice(-10);
  return null;
}

export function normalizeCredentials(raw: unknown): RealtyAgentCredentials {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ec = (r.ec0110 ?? {}) as Record<string, unknown>;
  const ampi = (r.ampi ?? {}) as Record<string, unknown>;
  const state = (r.state ?? {}) as Record<string, unknown>;
  const others = Array.isArray(r.others) ? r.others : [];
  return {
    ec0110: {
      has: ec.has === true,
      folio: cleanText(ec.folio, 60) || null,
      issuedAt: cleanDate(ec.issuedAt),
    },
    ampi: {
      member: ampi.member === true,
      memberId: cleanText(ampi.memberId, 60) || null,
      section: cleanText(ampi.section, 60) || null,
    },
    state: {
      number: cleanText(state.number, 60) || null,
      state: cleanText(state.state, 40) || null,
      expiresAt: cleanDate(state.expiresAt),
    },
    others: others
      .slice(0, 6)
      .map((o) => {
        const item = (o ?? {}) as Record<string, unknown>;
        return {
          label: cleanText(item.label, 60),
          value: cleanText(item.value, 80) || null,
          expiresAt: cleanDate(item.expiresAt),
        };
      })
      .filter((o) => o.label.length > 0),
  };
}

export function normalizeSocials(raw: unknown): RealtyAgentSocials {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    facebook: cleanUrl(r.facebook),
    instagram: cleanUrl(r.instagram),
    linkedin: cleanUrl(r.linkedin),
    youtube: cleanUrl(r.youtube),
    tiktok: cleanUrl(r.tiktok),
    website: cleanUrl(r.website),
    whatsapp: cleanPhone(r.whatsapp),
  };
}

// ¿El registro estatal está vencido? Ese chequeo vive en el kit de UI
// (src/components/realty/team/ui.tsx) y NO aquí: lo necesita el formulario de
// la ficha, que es un componente "use client", y este módulo es server-only —
// importarlo desde el navegador reventaría el build.

export interface RealtyAgentProfileRow {
  id: string | null;
  realtyUserId: string;
  displayName: string;
  photoUrl: string | null;
  bio: string | null;
  zones: string[];
  specialties: string[];
  credentials: RealtyAgentCredentials;
  socials: RealtyAgentSocials;
  publicSlug: string | null;
  /** Interruptor de la FICHA (lo mueve el propio asesor). */
  active: boolean;
  /** Interruptor de la CUENTA (lo mueve quien administra el equipo). */
  publicProfileEnabled: boolean;
  /** La ficha SOLO se pinta en la web si los dos interruptores están arriba. */
  visibleOnWeb: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// Miembros del equipo
// ═══════════════════════════════════════════════════════════════════════

export interface RealtyMemberRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: RealtyRole;
  active: boolean;
  publicProfileEnabled: boolean;
  lastLogin: string | null;
  createdAt: string;
  /** Oficinas a las que tiene acceso EXPLÍCITO (filas de acceso). */
  officeIds: string[];
  /** true si su rol ve TODAS las oficinas sin necesitar filas. */
  allOffices: boolean;
  permissions: RealtyPermissionSummary;
  profile: RealtyAgentProfileRow | null;
  /** ¿Es quien está mirando la pantalla? */
  isSelf: boolean;
}

const MEMBER_SELECT = {
  id: true,
  accountId: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  active: true,
  publicProfileEnabled: true,
  permissionsOverride: true,
  lastLogin: true,
  createdAt: true,
  officeAccess: { select: { officeId: true } },
  agentProfile: {
    select: {
      id: true,
      realtyUserId: true,
      displayName: true,
      photoUrl: true,
      bio: true,
      zones: true,
      specialties: true,
      credentials: true,
      socials: true,
      publicSlug: true,
      active: true,
    },
  },
} satisfies Prisma.RealtyUserSelect;

type MemberRaw = Prisma.RealtyUserGetPayload<{ select: typeof MEMBER_SELECT }>;

/** OWNER y MANAGER ven todas las oficinas sin necesitar filas de acceso. */
function roleSeesAllOffices(role: RealtyRole): boolean {
  return role === "OWNER" || role === "MANAGER";
}

function toProfileRow(row: MemberRaw): RealtyAgentProfileRow | null {
  const p = row.agentProfile;
  if (!p) return null;
  return {
    id: p.id,
    realtyUserId: p.realtyUserId,
    displayName: p.displayName,
    photoUrl: p.photoUrl,
    bio: p.bio,
    zones: p.zones,
    specialties: p.specialties,
    credentials: normalizeCredentials(p.credentials),
    socials: normalizeSocials(p.socials),
    publicSlug: p.publicSlug,
    active: p.active,
    publicProfileEnabled: row.publicProfileEnabled,
    visibleOnWeb: p.active && row.publicProfileEnabled,
  };
}

function toMemberRow(row: MemberRaw, ctx: RealtyContext): RealtyMemberRow {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`.trim(),
    role: row.role,
    active: row.active,
    publicProfileEnabled: row.publicProfileEnabled,
    lastLogin: row.lastLogin ? row.lastLogin.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    officeIds: row.officeAccess.map((a) => a.officeId),
    allOffices: roleSeesAllOffices(row.role),
    permissions: describeRealtyPermissions(row.role, row.permissionsOverride),
    profile: toProfileRow(row),
    isSelf: row.id === ctx.realtyUserId,
  };
}

/**
 * El equipo de la cuenta. Quien no ve todas las oficinas (un rol con
 * team.manage por override) solo ve a la gente que comparte alguna de SUS
 * oficinas — y a sí mismo. El recorte es del SERVIDOR: no se manda al
 * navegador una lista completa para esconderla con CSS.
 */
export async function listMembers(ctx: RealtyContext): Promise<RealtyMemberRow[]> {
  assertRealtyPermission(ctx, "team.manage");

  const rows = (await prisma.realtyUser.findMany({
    where: { accountId: ctx.accountId },
    select: MEMBER_SELECT,
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  })) as MemberRaw[];

  if (roleSeesAllOffices(ctx.role)) return rows.map((r) => toMemberRow(r, ctx));

  const scope = new Set(await getAccessibleOfficeIds(ctx));
  return rows
    .filter(
      (r) =>
        r.id === ctx.realtyUserId ||
        // Quien manda en toda la cuenta (OWNER/MANAGER) se ve siempre: es a
        // quien hay que pedirle las cosas.
        roleSeesAllOffices(r.role) ||
        r.officeAccess.some((a) => scope.has(a.officeId)),
    )
    .map((r) => toMemberRow(r, ctx));
}

/** Una persona de ESTA cuenta, o 404. Nunca se confía en el id del request. */
async function loadMember(ctx: RealtyContext, memberId: string): Promise<MemberRaw> {
  const row = (await prisma.realtyUser.findFirst({
    where: { id: memberId, accountId: ctx.accountId },
    select: MEMBER_SELECT,
  })) as MemberRaw | null;
  if (!row) throw new RealtyAdminError("Esa persona no es de tu cuenta.", 404, "NOT_FOUND");
  return row;
}

/** Solo un dueño nombra a otro dueño (freno a la escalada de privilegios). */
function assertCanAssignRole(ctx: RealtyContext, role: RealtyRole): void {
  if (role === "OWNER" && ctx.role !== "OWNER") {
    throw new RealtyAdminError(
      "Solo el dueño de la cuenta puede nombrar a otro dueño.",
      403,
      "FORBIDDEN_ROLE",
    );
  }
}

/**
 * ¿Queda alguien MÁS que pueda administrar el equipo? Sin este freno una
 * inmobiliaria se puede dejar fuera de su propio panel con dos clics.
 */
async function hasAnotherTeamAdmin(accountId: string, exceptUserId: string): Promise<boolean> {
  const others = await prisma.realtyUser.findMany({
    where: { accountId, active: true, id: { not: exceptUserId } },
    select: { role: true, permissionsOverride: true },
  });
  return others.some((u) => resolveRealtyPermissions(u.role, u.permissionsOverride).has("team.manage"));
}

async function assertNotLastTeamAdmin(
  accountId: string,
  member: { id: string; role: RealtyRole; permissionsOverride: string[] },
  reason: string,
): Promise<void> {
  const isAdminNow = resolveRealtyPermissions(member.role, member.permissionsOverride).has("team.manage");
  if (!isAdminNow) return;
  if (await hasAnotherTeamAdmin(accountId, member.id)) return;
  throw new RealtyAdminError(
    `${reason} Es la única persona que puede administrar el equipo: nombra a alguien más antes.`,
    409,
    "LAST_TEAM_ADMIN",
  );
}

/**
 * 🔴 Y tampoco puede quedarse sin DUEÑO. `team.manage` no basta: el rol OWNER
 * es el único que puede nombrar a otro OWNER (assertCanAssignRole) y el único
 * que trae billing.manage de fábrica.
 *
 * Sin este freno había un callejón sin salida silencioso: el único dueño se
 * bajaba a gerente (o un gerente lo daba de baja), el freno de arriba no
 * saltaba porque MANAGER también tiene team.manage… y a partir de ahí NADIE
 * podía volver a crear un dueño ni tocar la suscripción. La cuenta quedaba
 * viva pero decapitada, sin más salida que soporte.
 */
async function assertNotLastOwner(
  accountId: string,
  member: { id: string; role: RealtyRole },
  reason: string,
): Promise<void> {
  if (member.role !== "OWNER") return;
  const others = await prisma.realtyUser.count({
    where: { accountId, active: true, role: "OWNER", id: { not: member.id } },
  });
  if (others > 0) return;
  throw new RealtyAdminError(
    `${reason} Es el único dueño de la cuenta, y solo un dueño puede nombrar a otro: nombra a alguien más antes.`,
    409,
    "LAST_OWNER",
  );
}

// ── Alta por invitación ────────────────────────────────────────────────

export interface InviteMemberInput {
  email?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  role?: unknown;
  officeIds?: unknown;
}

export interface InviteMemberResult {
  member: RealtyMemberRow;
  /** Contraseña temporal. null cuando la persona YA tenía login DaleControl. */
  tempPassword: string | null;
  /** true = se ligó a una cuenta de acceso que ya existía (entra con la suya). */
  linkedExistingLogin: boolean;
}

/** Contraseña temporal legible. Se enseña UNA vez a quien da de alta. */
function tempPassword(): string {
  const letters = Math.random().toString(36).slice(2, 6).toUpperCase();
  const digits = String(Math.floor(100 + Math.random() * 900));
  return `Casa${letters}${digits}!`;
}

/**
 * Da de alta a alguien en el panel por su CORREO.
 *
 * El login de DaleControl es COMPARTIDO (Supabase Auth) entre el dental,
 * barber e inmuebles. Por eso hay dos caminos:
 *  · Correo nuevo → se crea el acceso con una contraseña temporal que se le
 *    entrega a la persona (mismo patrón que barber y el dental).
 *  · Correo que YA tiene login → se LIGA ese acceso a esta inmobiliaria sin
 *    tocarle la contraseña. Es el caso real de un asesor que cambia de
 *    inmobiliaria: entra con la suya de siempre.
 *
 * Nace SIN override: hereda los permisos de su rol.
 */
export async function inviteMember(
  ctx: RealtyContext,
  input: InviteMemberInput,
): Promise<InviteMemberResult> {
  assertRealtyPermission(ctx, "team.manage");

  const firstName = cleanText(input.firstName, 60);
  const lastName = cleanText(input.lastName, 60);
  const email = cleanText(input.email, 160).toLowerCase();
  const role: RealtyRole = isRealtyRole(input.role) ? input.role : "AGENT";

  if (!firstName) throw new RealtyAdminError("El nombre es obligatorio.");
  if (!lastName) throw new RealtyAdminError("El apellido es obligatorio.");
  if (!EMAIL_RE.test(email)) throw new RealtyAdminError("Escribe un correo válido.");
  assertCanAssignRole(ctx, role);

  // El cupo se comprueba ANTES de tocar Supabase: crear el acceso y luego
  // fallar por el plan dejaría una cuenta huérfana en Auth.
  const seats = await getRealtySeatLimit(ctx);
  if (!seats.canInvite) {
    const suffix = seats.upgrade
      ? ` Tu plan ${seats.planName} incluye ${seats.max}. Con el plan ${seats.upgrade.name} caben ${
          isRealtyUnlimited(seats.upgrade.maxUsers) ? "todos los que necesites" : seats.upgrade.maxUsers
        }.`
      : "";
    throw new RealtyAdminError(
      `Ya usaste los ${seats.max} lugares de tu plan.${suffix}`,
      409,
      "SEAT_LIMIT",
    );
  }

  const dupe = await prisma.realtyUser.findFirst({
    where: { accountId: ctx.accountId, email },
    select: { id: true, active: true },
  });
  if (dupe) {
    throw new RealtyAdminError(
      dupe.active
        ? "Ya hay alguien con ese correo en tu equipo."
        : "Ese correo ya estuvo en tu equipo. Reactívalo en vez de darlo de alta otra vez.",
      409,
      "DUPLICATE_EMAIL",
    );
  }

  const officeIds = await resolveOfficeIds(ctx, input.officeIds);

  // 1. Acceso en Supabase Auth.
  const supabase = adminSupabase();
  const password = tempPassword();
  let supabaseId: string | null = null;
  let linkedExistingLogin = false;
  let createdHere = false;

  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { firstName, lastName, realtyAccountName: ctx.account.name },
  });

  if (created?.user) {
    supabaseId = created.user.id;
    createdHere = true;
  } else if (isEmailTakenError(error)) {
    // Ya tiene login DaleControl. generateLink NO manda correo ni cambia
    // nada: solo devuelve al usuario para poder ligarlo.
    const { data: existing } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (!existing?.user?.id) {
      throw new RealtyAdminError(
        "Ese correo ya tiene una cuenta de DaleControl, pero no pudimos ligarla. Escríbenos a soporte.",
        409,
        "LINK_FAILED",
      );
    }
    supabaseId = existing.user.id;
    linkedExistingLogin = true;
  } else {
    throw new RealtyAdminError(error?.message || "No se pudo crear el acceso.", 400, "AUTH_FAILED");
  }

  // 2. Fila del vertical + accesos de oficina, en UNA transacción.
  let row: MemberRaw;
  try {
    row = (await prisma.$transaction(async (tx) => {
      const user = await tx.realtyUser.create({
        data: {
          accountId: ctx.accountId,
          supabaseId: supabaseId as string,
          email,
          firstName,
          lastName,
          role,
          active: true,
          // Nace heredando el rol. Nunca con un override "de arranque".
          permissionsOverride: [],
        },
        select: { id: true },
      });
      if (officeIds.length > 0) {
        await tx.realtyUserOfficeAccess.createMany({
          data: officeIds.map((officeId) => ({
            accountId: ctx.accountId,
            userId: user.id,
            officeId,
          })),
          skipDuplicates: true,
        });
      }
      return (await tx.realtyUser.findUniqueOrThrow({
        where: { id: user.id },
        select: MEMBER_SELECT,
      })) as MemberRaw;
    })) as MemberRaw;
  } catch (err) {
    // Rollback best-effort SOLO del acceso que creamos nosotros: borrar el
    // login de alguien que ya lo tenía lo dejaría fuera del dental.
    if (createdHere && supabaseId) {
      try {
        await supabase.auth.admin.deleteUser(supabaseId);
      } catch {
        /* best-effort */
      }
    }
    throw err;
  }

  return {
    member: toMemberRow(row, ctx),
    tempPassword: linkedExistingLogin ? null : password,
    linkedExistingLogin,
  };
}

// ── Edición ────────────────────────────────────────────────────────────

export interface UpdateMemberInput {
  firstName?: unknown;
  lastName?: unknown;
  role?: unknown;
  active?: unknown;
  publicProfileEnabled?: unknown;
}

/**
 * Edita a un miembro. El CORREO no se toca aquí a propósito: es su identidad
 * de acceso y cambiarlo obliga a mover también la cuenta de Supabase (el
 * dental ya se quemó con eso). Se da de baja y se vuelve a dar de alta.
 */
export async function updateMember(
  ctx: RealtyContext,
  memberId: string,
  input: UpdateMemberInput,
): Promise<RealtyMemberRow> {
  assertRealtyPermission(ctx, "team.manage");
  const member = await loadMember(ctx, memberId);

  const data: Prisma.RealtyUserUpdateInput = {};

  if (input.firstName !== undefined) {
    const v = cleanText(input.firstName, 60);
    if (!v) throw new RealtyAdminError("El nombre es obligatorio.");
    data.firstName = v;
  }
  if (input.lastName !== undefined) {
    const v = cleanText(input.lastName, 60);
    if (!v) throw new RealtyAdminError("El apellido es obligatorio.");
    data.lastName = v;
  }

  if (input.role !== undefined) {
    if (!isRealtyRole(input.role)) throw new RealtyAdminError("Ese rol no existe.");
    assertCanAssignRole(ctx, input.role);
    if (input.role !== member.role) {
      // 🔴 Cambiar de rol LIMPIA el override. Con la semántica de reemplazo,
      // dejar el override viejo significa que el rol nuevo no pinta nada: la
      // persona seguiría con los permisos del rol anterior y la pantalla
      // diría otra cosa. Vuelve a heredar y las excepciones se rehacen.
      const stillAdmin = resolveRealtyPermissions(input.role, []).has("team.manage");
      if (!stillAdmin) {
        await assertNotLastTeamAdmin(ctx.accountId, member, "No puedes cambiarle el rol.");
      }
      // Dejar de ser OWNER es lo que cierra la puerta para siempre.
      await assertNotLastOwner(ctx.accountId, member, "No puedes cambiarle el rol.");
      if (member.id === ctx.realtyUserId && !stillAdmin) {
        throw new RealtyAdminError(
          "No puedes cambiarte el rol a uno que no administra el equipo.",
          409,
          "SELF_LOCKOUT",
        );
      }
      data.role = input.role;
      data.permissionsOverride = [];
    }
  }

  if (input.active !== undefined) {
    const next = input.active === true;
    if (!next) {
      if (member.id === ctx.realtyUserId) {
        throw new RealtyAdminError("No puedes desactivarte a ti mismo.", 409, "SELF_DEACTIVATE");
      }
      await assertNotLastTeamAdmin(ctx.accountId, member, "No puedes desactivarla.");
      await assertNotLastOwner(ctx.accountId, member, "No puedes desactivarla.");
      // Alguien inactivo no puede seguir saliendo en la web pública.
      data.publicProfileEnabled = false;
    } else {
      // Reactivar consume lugar del plan otra vez.
      const seats = await getRealtySeatLimit(ctx);
      if (!member.active && !seats.canInvite) {
        throw new RealtyAdminError(
          `Ya usaste los ${seats.max} lugares de tu plan${
            seats.upgrade ? `; con ${seats.upgrade.name} caben más` : ""
          }.`,
          409,
          "SEAT_LIMIT",
        );
      }
    }
    data.active = next;
  }

  if (input.publicProfileEnabled !== undefined) {
    const next = input.publicProfileEnabled === true;
    if (next && !member.active) {
      throw new RealtyAdminError(
        "Alguien dado de baja no puede aparecer en tu web.",
        409,
        "INACTIVE_PUBLIC",
      );
    }
    data.publicProfileEnabled = next;
  }

  const updated = (await prisma.realtyUser.update({
    where: { id: member.id },
    data,
    select: MEMBER_SELECT,
  })) as MemberRaw;
  return toMemberRow(updated, ctx);
}

/**
 * Guarda el conjunto EFECTIVO de permisos. La pantalla manda el resultado
 * final completo; aquí se traduce a override (o a [] si coincide con el rol).
 *
 * 🔴 NADIE REPARTE LO QUE NO TIENE. Sin este freno, `team.manage` era la
 * llave maestra: un gerente (que NO trae billing.manage) se editaba a sí
 * mismo mandando las 24 claves y salía con la suscripción en la mano. Y un
 * asesor a quien le dieron team.manage como excepción se auto-otorgaba el
 * resto en una sola llamada. Que "solo un dueño nombra a otro dueño" no
 * servía de nada: el atacante no necesitaba el ROL, se llevaba el SET.
 *
 * La regla es simétrica y vale para dar Y para quitar: las claves que el
 * llamante no posee no se pueden mover, ni hacia arriba ni hacia abajo. Así
 * un gerente tampoco puede quitarle la suscripción al dueño.
 */
export async function setMemberPermissions(
  ctx: RealtyContext,
  memberId: string,
  effectiveKeys: unknown,
): Promise<RealtyMemberRow> {
  assertRealtyPermission(ctx, "team.manage");
  const member = await loadMember(ctx, memberId);

  const keys = Array.isArray(effectiveKeys) ? effectiveKeys.filter((k) => typeof k === "string") : [];

  const callerGrants = resolveRealtyPermissions(ctx.role, ctx.user.permissionsOverride);
  const targetNow = resolveRealtyPermissions(member.role, member.permissionsOverride);
  const wanted = new Set<string>(canonicalRealtyPermissions(keys as string[]));

  const outOfReach = REALTY_PERMISSION_KEYS.filter(
    (k) => !callerGrants.has(k) && wanted.has(k) !== targetNow.has(k),
  );
  if (outOfReach.length > 0) {
    const labels = outOfReach
      .map((k) => REALTY_PERMISSIONS.find((p) => p.key === k)?.label ?? k)
      .join(", ");
    throw new RealtyAdminError(
      `No puedes repartir permisos que tú no tienes: ${labels}.`,
      403,
      "PERMISSION_OUT_OF_REACH",
    );
  }

  // Lo que el llamante no posee se queda EXACTAMENTE como estaba.
  const effective = REALTY_PERMISSION_KEYS.filter((k) =>
    callerGrants.has(k) ? wanted.has(k) : targetNow.has(k),
  );
  const override = overrideFromEffective(member.role, effective);

  const willBeAdmin = resolveRealtyPermissions(member.role, override).has("team.manage");
  if (!willBeAdmin) {
    await assertNotLastTeamAdmin(ctx.accountId, member, "No puedes quitarle ese permiso.");
  }
  // Quitarse a uno mismo la llave del equipo es el clásico pie en la puerta.
  if (member.id === ctx.realtyUserId && !willBeAdmin) {
    throw new RealtyAdminError(
      "No puedes quitarte a ti mismo el permiso de administrar el equipo.",
      409,
      "SELF_LOCKOUT",
    );
  }

  const updated = (await prisma.realtyUser.update({
    where: { id: member.id },
    data: { permissionsOverride: override },
    select: MEMBER_SELECT,
  })) as MemberRaw;
  return toMemberRow(updated, ctx);
}

/** Ids de oficina válidos de ESTA cuenta y dentro del alcance de quien pide. */
async function resolveOfficeIds(ctx: RealtyContext, raw: unknown): Promise<string[]> {
  const wanted = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  if (wanted.length === 0) return [];
  const allowed = new Set(await getAccessibleOfficeIds(ctx));
  const rows = await prisma.realtyOffice.findMany({
    where: { accountId: ctx.accountId, id: { in: wanted } },
    select: { id: true },
  });
  const valid = rows.map((r) => r.id).filter((id) => allowed.has(id));
  if (valid.length !== new Set(wanted).size) {
    throw new RealtyAdminError("Alguna de esas oficinas no es tuya.", 404, "OFFICE_NOT_FOUND");
  }
  return valid;
}

/**
 * Reemplaza los accesos de oficina de una persona. OWNER y MANAGER ven
 * TODAS las oficinas por su rol (getAccessibleOfficeIds), así que darles
 * filas no cambia nada — se guardan igual para que degradarlos a AGENT no
 * los deje sin nada de golpe.
 *
 * Exige `offices.manage` y no `team.manage` porque el contrato lo dice así
 * (permissions.ts: "otorgar accesos (RealtyUserOfficeAccess)" cuelga de
 * oficinas). 🔴 Pero la RESPUESTA sí depende de team.manage: la fila
 * completa lleva el correo y la matriz de permisos de esa persona, que es
 * justo lo que listMembers protege. Sin este recorte, alguien con
 * offices.manage y sin team.manage podía leerse el directorio entero de uno
 * en uno llamando a este endpoint.
 */
export async function setMemberOfficeAccess(
  ctx: RealtyContext,
  memberId: string,
  officeIds: unknown,
): Promise<RealtyMemberRow | { id: string; officeIds: string[] }> {
  assertRealtyPermission(ctx, "offices.manage");
  const member = await loadMember(ctx, memberId);
  const ids = await resolveOfficeIds(ctx, officeIds);

  await prisma.$transaction(async (tx) => {
    await tx.realtyUserOfficeAccess.deleteMany({
      where: { userId: member.id, accountId: ctx.accountId },
    });
    if (ids.length > 0) {
      await tx.realtyUserOfficeAccess.createMany({
        data: ids.map((officeId) => ({ accountId: ctx.accountId, userId: member.id, officeId })),
        skipDuplicates: true,
      });
    }
  });

  if (
    !hasRealtyPermission(
      { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
      "team.manage",
    )
  ) {
    return { id: member.id, officeIds: ids };
  }

  const updated = (await prisma.realtyUser.findUniqueOrThrow({
    where: { id: member.id },
    select: MEMBER_SELECT,
  })) as MemberRaw;
  return toMemberRow(updated, ctx);
}

// ── Ficha pública del asesor ───────────────────────────────────────────

export interface AgentProfileInput {
  displayName?: unknown;
  photoUrl?: unknown;
  bio?: unknown;
  zones?: unknown;
  specialties?: unknown;
  credentials?: unknown;
  socials?: unknown;
  publicSlug?: unknown;
  active?: unknown;
}

/** Sub-ruta pública única DENTRO de la cuenta. */
async function resolveAgentSlug(
  accountId: string,
  realtyUserId: string,
  wanted: string,
): Promise<string | null> {
  const base = makeRealtySlug(wanted);
  if (!base || base === "inmobiliaria") return null;
  let slug = base;
  for (let i = 0; i < 6; i++) {
    const clash = await prisma.realtyAgentProfile.findFirst({
      where: { accountId, publicSlug: slug, NOT: { realtyUserId } },
      select: { id: true },
    });
    if (!clash) return slug;
    slug = `${base}-${i + 2}`;
  }
  return null;
}

/**
 * Crea o actualiza la ficha pública. La consume T5 en
 * /i/[slug]/agentes/[agente]; la forma de credentials y socials es el
 * contrato documentado arriba.
 */
export async function saveAgentProfile(
  ctx: RealtyContext,
  memberId: string,
  input: AgentProfileInput,
): Promise<RealtyMemberRow> {
  // Cada quien edita SU ficha; para la de alguien más hace falta team.manage.
  if (memberId !== ctx.realtyUserId) assertRealtyPermission(ctx, "team.manage");
  const member = await loadMember(ctx, memberId);

  const displayName =
    cleanText(input.displayName, 80) || `${member.firstName} ${member.lastName}`.trim();
  const bio = cleanMultiline(input.bio, 2000) || null;
  const zones = cleanList(input.zones, 20);
  const specialties = cleanList(input.specialties, 12);
  const credentials = normalizeCredentials(input.credentials);
  const socials = normalizeSocials(input.socials);
  const photoUrl = cleanUrl(input.photoUrl);
  const active = input.active === undefined ? true : input.active === true;

  const wantedSlug = cleanText(input.publicSlug, 80) || displayName;
  const publicSlug = await resolveAgentSlug(ctx.accountId, member.id, wantedSlug);

  await prisma.realtyAgentProfile.upsert({
    where: { realtyUserId: member.id },
    create: {
      accountId: ctx.accountId,
      realtyUserId: member.id,
      displayName,
      photoUrl,
      bio,
      zones,
      specialties,
      credentials: credentials as unknown as Prisma.InputJsonValue,
      socials: socials as unknown as Prisma.InputJsonValue,
      publicSlug,
      active,
    },
    update: {
      displayName,
      photoUrl,
      bio,
      zones,
      specialties,
      credentials: credentials as unknown as Prisma.InputJsonValue,
      socials: socials as unknown as Prisma.InputJsonValue,
      publicSlug,
      active,
    },
  });

  const updated = (await prisma.realtyUser.findUniqueOrThrow({
    where: { id: member.id },
    select: MEMBER_SELECT,
  })) as MemberRaw;
  return toMemberRow(updated, ctx);
}

// ═══════════════════════════════════════════════════════════════════════
// 🔴 BAJA DE UN ASESOR — la regla de negocio, escrita una sola vez
// ═══════════════════════════════════════════════════════════════════════
//
// Cuando se da de baja a un asesor:
//   1. Sus inmuebles SIGUEN publicados en la web de la inmobiliaria. No se
//      toca isPublished: el inventario es de la casa, no del asesor.
//   2. Quedan SIN asesor asignado (assignedUserId = null) hasta que alguien
//      los reparta. Por eso ese campo es nullable a propósito.
//   3. Su página /i/{slug}/agentes/{agente} se APAGA — pero la fila
//      RealtyAgentProfile SOBREVIVE con su publicSlug, con active=false.
//      🔴 Esto es deliberado y es el contrato con T5: con la fila viva, la
//      ruta pública puede responder 301 a la página de la inmobiliaria y
//      conservar el SEO ganado. Si se borrara, sería un 404 y se tiraría a
//      la basura el posicionamiento de esa URL.
//   4. Los prospectos y contactos que llevaba caen en la BANDEJA GENERAL
//      (assignedUserId = null) o se pasan a quien se elija.
//   5. Sus visitas por venir y sus pendientes se reasignan igual.
//
// Lo que NO se toca:
//   · Las comisiones (RealtyCommissionSplit). El schema lo dice: ahí
//     realtyUserId NULL SIGNIFICA "es de la oficina", así que borrar al
//     asesor convertiría su comisión sin pagar en dinero de la casa, sin
//     aviso. Se sigue debiendo y se sigue viendo en Comisiones.
//   · Las visitas YA realizadas: son historia y su autor no se reescribe.
//   · Las llaves sin devolver: se AVISAN en la pantalla, pero pasarlas a
//     otro sería mentir — el juego sigue físicamente en su bolsa.
//
// Por eso "eliminar" aquí es DESACTIVAR (active = false) y no un DELETE:
// borrar la fila rompería las comisiones (onDelete: NoAction) y dejaría la
// bitácora de prospectos sin autor.

export interface OffboardImpact {
  member: { id: string; fullName: string; email: string; role: RealtyRole; active: boolean };
  properties: number;
  publishedProperties: number;
  leads: number;
  activeLeads: number;
  contacts: number;
  upcomingVisits: number;
  openTasks: number;
  /** Juegos de llaves que se llevó y no ha devuelto. */
  keysOut: number;
  unpaidCommissions: { count: number; amount: number };
  /** Slug público que se va a apagar (T5 responde 301 con la fila viva). */
  publicSlug: string | null;
  visibleOnWeb: boolean;
  /** A quién se le pueden pasar las cosas (activos, menos la propia persona). */
  candidates: { id: string; fullName: string; role: RealtyRole }[];
}

const OPEN_LEAD_STAGES = ["NUEVO", "CONTACTADO", "CALIFICADO", "VISITA", "OFERTA"] as const;

/**
 * El conteo que la pantalla enseña ANTES de confirmar: "este asesor tiene 14
 * inmuebles, 3 visitas agendadas y 7 prospectos activos. ¿A quién se los
 * paso?". Una baja a ciegas es cómo se pierde una cartera.
 */
export async function getOffboardImpact(
  ctx: RealtyContext,
  memberId: string,
): Promise<OffboardImpact> {
  assertRealtyPermission(ctx, "team.manage");
  const member = await loadMember(ctx, memberId);
  const now = new Date();
  const account = ctx.accountId;

  const [
    properties,
    publishedProperties,
    leads,
    activeLeads,
    contacts,
    upcomingVisits,
    openTasks,
    keysOut,
    unpaid,
    candidateRows,
  ] = await Promise.all([
    prisma.realtyProperty.count({ where: { accountId: account, assignedUserId: member.id } }),
    prisma.realtyProperty.count({
      where: { accountId: account, assignedUserId: member.id, isPublished: true },
    }),
    prisma.realtyLead.count({ where: { accountId: account, assignedUserId: member.id } }),
    prisma.realtyLead.count({
      where: { accountId: account, assignedUserId: member.id, stage: { in: [...OPEN_LEAD_STAGES] } },
    }),
    prisma.realtyContact.count({ where: { accountId: account, assignedUserId: member.id } }),
    prisma.realtyVisit.count({
      where: {
        accountId: account,
        userId: member.id,
        OR: [{ scheduledAt: { gte: now } }, { status: { in: ["PROGRAMADA", "CONFIRMADA"] } }],
      },
    }),
    prisma.realtyTask.count({ where: { accountId: account, userId: member.id, done: false } }),
    prisma.realtyKey.count({
      where: { accountId: account, holderUserId: member.id, returnedAt: null },
    }),
    prisma.realtyCommissionSplit.aggregate({
      where: { accountId: account, realtyUserId: member.id, paidAt: null },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.realtyUser.findMany({
      where: { accountId: account, active: true, id: { not: member.id } },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: [{ role: "asc" }, { firstName: "asc" }],
    }),
  ]);

  return {
    member: {
      id: member.id,
      fullName: `${member.firstName} ${member.lastName}`.trim(),
      email: member.email,
      role: member.role,
      active: member.active,
    },
    properties,
    publishedProperties,
    leads,
    activeLeads,
    contacts,
    upcomingVisits,
    openTasks,
    keysOut,
    unpaidCommissions: {
      count: unpaid._count._all,
      amount: unpaid._sum.amount ? Number(unpaid._sum.amount) : 0,
    },
    publicSlug: member.agentProfile?.publicSlug ?? null,
    visibleOnWeb: Boolean(member.agentProfile?.active && member.publicProfileEnabled),
    candidates: candidateRows.map((c) => ({
      id: c.id,
      fullName: `${c.firstName} ${c.lastName}`.trim(),
      role: c.role,
    })),
  };
}

export interface OffboardResult {
  propertiesMoved: number;
  leadsMoved: number;
  contactsMoved: number;
  visitsMoved: number;
  tasksMoved: number;
  reassignedTo: { id: string; fullName: string } | null;
  keysStillOut: number;
  unpaidCommissions: { count: number; amount: number };
  publicSlugRetired: string | null;
}

/**
 * Ejecuta la baja. `reassignToUserId` null = todo cae en la bandeja general
 * (sin asesor), que es una decisión válida y explícita, no un descuido.
 */
export async function offboardMember(
  ctx: RealtyContext,
  memberId: string,
  opts: { reassignToUserId?: string | null } = {},
): Promise<OffboardResult> {
  assertRealtyPermission(ctx, "team.manage");
  const member = await loadMember(ctx, memberId);

  if (member.id === ctx.realtyUserId) {
    throw new RealtyAdminError("No puedes darte de baja a ti mismo.", 409, "SELF_OFFBOARD");
  }
  await assertNotLastTeamAdmin(ctx.accountId, member, "No puedes darla de baja.");
  await assertNotLastOwner(ctx.accountId, member, "No puedes darla de baja.");

  let target: { id: string; firstName: string; lastName: string } | null = null;
  if (opts.reassignToUserId) {
    target = await prisma.realtyUser.findFirst({
      where: { id: opts.reassignToUserId, accountId: ctx.accountId, active: true },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!target) {
      throw new RealtyAdminError(
        "La persona a la que quieres pasarle la cartera no está activa en tu cuenta.",
        404,
        "TARGET_NOT_FOUND",
      );
    }
    if (target.id === member.id) {
      throw new RealtyAdminError("No puedes pasarle su cartera a la misma persona.", 400);
    }
  }

  const newOwner = target ? target.id : null;
  const now = new Date();
  const account = ctx.accountId;
  const impact = await getOffboardImpact(ctx, memberId);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Inmuebles: cambian de asesor, NO de publicación ni de estatus.
    const properties = await tx.realtyProperty.updateMany({
      where: { accountId: account, assignedUserId: member.id },
      data: { assignedUserId: newOwner },
    });

    // 2. Prospectos: los que iban a la bandeja general pierden también su
    //    assignedAt — si no, el tablero diría que llevan asignados desde que
    //    los tomó alguien que ya no está.
    const leadIds = (
      await tx.realtyLead.findMany({
        where: { accountId: account, assignedUserId: member.id },
        select: { id: true },
      })
    ).map((l) => l.id);

    const leads = await tx.realtyLead.updateMany({
      where: { accountId: account, assignedUserId: member.id },
      data: newOwner
        ? { assignedUserId: newOwner, assignedAt: now }
        : { assignedUserId: null, assignedAt: null },
    });

    // Rastro en la bitácora del prospecto: quién dejó de llevarlo y a dónde
    // se fue. Sin esto, mañana nadie sabe por qué cambió de manos.
    if (leadIds.length > 0) {
      const note = newOwner
        ? `Baja de ${member.firstName} ${member.lastName}: el prospecto pasa a ${target?.firstName} ${target?.lastName}.`
        : `Baja de ${member.firstName} ${member.lastName}: el prospecto queda en la bandeja general, sin asesor.`;
      await tx.realtyLeadActivity.createMany({
        data: leadIds.map((leadId) => ({
          accountId: account,
          leadId,
          kind: "ASIGNACION" as const,
          note,
          userId: ctx.realtyUserId,
          createdAt: now,
        })),
      });
    }

    const contacts = await tx.realtyContact.updateMany({
      where: { accountId: account, assignedUserId: member.id },
      data: { assignedUserId: newOwner },
    });

    // 3. Visitas POR VENIR. Las ya realizadas conservan a quien las enseñó.
    const visits = await tx.realtyVisit.updateMany({
      where: {
        accountId: account,
        userId: member.id,
        OR: [{ scheduledAt: { gte: now } }, { status: { in: ["PROGRAMADA", "CONFIRMADA"] } }],
      },
      data: { userId: newOwner },
    });

    // 4. Pendientes abiertos. RealtyTask.userId es NOT NULL: sin destinatario
    //    se quedan con la persona dada de baja (siguen existiendo, no se
    //    borran) y la pantalla lo dice.
    let tasksMoved = 0;
    if (newOwner) {
      const tasks = await tx.realtyTask.updateMany({
        where: { accountId: account, userId: member.id, done: false },
        data: { userId: newOwner },
      });
      tasksMoved = tasks.count;
    }

    // 5. La persona sale del panel y de la web.
    await tx.realtyUser.update({
      where: { id: member.id },
      data: { active: false, publicProfileEnabled: false },
    });

    // 6. La ficha se APAGA pero la fila SOBREVIVE: es lo que le permite a la
    //    web pública responder 301 en vez de 404 (ver la nota de arriba).
    if (member.agentProfile) {
      await tx.realtyAgentProfile.update({
        where: { realtyUserId: member.id },
        data: { active: false },
      });
    }

    return {
      propertiesMoved: properties.count,
      leadsMoved: leads.count,
      contactsMoved: contacts.count,
      visitsMoved: visits.count,
      tasksMoved,
    };
  });

  return {
    ...result,
    reassignedTo: target ? { id: target.id, fullName: `${target.firstName} ${target.lastName}`.trim() } : null,
    keysStillOut: impact.keysOut,
    unpaidCommissions: impact.unpaidCommissions,
    publicSlugRetired: impact.publicSlug,
  };
}

/** Contexto completo de la pantalla de Equipo. */
export interface RealtyTeamContext {
  members: RealtyMemberRow[];
  seats: RealtySeatLimit;
  /** true = el plan permite la página pública por asesor. */
  agentPagesEnabled: boolean;
  /** true = el plan permite más de una oficina. */
  multiOfficeEnabled: boolean;
  /** Solo un dueño nombra a otro dueño. */
  canAssignOwner: boolean;
  /**
   * Los permisos que tiene QUIEN MIRA la pantalla. La matriz apaga los
   * interruptores de las claves que no están aquí, porque el servidor los va
   * a rechazar de todas formas (ver setMemberPermissions): más vale un
   * candado visible que un error después de guardar.
   */
  selfEffective: RealtyPermissionKey[];
}

export async function getTeamContext(ctx: RealtyContext): Promise<RealtyTeamContext> {
  const [members, seats] = await Promise.all([listMembers(ctx), getRealtySeatLimit(ctx)]);
  const own = resolveRealtyPermissions(ctx.role, ctx.user.permissionsOverride);
  return {
    members,
    seats,
    agentPagesEnabled: ctx.plan.features.agentPages === true,
    multiOfficeEnabled: ctx.plan.features.multiOffice === true,
    canAssignOwner: ctx.role === "OWNER",
    selfEffective: REALTY_PERMISSION_KEYS.filter((k) => own.has(k)),
  };
}
