// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES — CRM de prospectos (embudo, bitácora, asignación
// automática, tareas y el puente al motor de match).
//
// Módulo de SERVIDOR (importa prisma). Ningún componente "use client" puede
// importarlo: los helpers puros de UI viven en
// src/components/realty/leads/lead-ui.ts y el motor de match, que sí es
// puro, en src/lib/realty/matching.ts.
//
// 🔴 accountId SIEMPRE sale de getRealtyContext(). Toda función de aquí lo
// recibe como primer argumento y JAMÁS lo lee de un body. Ojo Prisma: un
// accountId undefined BORRA el filtro — por eso `assertAccountId` truena
// antes de tocar la base en vez de devolver los prospectos de todo México.
//
// ── EL DATO QUE JUSTIFICA ESTE ARCHIVO ─────────────────────────────────
// Se pierde entre el 70% y el 85% de los prospectos por mal seguimiento, y
// pasados 10 minutos la probabilidad de contactarlo cae ~80%. Por eso:
//   · cada prospecto trae CUÁNTO LLEVA SIN CONTACTO (semáforo), y
//   · si el asesor no marca contacto en N minutos, el prospecto se
//     REASIGNA solo al siguiente de la rotación y queda en la bitácora.
//
// ── DÓNDE VIVE LA CONFIGURACIÓN DE RUTEO (deuda técnica declarada) ──────
// El schema de la Ola 0 NO tiene tabla ni columna para las reglas de
// asignación por cuenta. Esta terminal NO puede tocar prisma/schema.prisma
// (regla dura de la ola), así que la configuración se guarda como un evento
// en `realty_admin_actions` con `action = REALTY_ROUTING_ACTION`, que es la
// ÚNICA tabla del vertical con accountId + payload Json libre.
//
// Es deuda consciente, no un descuido. Lo que la hace tolerable:
//   1. La llave `action` está RESERVADA (ver REALTY_RESERVED_ACTIONS) y hoy
//      nadie más escribe esa tabla — verificado con grep en la Ola 1.
//   2. La lectura NO confía en la recencia a secas: recorre las últimas N
//      filas y se queda con la primera que PARSEA a una config válida. Un
//      segundo escritor de la misma llave envenena la fila más nueva, no la
//      lectura entera (lección de AuditLog/prorrateo del dental).
//   3. Migrarla a una columna real es copiar el objeto tal cual.
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mxTenDigits } from "@/lib/phone-mx";
import {
  canTransition,
  isTerminalLeadStage,
  REALTY_LOST_REASONS,
  type RealtyContactKind,
  type RealtyCreditKind,
  type RealtyLeadActivityKind,
  type RealtyLeadStage,
  type RealtyOperation,
  type RealtyPropertyKind,
  type RealtyRole,
} from "@/lib/realty/types";
import { resolveRealtyPermissions } from "@/lib/realty/permissions";
import {
  matchPropertiesForSeeker,
  matchSeekersForProperty,
  readSearchProfileKinds,
  REALTY_MATCH_DEFAULT_TOLERANCE_PCT,
  type RealtyMatchOptions,
  type RealtyMatchProperty,
  type RealtyMatchSeeker,
  type RealtyPropertyMatchDTO,
  type RealtySeekerMatchDTO,
} from "@/lib/realty/matching";

// ── Guardas ─────────────────────────────────────────────────────────────

/**
 * Un accountId vacío/undefined en un `where` de Prisma no filtra: DEVUELVE
 * TODO. Cortar aquí convierte un bug de aislamiento en un error ruidoso.
 */
export function assertAccountId(accountId: string): string {
  if (!accountId || typeof accountId !== "string") {
    throw new Error("realty/leads: accountId ausente — la consulta habría cruzado cuentas");
  }
  return accountId;
}

function num(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : Number(v);
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// ═══════════════════════════════════════════════════════════════════════
// 1. CONFIGURACIÓN DE ASIGNACIÓN AUTOMÁTICA
// ═══════════════════════════════════════════════════════════════════════

/** Llaves RESERVADAS de realty_admin_actions que escribe ESTA terminal.
 *  Quien agregue una llave nueva la registra aquí para que se vea el choque
 *  antes de que envenene una lectura. */
export const REALTY_RESERVED_ACTIONS = {
  routing: "realty.leadRouting",
  inboundMail: "realty.inboundMail",
} as const;

export const REALTY_ROUTING_ACTION = REALTY_RESERVED_ACTIONS.routing;

export type RealtyRoutingStrategy = "MANUAL" | "ROTACION" | "ZONA" | "TURNO";

export const REALTY_ROUTING_STRATEGIES: RealtyRoutingStrategy[] = [
  "MANUAL",
  "ROTACION",
  "ZONA",
  "TURNO",
];

/** Una franja de guardia: días de la semana (0 = domingo) y horario local. */
export interface RealtyRoutingShift {
  days: number[];
  /** "HH:MM" en 24 h, hora local de la cuenta. */
  from: string;
  to: string;
}

export interface RealtyLeadRoutingConfig {
  strategy: RealtyRoutingStrategy;
  /** 🔴 La joya: reasignar por NO-RESPUESTA. */
  reassignEnabled: boolean;
  /** Minutos sin marcar contacto antes de pasarlo al siguiente. */
  reassignAfterMinutes: number;
  /** Cuántas veces se puede rebotar un mismo prospecto. Evita el ping-pong. */
  reassignMaxHops: number;
  /** Quién entra al reparto. Vacío = todo el que pueda trabajar prospectos. */
  poolUserIds: string[];
  /** ZONA: texto de zona → asesores. Se siembra de RealtyAgentProfile.zones. */
  zoneOverrides: Record<string, string[]>;
  /** TURNO: userId → franjas de guardia. */
  shifts: Record<string, RealtyRoutingShift[]>;
  /** Tolerancia del presupuesto en el match, en porcentaje. */
  matchTolerancePct: number;
  updatedAt: string | null;
  updatedByUserId: string | null;
}

export const REALTY_ROUTING_DEFAULTS: RealtyLeadRoutingConfig = {
  strategy: "ROTACION",
  reassignEnabled: true,
  // 15 min: pasados 10 la probabilidad de contacto ya cayó ~80%. Se deja un
  // colchón para que el asesor alcance a marcar sin que el rebote sea injusto.
  reassignAfterMinutes: 15,
  reassignMaxHops: 3,
  poolUserIds: [],
  zoneOverrides: {},
  shifts: {},
  matchTolerancePct: REALTY_MATCH_DEFAULT_TOLERANCE_PCT,
  updatedAt: null,
  updatedByUserId: null,
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseShifts(raw: unknown): Record<string, RealtyRoutingShift[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, RealtyRoutingShift[]> = {};
  for (const [userId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const franjas: RealtyRoutingShift[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const days = Array.isArray(o.days)
        ? o.days.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6)
        : [];
      const from = typeof o.from === "string" && HHMM.test(o.from) ? o.from : null;
      const to = typeof o.to === "string" && HHMM.test(o.to) ? o.to : null;
      if (days.length > 0 && from && to) franjas.push({ days, from, to });
    }
    if (franjas.length > 0) out[userId] = franjas;
  }
  return out;
}

function parseZoneOverrides(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [zone, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!zone.trim()) continue;
    const ids = Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
      : [];
    if (ids.length > 0) out[zone.trim()] = ids;
  }
  return out;
}

/**
 * Valida un payload crudo → config. Devuelve null si NO parece una config
 * (así la lectura puede saltarse una fila envenenada por otro escritor en
 * vez de devolver basura tipada).
 */
export function parseRoutingConfig(raw: unknown): RealtyLeadRoutingConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const strategy = o.strategy;
  if (typeof strategy !== "string" || !REALTY_ROUTING_STRATEGIES.includes(strategy as RealtyRoutingStrategy)) {
    return null;
  }
  const minutes = Number(o.reassignAfterMinutes);
  const hops = Number(o.reassignMaxHops);
  const tol = Number(o.matchTolerancePct);
  return {
    strategy: strategy as RealtyRoutingStrategy,
    reassignEnabled: o.reassignEnabled !== false,
    reassignAfterMinutes:
      Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440
        ? Math.round(minutes)
        : REALTY_ROUTING_DEFAULTS.reassignAfterMinutes,
    reassignMaxHops:
      Number.isFinite(hops) && hops >= 0 && hops <= 10
        ? Math.round(hops)
        : REALTY_ROUTING_DEFAULTS.reassignMaxHops,
    poolUserIds: Array.isArray(o.poolUserIds)
      ? o.poolUserIds.filter((v): v is string => typeof v === "string" && v.length > 0)
      : [],
    zoneOverrides: parseZoneOverrides(o.zoneOverrides),
    shifts: parseShifts(o.shifts),
    matchTolerancePct:
      Number.isFinite(tol) && tol >= 0 && tol <= 50 ? Math.round(tol) : REALTY_MATCH_DEFAULT_TOLERANCE_PCT,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : null,
    updatedByUserId: typeof o.updatedByUserId === "string" ? o.updatedByUserId : null,
  };
}

/** Cuántas filas se recorren hacia atrás buscando una config válida. */
const ROUTING_SCAN_DEPTH = 20;

/**
 * Config de ruteo de la cuenta. Si nunca se guardó, devuelve los defaults.
 *
 * NO toma la fila más nueva a ciegas (ver cabecera): recorre hacia atrás y
 * se queda con la PRIMERA que parsea.
 */
export async function getLeadRoutingConfig(
  accountId: string,
): Promise<RealtyLeadRoutingConfig> {
  assertAccountId(accountId);
  const rows = await prisma.realtyAdminAction.findMany({
    where: { accountId, action: REALTY_ROUTING_ACTION },
    orderBy: { createdAt: "desc" },
    take: ROUTING_SCAN_DEPTH,
    select: { payload: true },
  });
  for (const row of rows) {
    const parsed = parseRoutingConfig(row.payload);
    if (parsed) return parsed;
  }
  return { ...REALTY_ROUTING_DEFAULTS };
}

/** Guarda la config (append-only: queda el histórico de quién la cambió). */
export async function saveLeadRoutingConfig(
  accountId: string,
  patch: Partial<RealtyLeadRoutingConfig>,
  byRealtyUserId: string | null,
): Promise<RealtyLeadRoutingConfig> {
  assertAccountId(accountId);
  const current = await getLeadRoutingConfig(accountId);
  const merged = parseRoutingConfig({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
    updatedByUserId: byRealtyUserId,
  });
  if (!merged) throw new Error("realty/leads: configuración de asignación inválida");

  await prisma.realtyAdminAction.create({
    data: {
      accountId,
      // adminUserId queda NULL A PROPÓSITO: esa columna es para el admin de
      // DaleControl y un RealtyUser.id ahí sería un id de otro espacio. El
      // autor real va dentro del payload.
      adminUserId: null,
      action: REALTY_ROUTING_ACTION,
      payload: merged as unknown as Prisma.InputJsonValue,
    },
  });
  return merged;
}

// ═══════════════════════════════════════════════════════════════════════
// 2. CANDIDATOS Y ELECCIÓN DE ASESOR
// ═══════════════════════════════════════════════════════════════════════

export interface RealtyAssigneeCandidate {
  id: string;
  name: string;
  role: RealtyRole;
  zones: string[];
  /** Último prospecto que se le asignó. null = nunca le ha tocado uno. */
  lastAssignedAt: Date | null;
  /** Prospectos vivos (no terminales) que ya trae encima. */
  openLeads: number;
}

function fullName(u: { firstName: string; lastName: string }): string {
  return `${u.firstName} ${u.lastName}`.trim();
}

/**
 * Quién puede recibir prospectos: usuarios ACTIVOS de la cuenta cuyo set
 * efectivo de permisos incluye leads.edit. Si la config declara un pool, se
 * recorta a él (ignorando ids que ya no existan o estén inactivos).
 *
 * En modo AGENT hay un solo usuario y esto devuelve ese uno: la asignación
 * automática sigue existiendo, simplemente siempre acierta.
 */
export async function getAssigneeCandidates(
  accountId: string,
  config?: RealtyLeadRoutingConfig,
): Promise<RealtyAssigneeCandidate[]> {
  assertAccountId(accountId);
  const cfg = config ?? (await getLeadRoutingConfig(accountId));

  const users = await prisma.realtyUser.findMany({
    where: { accountId, active: true },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      permissionsOverride: true,
      agentProfile: { select: { zones: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const pool = new Set(cfg.poolUserIds);
  const eligible = users.filter((u) => {
    if (!resolveRealtyPermissions(u.role, u.permissionsOverride).has("leads.edit")) return false;
    if (pool.size > 0 && !pool.has(u.id)) return false;
    return true;
  });
  if (eligible.length === 0) return [];

  const ids = eligible.map((u) => u.id);
  const [lastAssigned, openCounts] = await Promise.all([
    prisma.realtyLead.groupBy({
      by: ["assignedUserId"],
      where: { accountId, assignedUserId: { in: ids } },
      _max: { assignedAt: true },
    }),
    prisma.realtyLead.groupBy({
      by: ["assignedUserId"],
      where: {
        accountId,
        assignedUserId: { in: ids },
        stage: { notIn: ["CIERRE", "PERDIDO"] },
      },
      _count: { _all: true },
    }),
  ]);

  const lastMap = new Map<string, Date | null>();
  for (const r of lastAssigned) {
    if (r.assignedUserId) lastMap.set(r.assignedUserId, r._max.assignedAt ?? null);
  }
  const openMap = new Map<string, number>();
  for (const r of openCounts) {
    if (r.assignedUserId) openMap.set(r.assignedUserId, r._count._all);
  }

  return eligible.map((u) => ({
    id: u.id,
    name: fullName(u),
    role: u.role,
    zones: u.agentProfile?.zones ?? [],
    lastAssignedAt: lastMap.get(u.id) ?? null,
    openLeads: openMap.get(u.id) ?? 0,
  }));
}

/**
 * Rotación EQUITATIVA sin columna de cursor: gana quien lleva más tiempo
 * sin recibir uno (null = nunca), y a empate quien menos prospectos vivos
 * trae. El id desempata al final para que la elección sea determinista
 * (si no, dos peticiones simultáneas eligen distinto y el reparto baila).
 */
function pickByRotation(
  candidates: RealtyAssigneeCandidate[],
): RealtyAssigneeCandidate | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const ta = a.lastAssignedAt ? a.lastAssignedAt.getTime() : -1;
    const tb = b.lastAssignedAt ? b.lastAssignedAt.getTime() : -1;
    if (ta !== tb) return ta - tb;
    if (a.openLeads !== b.openLeads) return a.openLeads - b.openLeads;
    return a.id.localeCompare(b.id);
  })[0];
}

/** Minutos desde medianoche de "HH:MM". */
function hhmmToMinutes(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}

/**
 * ¿Está de guardia AHORA? Se evalúa en la zona horaria de la CUENTA, no en
 * la del servidor: Vercel corre en UTC y con la hora del servidor el turno
 * de la tarde en Guadalajara caería de madrugada.
 */
export function isOnShift(
  shifts: RealtyRoutingShift[],
  now: Date,
  timeZone: string,
): boolean {
  if (shifts.length === 0) return false;
  let weekday: number;
  let minutes: number;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const table: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    weekday = table[wd] ?? 0;
    // "24" es lo que devuelve hour12:false a medianoche en algunos runtimes.
    minutes = (hh === 24 ? 0 : hh) * 60 + mm;
  } catch {
    weekday = now.getUTCDay();
    minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  }

  for (const shift of shifts) {
    if (!shift.days.includes(weekday)) continue;
    const from = hhmmToMinutes(shift.from);
    const to = hhmmToMinutes(shift.to);
    // Turno que cruza la medianoche (22:00 → 02:00).
    if (from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to) {
      return true;
    }
  }
  return false;
}

export interface RealtyRoutingTarget {
  /** Zonas del prospecto (perfil de búsqueda o ubicación del inmueble). */
  zones: string[];
}

export interface RealtyPickResult {
  userId: string | null;
  /** Por qué se eligió — se escribe tal cual en la bitácora. */
  reason: string;
  strategy: RealtyRoutingStrategy;
}

/**
 * Elige asesor según la estrategia de la cuenta.
 *
 * TODA estrategia cae de vuelta a ROTACIÓN cuando no encuentra a nadie: un
 * prospecto SIN asignar es un prospecto que nadie contesta, y ese es
 * exactamente el problema que este archivo existe para resolver. Preferimos
 * un asesor imperfecto a un prospecto huérfano.
 */
export function pickAssignee(
  candidates: RealtyAssigneeCandidate[],
  config: RealtyLeadRoutingConfig,
  target: RealtyRoutingTarget,
  now: Date,
  timeZone: string,
  excludeUserIds: string[] = [],
): RealtyPickResult {
  const exclude = new Set(excludeUserIds);
  const pool = candidates.filter((c) => !exclude.has(c.id));
  const fallbackPool = pool.length > 0 ? pool : candidates;

  if (config.strategy === "MANUAL") {
    return { userId: null, strategy: "MANUAL", reason: "Reparto manual: queda sin asignar" };
  }

  if (config.strategy === "ZONA") {
    const wanted = target.zones.map((z) => z.trim().toLowerCase()).filter(Boolean);
    if (wanted.length > 0) {
      // 1) Overrides explícitos de la cuenta.
      const overrideIds = new Set<string>();
      for (const [zone, ids] of Object.entries(config.zoneOverrides)) {
        const z = zone.trim().toLowerCase();
        if (wanted.some((w) => w.includes(z) || z.includes(w))) ids.forEach((id) => overrideIds.add(id));
      }
      const byOverride = pool.filter((c) => overrideIds.has(c.id));
      if (byOverride.length > 0) {
        const picked = pickByRotation(byOverride);
        if (picked) {
          return {
            userId: picked.id,
            strategy: "ZONA",
            reason: `Por zona (regla de la cuenta): ${target.zones[0]}`,
          };
        }
      }
      // 2) Zonas declaradas en la ficha del asesor.
      const byProfile = pool.filter((c) =>
        c.zones.some((z) => {
          const cz = z.trim().toLowerCase();
          return cz && wanted.some((w) => w.includes(cz) || cz.includes(w));
        }),
      );
      if (byProfile.length > 0) {
        const picked = pickByRotation(byProfile);
        if (picked) {
          return {
            userId: picked.id,
            strategy: "ZONA",
            reason: `Por zona (ficha del asesor): ${target.zones[0]}`,
          };
        }
      }
    }
    const picked = pickByRotation(fallbackPool);
    return {
      userId: picked?.id ?? null,
      strategy: "ZONA",
      reason: picked
        ? "Sin asesor para esa zona: se repartió por rotación"
        : "Sin asesores disponibles",
    };
  }

  if (config.strategy === "TURNO") {
    const onShift = pool.filter((c) => isOnShift(config.shifts[c.id] ?? [], now, timeZone));
    if (onShift.length > 0) {
      const picked = pickByRotation(onShift);
      if (picked) {
        return { userId: picked.id, strategy: "TURNO", reason: "Estaba de guardia" };
      }
    }
    const picked = pickByRotation(fallbackPool);
    return {
      userId: picked?.id ?? null,
      strategy: "TURNO",
      reason: picked ? "Nadie de guardia: se repartió por rotación" : "Sin asesores disponibles",
    };
  }

  const picked = pickByRotation(fallbackPool);
  return {
    userId: picked?.id ?? null,
    strategy: "ROTACION",
    reason: picked ? "Rotación equitativa" : "Sin asesores disponibles",
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 3. BITÁCORA
// ═══════════════════════════════════════════════════════════════════════

/** Actividades que cuentan como CONTACTO real con el prospecto. Una nota
 *  interna o un cambio de etapa NO apagan el semáforo: apuntar algo no es
 *  haberle hablado. */
export const REALTY_CONTACT_ACTIVITY_KINDS: RealtyLeadActivityKind[] = [
  "LLAMADA",
  "WHATSAPP",
  "CORREO",
  "VISITA",
];

/** Marca que distingue una reasignación AUTOMÁTICA de una a mano. */
export const REALTY_AUTO_MARK = "[auto]";

export async function logLeadActivity(
  accountId: string,
  leadId: string,
  kind: RealtyLeadActivityKind,
  note: string | null,
  userId: string | null,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  assertAccountId(accountId);
  await tx.realtyLeadActivity.create({
    data: { accountId, leadId, kind, note, userId },
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 4. LECTURA DEL EMBUDO
// ═══════════════════════════════════════════════════════════════════════

export interface RealtyLeadCardDTO {
  id: string;
  stage: RealtyLeadStage;
  lostReason: string | null;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  propertyId: string | null;
  propertyTitle: string | null;
  portal: string | null;
  source: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  creditKind: RealtyCreditKind;
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedAt: string | null;
  firstResponseAt: string | null;
  /** Última LLAMADA/WHATSAPP/CORREO/VISITA registrada. null = nunca. */
  lastContactAt: string | null;
  /** Qué busca, en una línea, para la tarjeta del tablero. */
  wants: string | null;
  createdAt: string;
}

export interface RealtyLeadFilters {
  stage?: RealtyLeadStage | null;
  assignedUserId?: string | null;
  /** "SIN_ASIGNAR" para los huérfanos. */
  unassigned?: boolean;
  source?: string | null;
  creditKind?: RealtyCreditKind | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  /** Antigüedad máxima en días desde que entró. */
  maxAgeDays?: number | null;
  /** Solo los que nunca han recibido contacto. */
  onlyUncontacted?: boolean;
  search?: string | null;
}

export interface RealtyLeadScope {
  role: RealtyRole;
  realtyUserId: string;
  permissionsOverride: string[];
}

/**
 * Alcance de lectura. El PERMISO ya dio la puerta (leads.view); esto decide
 * CUÁNTO ve dentro:
 *   · quien puede asignar (OWNER/MANAGER) ve todo el embudo;
 *   · un ASSISTANT es la mesa de control y también ve todo (si no, no puede
 *     repartir ni agendar por nadie);
 *   · un AGENT ve LO SUYO más lo que está sin asignar — para que pueda
 *     levantar un huérfano, que es justo lo que evita perderlo.
 */
export function leadScopeWhere(scope: RealtyLeadScope): Prisma.RealtyLeadWhereInput {
  if (scope.role !== "AGENT") return {};
  const perms = resolveRealtyPermissions(scope.role, scope.permissionsOverride);
  if (perms.has("leads.assign")) return {};
  return {
    OR: [{ assignedUserId: scope.realtyUserId }, { assignedUserId: null }],
  };
}

/**
 * Alcance de la LIBRETA DE CONTACTOS, coherente con el del embudo. Un AGENT
 * sin leads.assign ve: los contactos que tiene asignados, los que traen al
 * menos un prospecto suyo (o sin asesor), y los que todavía no tienen
 * ningún prospecto (fichas sueltas de la libreta).
 *
 * Sin esto, /api/realty/contacts servía por la puerta de atrás el nombre,
 * el teléfono y el correo de TODA la cartera de la agencia — justo el dato
 * que listLeads recorta por la principal.
 */
/**
 * Alcance de ESCRITURA de la libreta. Más estricto que el de lectura A
 * PROPÓSITO: leer la libreta compartida evita que tres asesores den de alta
 * a la misma persona; EDITARLA es otra cosa. Sin esta versión, un asesor
 * podía reescribir el nombre, las notas y —lo peligroso— el TELÉFONO de un
 * contacto ajeno sin prospectos: ese teléfono es la llave con la que se
 * deduplica y con la que el inbox liga el hilo de WhatsApp.
 *
 * Aquí NO entra la rama de "contactos sin ningún prospecto".
 */
export function contactWriteScopeWhere(scope: RealtyLeadScope): Prisma.RealtyContactWhereInput {
  if (scope.role !== "AGENT") return {};
  if (resolveRealtyPermissions(scope.role, scope.permissionsOverride).has("leads.assign")) return {};
  return {
    OR: [
      { assignedUserId: scope.realtyUserId },
      {
        leads: {
          some: { OR: [{ assignedUserId: scope.realtyUserId }, { assignedUserId: null }] },
        },
      },
    ],
  };
}

export function contactScopeWhere(scope: RealtyLeadScope): Prisma.RealtyContactWhereInput {
  if (scope.role !== "AGENT") return {};
  if (resolveRealtyPermissions(scope.role, scope.permissionsOverride).has("leads.assign")) return {};
  return {
    OR: [
      { assignedUserId: scope.realtyUserId },
      {
        leads: {
          some: { OR: [{ assignedUserId: scope.realtyUserId }, { assignedUserId: null }] },
        },
      },
      { leads: { none: {} } },
    ],
  };
}

function filtersToWhere(
  accountId: string,
  filters: RealtyLeadFilters,
  scope: RealtyLeadScope,
): Prisma.RealtyLeadWhereInput {
  assertAccountId(accountId);
  const and: Prisma.RealtyLeadWhereInput[] = [{ accountId }, leadScopeWhere(scope)];

  if (filters.stage) and.push({ stage: filters.stage });
  if (filters.unassigned) and.push({ assignedUserId: null });
  else if (filters.assignedUserId) and.push({ assignedUserId: filters.assignedUserId });
  if (filters.creditKind) and.push({ creditKind: filters.creditKind });
  if (filters.onlyUncontacted) and.push({ firstResponseAt: null });

  if (filters.source) {
    // El origen vive en DOS lados: `portal` del lead (lo pone la captura por
    // correo) y `source` del contacto (lo pone quien lo dio de alta a mano).
    and.push({
      OR: [{ portal: filters.source }, { contact: { source: filters.source } }],
    });
  }

  // Presupuesto: se cruza por SOLAPE de rangos, no por contención. Alguien
  // que busca entre 1 y 3 M sí entra en el filtro "de 2 a 4 M".
  if (filters.budgetMin != null) {
    and.push({ OR: [{ budgetMax: { gte: filters.budgetMin } }, { budgetMax: null }] });
  }
  if (filters.budgetMax != null) {
    and.push({ OR: [{ budgetMin: { lte: filters.budgetMax } }, { budgetMin: null }] });
  }

  if (filters.maxAgeDays != null && filters.maxAgeDays > 0) {
    const since = new Date(Date.now() - filters.maxAgeDays * 86_400_000);
    and.push({ createdAt: { gte: since } });
  }

  const search = filters.search?.trim();
  if (search) {
    const digits = mxTenDigits(search);
    const or: Prisma.RealtyLeadWhereInput[] = [
      { contact: { name: { contains: search, mode: "insensitive" } } },
      { contact: { email: { contains: search, mode: "insensitive" } } },
    ];
    // El teléfono está NORMALIZADO a 10 dígitos en la BD: buscar "33 1234
    // 5678" tal cual no compara nada. Se normaliza antes de comparar.
    if (digits) or.push({ contact: { phone: digits } });
    else if (/^\d{3,}$/.test(search)) or.push({ contact: { phone: { contains: search } } });
    and.push({ OR: or });
  }

  return { AND: and };
}

const LEAD_CARD_SELECT = {
  id: true,
  stage: true,
  lostReason: true,
  contactId: true,
  propertyId: true,
  portal: true,
  budgetMin: true,
  budgetMax: true,
  creditKind: true,
  assignedUserId: true,
  assignedAt: true,
  firstResponseAt: true,
  createdAt: true,
  contact: { select: { name: true, phone: true, email: true, source: true } },
  property: { select: { title: true } },
  assignedUser: { select: { firstName: true, lastName: true } },
} satisfies Prisma.RealtyLeadSelect;

type LeadCardRow = Prisma.RealtyLeadGetPayload<{ select: typeof LEAD_CARD_SELECT }>;

function toLeadCard(row: LeadCardRow, lastContactAt: Date | null, wants: string | null): RealtyLeadCardDTO {
  return {
    id: row.id,
    stage: row.stage,
    lostReason: row.lostReason,
    contactId: row.contactId,
    contactName: row.contact.name,
    contactPhone: row.contact.phone,
    contactEmail: row.contact.email,
    propertyId: row.propertyId,
    propertyTitle: row.property?.title ?? null,
    portal: row.portal,
    source: row.contact.source,
    budgetMin: num(row.budgetMin),
    budgetMax: num(row.budgetMax),
    creditKind: row.creditKind,
    assignedUserId: row.assignedUserId,
    assignedUserName: row.assignedUser ? fullName(row.assignedUser) : null,
    assignedAt: iso(row.assignedAt),
    firstResponseAt: iso(row.firstResponseAt),
    lastContactAt: iso(lastContactAt),
    wants,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Frase corta de "qué busca" a partir del perfil de búsqueda. */
function wantsLine(profile: {
  operation: RealtyOperation;
  kinds: Prisma.JsonValue;
  zones: string[];
  bedroomsMin: number | null;
} | null): string | null {
  if (!profile) return null;
  const kinds = readSearchProfileKinds(profile.kinds);
  const partes: string[] = [];
  if (kinds.length > 0) {
    const labels: Record<RealtyPropertyKind, string> = {
      CASA: "Casa",
      DEPARTAMENTO: "Depa",
      TERRENO: "Terreno",
      BODEGA: "Bodega",
      LOCAL: "Local",
      EDIFICIO: "Edificio",
      OFICINA: "Oficina",
      RANCHO: "Rancho",
    };
    partes.push(kinds.slice(0, 2).map((k) => labels[k]).join(" o "));
  }
  if (profile.bedroomsMin) partes.push(`${profile.bedroomsMin}+ recámaras`);
  if (profile.zones.length > 0) partes.push(`en ${profile.zones.slice(0, 2).join(", ")}`);
  if (partes.length === 0) {
    return profile.operation === "RENTA" ? "Busca renta" : "Busca compra";
  }
  return partes.join(" · ");
}

export const REALTY_LEADS_PAGE_SIZE = 400;

/**
 * Lista del embudo. Devuelve TODO lo que pasa el filtro (topeado) porque el
 * tablero kanban agrupa en el cliente: paginar por columna haría que
 * "arrastrar de CALIFICADO a VISITA" moviera una tarjeta que no está en la
 * página siguiente.
 */
export async function listLeads(
  accountId: string,
  filters: RealtyLeadFilters,
  scope: RealtyLeadScope,
  limit: number = REALTY_LEADS_PAGE_SIZE,
): Promise<{ leads: RealtyLeadCardDTO[]; total: number; truncated: boolean }> {
  assertAccountId(accountId);
  const where = filtersToWhere(accountId, filters, scope);

  const [rows, total] = await Promise.all([
    prisma.realtyLead.findMany({
      where,
      select: LEAD_CARD_SELECT,
      orderBy: [{ createdAt: "desc" }],
      take: limit,
    }),
    prisma.realtyLead.count({ where }),
  ]);
  if (rows.length === 0) return { leads: [], total, truncated: false };

  const leadIds = rows.map((r) => r.id);
  const contactIds = Array.from(new Set(rows.map((r) => r.contactId)));

  const [contacts, profiles] = await Promise.all([
    // Última actividad de CONTACTO por prospecto: un solo groupBy en vez de
    // N consultas (el tablero puede traer 400 tarjetas).
    prisma.realtyLeadActivity.groupBy({
      by: ["leadId"],
      where: { accountId, leadId: { in: leadIds }, kind: { in: REALTY_CONTACT_ACTIVITY_KINDS } },
      _max: { createdAt: true },
    }),
    prisma.realtySearchProfile.findMany({
      where: { accountId, contactId: { in: contactIds } },
      select: { contactId: true, operation: true, kinds: true, zones: true, bedroomsMin: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const lastMap = new Map<string, Date | null>();
  for (const r of contacts) lastMap.set(r.leadId, r._max.createdAt ?? null);
  const profileMap = new Map<string, (typeof profiles)[number]>();
  for (const p of profiles) if (!profileMap.has(p.contactId)) profileMap.set(p.contactId, p);

  return {
    leads: rows.map((row) =>
      toLeadCard(row, lastMap.get(row.id) ?? null, wantsLine(profileMap.get(row.contactId) ?? null)),
    ),
    total,
    truncated: total > rows.length,
  };
}

// ── Ficha ───────────────────────────────────────────────────────────────

export interface RealtyLeadDetailDTO extends RealtyLeadCardDTO {
  contactKind: RealtyContactKind;
  contactNotes: string | null;
  searchProfile: {
    id: string;
    operation: RealtyOperation;
    kinds: RealtyPropertyKind[];
    zones: string[];
    budgetMin: number | null;
    budgetMax: number | null;
    bedroomsMin: number | null;
    notifyByWhatsapp: boolean;
  } | null;
  activities: {
    id: string;
    kind: RealtyLeadActivityKind;
    note: string | null;
    userId: string | null;
    userName: string | null;
    createdAt: string;
  }[];
  tasks: {
    id: string;
    title: string;
    dueAt: string;
    done: boolean;
    userId: string;
    userName: string | null;
  }[];
  visits: {
    id: string;
    propertyId: string;
    propertyTitle: string | null;
    scheduledAt: string;
    status: string;
    userName: string | null;
  }[];
}

export async function getLeadDetail(
  accountId: string,
  leadId: string,
  scope: RealtyLeadScope,
): Promise<RealtyLeadDetailDTO | null> {
  assertAccountId(accountId);
  const row = await prisma.realtyLead.findFirst({
    where: { AND: [{ accountId, id: leadId }, leadScopeWhere(scope)] },
    select: {
      ...LEAD_CARD_SELECT,
      contact: {
        select: { name: true, phone: true, email: true, source: true, kind: true, notes: true },
      },
    },
  });
  if (!row) return null;

  const [activities, profile, tasks, visits, lastContact] = await Promise.all([
    prisma.realtyLeadActivity.findMany({
      where: { accountId, leadId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        kind: true,
        note: true,
        userId: true,
        createdAt: true,
        user: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.realtySearchProfile.findFirst({
      where: { accountId, contactId: row.contactId },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.realtyTask.findMany({
      where: { accountId, leadId },
      orderBy: [{ done: "asc" }, { dueAt: "asc" }],
      take: 50,
      select: {
        id: true,
        title: true,
        dueAt: true,
        done: true,
        userId: true,
        user: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.realtyVisit.findMany({
      where: { accountId, leadId },
      orderBy: { scheduledAt: "desc" },
      take: 30,
      select: {
        id: true,
        propertyId: true,
        scheduledAt: true,
        status: true,
        property: { select: { title: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.realtyLeadActivity.findFirst({
      where: { accountId, leadId, kind: { in: REALTY_CONTACT_ACTIVITY_KINDS } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const card = toLeadCard(row as LeadCardRow, lastContact?.createdAt ?? null, null);

  return {
    ...card,
    wants: wantsLine(profile),
    contactKind: row.contact.kind,
    contactNotes: row.contact.notes,
    searchProfile: profile
      ? {
          id: profile.id,
          operation: profile.operation,
          kinds: readSearchProfileKinds(profile.kinds),
          zones: profile.zones,
          budgetMin: num(profile.budgetMin),
          budgetMax: num(profile.budgetMax),
          bedroomsMin: profile.bedroomsMin,
          notifyByWhatsapp: profile.notifyByWhatsapp,
        }
      : null,
    activities: activities.map((a) => ({
      id: a.id,
      kind: a.kind,
      note: a.note,
      userId: a.userId,
      userName: a.user ? fullName(a.user) : null,
      createdAt: a.createdAt.toISOString(),
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      dueAt: t.dueAt.toISOString(),
      done: t.done,
      userId: t.userId,
      userName: t.user ? fullName(t.user) : null,
    })),
    visits: visits.map((v) => ({
      id: v.id,
      propertyId: v.propertyId,
      propertyTitle: v.property?.title ?? null,
      scheduledAt: v.scheduledAt.toISOString(),
      status: v.status,
      userName: v.user ? fullName(v.user) : null,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 5. ESCRITURAS DEL EMBUDO
// ═══════════════════════════════════════════════════════════════════════

export class RealtyLeadError extends Error {
  readonly code: "NOT_FOUND" | "BAD_TRANSITION" | "LOST_REASON_REQUIRED" | "INVALID";
  constructor(code: RealtyLeadError["code"], message: string) {
    super(message);
    this.name = "RealtyLeadError";
    this.code = code;
  }
}

/**
 * Mueve de etapa validando el embudo canónico (canTransition). Un kanban
 * con arrastre libre saltaría de NUEVO a OFERTA y ensuciaría todo el
 * reporte de conversión: la regla vive en el contrato y se aplica AQUÍ, en
 * el servidor, no en el componente que arrastra.
 */
export async function moveLeadStage(
  accountId: string,
  leadId: string,
  to: RealtyLeadStage,
  byUserId: string,
  lostReason: string | null,
  scope: RealtyLeadScope,
): Promise<RealtyLeadStage> {
  assertAccountId(accountId);
  const lead = await prisma.realtyLead.findFirst({
    where: { AND: [{ accountId, id: leadId }, leadScopeWhere(scope)] },
    select: { id: true, stage: true },
  });
  if (!lead) throw new RealtyLeadError("NOT_FOUND", "El prospecto no existe o no es tuyo");
  if (lead.stage === to) return to;

  if (!canTransition(lead.stage, to)) {
    throw new RealtyLeadError(
      "BAD_TRANSITION",
      isTerminalLeadStage(lead.stage)
        ? "Ese prospecto ya está cerrado: no se puede mover"
        : "No se puede saltar etapas del embudo",
    );
  }
  if (to === "PERDIDO") {
    const valid = (REALTY_LOST_REASONS as readonly string[]).includes(lostReason ?? "");
    if (!valid) {
      throw new RealtyLeadError("LOST_REASON_REQUIRED", "Dinos por qué se perdió");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.realtyLead.update({
      where: { id: leadId },
      data: {
        stage: to,
        lostReason: to === "PERDIDO" ? lostReason : null,
        // Mover a CONTACTADO ES marcar contacto: si no se apuntara aquí, el
        // semáforo seguiría en rojo y la reasignación automática le quitaría
        // el prospecto a quien SÍ le habló.
        ...(to === "CONTACTADO" ? { firstResponseAt: new Date() } : {}),
      },
    });
    await logLeadActivity(
      accountId,
      leadId,
      "CAMBIO_ETAPA",
      to === "PERDIDO" ? `Perdido: ${lostReason}` : `${lead.stage} → ${to}`,
      byUserId,
      tx,
    );
  });
  return to;
}

/** Marca contacto: sella firstResponseAt (una sola vez) y deja la bitácora. */
export async function markLeadContacted(
  accountId: string,
  leadId: string,
  kind: RealtyLeadActivityKind,
  note: string | null,
  byUserId: string,
  scope: RealtyLeadScope,
): Promise<{ firstResponseAt: string | null; stage: RealtyLeadStage }> {
  assertAccountId(accountId);
  const lead = await prisma.realtyLead.findFirst({
    where: { AND: [{ accountId, id: leadId }, leadScopeWhere(scope)] },
    select: { id: true, stage: true, firstResponseAt: true },
  });
  if (!lead) throw new RealtyLeadError("NOT_FOUND", "El prospecto no existe o no es tuyo");

  const isContact = REALTY_CONTACT_ACTIVITY_KINDS.includes(kind);
  const advance = isContact && lead.stage === "NUEVO";

  const updated = await prisma.$transaction(async (tx) => {
    await logLeadActivity(accountId, leadId, kind, note, byUserId, tx);
    if (!isContact) return lead;
    return tx.realtyLead.update({
      where: { id: leadId },
      data: {
        // 🔴 firstResponseAt NO se re-escribe: es el reloj del negocio
        // ("cuánto tardamos la PRIMERA vez"). Pisarlo en cada llamada lo
        // convertiría en "última llamada" y el reporte mentiría.
        ...(lead.firstResponseAt ? {} : { firstResponseAt: new Date() }),
        ...(advance ? { stage: "CONTACTADO" as RealtyLeadStage } : {}),
      },
      select: { id: true, stage: true, firstResponseAt: true },
    });
  });

  if (advance) {
    await logLeadActivity(accountId, leadId, "CAMBIO_ETAPA", "NUEVO → CONTACTADO", byUserId);
  }
  return { firstResponseAt: iso(updated.firstResponseAt), stage: updated.stage };
}

/** Asignación a mano (o desasignar con userId = null). */
export async function assignLead(
  accountId: string,
  leadId: string,
  toUserId: string | null,
  byUserId: string | null,
  note?: string,
): Promise<void> {
  assertAccountId(accountId);
  const lead = await prisma.realtyLead.findFirst({
    where: { accountId, id: leadId },
    select: { id: true, assignedUserId: true },
  });
  if (!lead) throw new RealtyLeadError("NOT_FOUND", "El prospecto no existe");

  if (toUserId) {
    const target = await prisma.realtyUser.findFirst({
      where: { id: toUserId, accountId, active: true },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!target) throw new RealtyLeadError("INVALID", "Ese asesor no existe en tu cuenta");
    await prisma.$transaction(async (tx) => {
      await tx.realtyLead.update({
        where: { id: leadId },
        data: { assignedUserId: toUserId, assignedAt: new Date() },
      });
      await logLeadActivity(
        accountId,
        leadId,
        "ASIGNACION",
        note ?? `Asignado a ${fullName(target)}`,
        byUserId,
        tx,
      );
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.realtyLead.update({
      where: { id: leadId },
      data: { assignedUserId: null, assignedAt: null },
    });
    await logLeadActivity(accountId, leadId, "ASIGNACION", note ?? "Sin asesor", byUserId, tx);
  });
}

/**
 * Asigna automáticamente según la config de la cuenta. Se usa al crear un
 * prospecto (a mano, desde la web o desde el correo de un portal).
 */
export async function autoAssignLead(
  accountId: string,
  leadId: string,
  target: RealtyRoutingTarget,
  opts: { timeZone: string; config?: RealtyLeadRoutingConfig; now?: Date } ,
): Promise<RealtyPickResult> {
  assertAccountId(accountId);
  const config = opts.config ?? (await getLeadRoutingConfig(accountId));
  const candidates = await getAssigneeCandidates(accountId, config);
  const now = opts.now ?? new Date();
  const pick = pickAssignee(candidates, config, target, now, opts.timeZone);

  if (!pick.userId) {
    await logLeadActivity(accountId, leadId, "ASIGNACION", `Sin asignar — ${pick.reason}`, null);
    return pick;
  }
  const name = candidates.find((c) => c.id === pick.userId)?.name ?? "el asesor";
  await prisma.$transaction(async (tx) => {
    await tx.realtyLead.update({
      where: { id: leadId },
      data: { assignedUserId: pick.userId, assignedAt: now },
    });
    await logLeadActivity(
      accountId,
      leadId,
      "ASIGNACION",
      `${REALTY_AUTO_MARK} ${name} — ${pick.reason}`,
      null,
      tx,
    );
  });
  return pick;
}

// ═══════════════════════════════════════════════════════════════════════
// 6. ⭐ REASIGNACIÓN POR NO-RESPUESTA
// ═══════════════════════════════════════════════════════════════════════

export interface RealtySweepResult {
  checked: number;
  reassigned: number;
  exhausted: number;
  details: { leadId: string; from: string | null; to: string; reason: string }[];
}

/** Cuántos prospectos se revisan por barrida. Tope para que la pantalla que
 *  la dispara no se quede colgada en una cuenta con miles de leads viejos. */
const SWEEP_BATCH = 60;

/**
 * ⭐ Si el asesor no marcó contacto en N minutos, el prospecto pasa al
 * siguiente de la rotación y queda registrado en la bitácora.
 *
 * Se dispara sola cuando alguien abre el embudo (barrida perezosa) y
 * también por POST /api/realty/leads/sweep, para que un cron la pueda
 * llamar sin inventar nada.
 *
 * CARRERA: dos barridas simultáneas podrían reasignar dos veces. El
 * `updateMany` lleva el asesor ESPERADO en el where, así que solo una gana;
 * la que pierde recibe count 0 y no escribe bitácora.
 */
export async function sweepStaleLeadAssignments(
  accountId: string,
  opts: { timeZone: string; config?: RealtyLeadRoutingConfig; now?: Date },
): Promise<RealtySweepResult> {
  assertAccountId(accountId);
  const config = opts.config ?? (await getLeadRoutingConfig(accountId));
  const out: RealtySweepResult = { checked: 0, reassigned: 0, exhausted: 0, details: [] };
  if (!config.reassignEnabled || config.strategy === "MANUAL") return out;

  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - config.reassignAfterMinutes * 60_000);

  const stale = await prisma.realtyLead.findMany({
    where: {
      accountId,
      firstResponseAt: null,
      stage: { notIn: ["CIERRE", "PERDIDO"] },
      assignedUserId: { not: null },
      assignedAt: { lte: cutoff },
    },
    select: {
      id: true,
      assignedUserId: true,
      contactId: true,
      property: { select: { colonia: true, city: true } },
    },
    orderBy: { assignedAt: "asc" },
    take: SWEEP_BATCH,
  });
  out.checked = stale.length;
  if (stale.length === 0) return out;

  const candidates = await getAssigneeCandidates(accountId, config);
  if (candidates.length < 2) return out; // con un solo asesor no hay a quién pasarlo

  const leadIds = stale.map((l) => l.id);
  const contactIds = Array.from(new Set(stale.map((l) => l.contactId)));

  const [history, profiles] = await Promise.all([
    prisma.realtyLeadActivity.findMany({
      where: { accountId, leadId: { in: leadIds }, kind: "ASIGNACION" },
      select: { leadId: true, note: true },
    }),
    prisma.realtySearchProfile.findMany({
      where: { accountId, contactId: { in: contactIds } },
      select: { contactId: true, zones: true },
    }),
  ]);

  const hops = new Map<string, number>();
  for (const h of history) {
    if (h.note?.startsWith(REALTY_AUTO_MARK)) hops.set(h.leadId, (hops.get(h.leadId) ?? 0) + 1);
  }
  const zonesByContact = new Map<string, string[]>();
  for (const p of profiles) {
    if (!zonesByContact.has(p.contactId)) zonesByContact.set(p.contactId, p.zones);
  }

  for (const lead of stale) {
    // El primer ASIGNACION automático es el reparto INICIAL, no un rebote:
    // por eso el tope se compara contra hops - 1.
    const bounced = Math.max(0, (hops.get(lead.id) ?? 0) - 1);
    if (bounced >= config.reassignMaxHops) {
      out.exhausted += 1;
      continue;
    }

    const zones = [
      ...(zonesByContact.get(lead.contactId) ?? []),
      lead.property?.colonia ?? "",
      lead.property?.city ?? "",
    ].filter(Boolean);

    const pick = pickAssignee(candidates, config, { zones }, now, opts.timeZone, [
      lead.assignedUserId as string,
    ]);
    if (!pick.userId || pick.userId === lead.assignedUserId) continue;

    const moved = await prisma.realtyLead.updateMany({
      where: {
        id: lead.id,
        accountId,
        assignedUserId: lead.assignedUserId,
        firstResponseAt: null,
      },
      data: { assignedUserId: pick.userId, assignedAt: now },
    });
    if (moved.count === 0) continue; // otra barrida ganó, o ya contestaron

    const fromName =
      candidates.find((c) => c.id === lead.assignedUserId)?.name ?? "el asesor anterior";
    const toName = candidates.find((c) => c.id === pick.userId)?.name ?? "el siguiente asesor";
    await logLeadActivity(
      accountId,
      lead.id,
      "ASIGNACION",
      `${REALTY_AUTO_MARK} Sin contacto en ${config.reassignAfterMinutes} min: pasa de ${fromName} a ${toName}`,
      null,
    );

    // La rotación tiene que ver el reparto que acaba de ocurrir; si no, la
    // misma barrida le encaja todos los rezagados a la misma persona.
    const c = candidates.find((x) => x.id === pick.userId);
    if (c) {
      c.lastAssignedAt = now;
      c.openLeads += 1;
    }
    const prev = candidates.find((x) => x.id === lead.assignedUserId);
    if (prev) prev.openLeads = Math.max(0, prev.openLeads - 1);

    out.reassigned += 1;
    out.details.push({
      leadId: lead.id,
      from: lead.assignedUserId,
      to: pick.userId,
      reason: pick.reason,
    });
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 7. ALTA DE PROSPECTOS
// ═══════════════════════════════════════════════════════════════════════

export interface RealtyCreateLeadInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  portal?: string | null;
  propertyId?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  creditKind?: RealtyCreditKind;
  note?: string | null;
  /** Perfil de búsqueda inicial (opcional). */
  search?: {
    operation?: RealtyOperation;
    kinds?: RealtyPropertyKind[];
    zones?: string[];
    budgetMin?: number | null;
    budgetMax?: number | null;
    bedroomsMin?: number | null;
    notifyByWhatsapp?: boolean;
  } | null;
}

/**
 * Crea (o reutiliza) el contacto y le abre un prospecto.
 *
 * REUSO DEL CONTACTO: si ya existe alguien con ese teléfono normalizado en
 * la cuenta, NO se duplica — se le cuelga un lead nuevo. Un mismo comprador
 * que pregunta por tres casas es UNA persona con tres prospectos, y si se
 * duplicara el contacto la bitácora quedaría partida en tres pedazos.
 */
export async function createLeadWithContact(
  accountId: string,
  input: RealtyCreateLeadInput,
  byUserId: string | null,
): Promise<{ leadId: string; contactId: string; reusedContact: boolean }> {
  assertAccountId(accountId);
  const name = input.name.trim() || "Prospecto sin nombre";
  const phone = mxTenDigits(input.phone ?? null);
  const email = input.email?.trim().toLowerCase() || null;

  let contact = phone
    ? await prisma.realtyContact.findFirst({
        where: { accountId, phone },
        select: { id: true },
      })
    : null;
  if (!contact && email) {
    contact = await prisma.realtyContact.findFirst({
      where: { accountId, email },
      select: { id: true },
    });
  }
  const reusedContact = Boolean(contact);

  if (!contact) {
    contact = await prisma.realtyContact.create({
      data: {
        accountId,
        name,
        phone,
        email,
        kind: "PROSPECTO",
        source: input.source ?? (input.portal ? `portal:${input.portal}` : null),
        assignedUserId: null,
      },
      select: { id: true },
    });
  }

  // El inmueble referido se valida contra la cuenta: un propertyId de otra
  // inmobiliaria colgaría un prospecto de un inmueble ajeno.
  let propertyId: string | null = null;
  if (input.propertyId) {
    const p = await prisma.realtyProperty.findFirst({
      where: { id: input.propertyId, accountId },
      select: { id: true },
    });
    propertyId = p?.id ?? null;
  }

  const lead = await prisma.realtyLead.create({
    data: {
      accountId,
      contactId: contact.id,
      propertyId,
      portal: input.portal ?? null,
      stage: "NUEVO",
      budgetMin: input.budgetMin ?? null,
      budgetMax: input.budgetMax ?? null,
      creditKind: input.creditKind ?? "NINGUNO",
    },
    select: { id: true },
  });

  if (input.note) {
    await logLeadActivity(accountId, lead.id, "NOTA", input.note, byUserId);
  }

  if (input.search) {
    // onlyIfMissing: si el contacto ya venía con perfil (porque es de otro
    // asesor o de un prospecto anterior), NO se pisa. Ver upsertSearchProfile.
    await upsertSearchProfile(accountId, contact.id, input.search, { onlyIfMissing: true });
  }

  return { leadId: lead.id, contactId: contact.id, reusedContact };
}

/**
 * Guarda lo que busca un contacto.
 *
 * 🔴 `onlyIfMissing` NO es un lujo. El alta de prospecto reutiliza el
 * contacto cuando el teléfono ya existe en la cuenta (que es lo correcto:
 * una persona, varios prospectos). Sin este freno, dar de alta un prospecto
 * con el teléfono del cliente de OTRO asesor PISABA su perfil de búsqueda
 * entero —zonas, presupuesto y, lo grave, `notifyByWhatsapp`—, que es
 * exactamente el opt-out que respeta el envío masivo. El formulario de alta
 * solo puede ESTRENAR un perfil; cambiarlo se hace desde la ficha, que sí
 * valida el alcance.
 */
export async function upsertSearchProfile(
  accountId: string,
  contactId: string,
  data: NonNullable<RealtyCreateLeadInput["search"]>,
  opts: { onlyIfMissing?: boolean } = {},
): Promise<string> {
  assertAccountId(accountId);
  const contact = await prisma.realtyContact.findFirst({
    where: { accountId, id: contactId },
    select: { id: true },
  });
  if (!contact) throw new RealtyLeadError("NOT_FOUND", "El contacto no existe");

  const kinds = (data.kinds ?? []).reduce<Record<string, boolean>>((acc, k) => {
    acc[k] = true;
    return acc;
  }, {});
  const payload = {
    operation: data.operation ?? "VENTA",
    kinds: kinds as Prisma.InputJsonValue,
    zones: (data.zones ?? []).map((z) => z.trim()).filter(Boolean),
    budgetMin: data.budgetMin ?? null,
    budgetMax: data.budgetMax ?? null,
    bedroomsMin: data.bedroomsMin ?? null,
    notifyByWhatsapp: data.notifyByWhatsapp ?? false,
  };

  // Sin @@unique([accountId, contactId]) en el schema no se puede upsert:
  // se busca y se actualiza, o se crea.
  const existing = await prisma.realtySearchProfile.findFirst({
    where: { accountId, contactId },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (existing) {
    if (opts.onlyIfMissing) return existing.id;
    await prisma.realtySearchProfile.update({ where: { id: existing.id }, data: payload });
    return existing.id;
  }
  const created = await prisma.realtySearchProfile.create({
    data: { accountId, contactId, ...payload },
    select: { id: true },
  });
  return created.id;
}

// ═══════════════════════════════════════════════════════════════════════
// 8. TAREAS Y VISITAS
// ═══════════════════════════════════════════════════════════════════════

export interface RealtyTaskRowDTO {
  id: string;
  title: string;
  dueAt: string;
  done: boolean;
  userId: string;
  userName: string | null;
  leadId: string | null;
  leadName: string | null;
  propertyId: string | null;
  propertyTitle: string | null;
  overdue: boolean;
}

/**
 * "Mis pendientes de hoy": lo vencido + lo que cae hoy. El Inicio (otra
 * terminal) consume esta misma función para no reimplementar el criterio.
 */
export async function listTasksForToday(
  accountId: string,
  realtyUserId: string,
  opts: { includeAll?: boolean; now?: Date; timeZone?: string } = {},
): Promise<RealtyTaskRowDTO[]> {
  assertAccountId(accountId);
  const now = opts.now ?? new Date();
  const endOfDay = endOfLocalDay(now, opts.timeZone ?? "America/Mexico_City");

  const rows = await prisma.realtyTask.findMany({
    where: {
      accountId,
      done: false,
      dueAt: { lte: endOfDay },
      ...(opts.includeAll ? {} : { userId: realtyUserId }),
    },
    orderBy: { dueAt: "asc" },
    take: 100,
    select: {
      id: true,
      title: true,
      dueAt: true,
      done: true,
      userId: true,
      leadId: true,
      propertyId: true,
      user: { select: { firstName: true, lastName: true } },
      lead: { select: { contact: { select: { name: true } } } },
      property: { select: { title: true } },
    },
  });

  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    dueAt: t.dueAt.toISOString(),
    done: t.done,
    userId: t.userId,
    userName: t.user ? fullName(t.user) : null,
    leadId: t.leadId,
    leadName: t.lead?.contact.name ?? null,
    propertyId: t.propertyId,
    propertyTitle: t.property?.title ?? null,
    overdue: t.dueAt.getTime() < now.getTime(),
  }));
}

/** Fin del día EN LA ZONA DE LA CUENTA (Vercel corre en UTC). */
export function endOfLocalDay(now: Date, timeZone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? "0");
    const hh = get("hour") === 24 ? 0 : get("hour");
    const restanteMin = (23 - hh) * 60 + (59 - get("minute"));
    return new Date(now.getTime() + restanteMin * 60_000 + 59_000);
  } catch {
    const d = new Date(now);
    d.setUTCHours(23, 59, 59, 999);
    return d;
  }
}

export async function createTask(
  accountId: string,
  input: { title: string; dueAt: Date; userId: string; leadId?: string | null; propertyId?: string | null },
  byUserId: string | null,
  scope: RealtyLeadScope,
): Promise<string> {
  assertAccountId(accountId);
  const owner = await prisma.realtyUser.findFirst({
    where: { id: input.userId, accountId, active: true },
    select: { id: true },
  });
  if (!owner) throw new RealtyLeadError("INVALID", "Ese responsable no existe en tu cuenta");

  let leadId: string | null = null;
  if (input.leadId) {
    // Con el ALCANCE puesto: sin él, un asesor colgaba pendientes del
    // prospecto de un compañero y le escribía una NOTA en su bitácora.
    const l = await prisma.realtyLead.findFirst({
      where: { AND: [{ id: input.leadId, accountId }, leadScopeWhere(scope)] },
      select: { id: true },
    });
    // 🔴 Truena en vez de caer a null: con el recorte puesto, un leadId que
    // no resuelve creaba el pendiente SUELTO y devolvía 201, así que quien
    // lo capturó creía haberlo colgado del prospecto y el recordatorio se
    // perdía de la ficha. Un pendiente que nadie vuelve a ver es peor que
    // un error.
    if (!l) throw new RealtyLeadError("NOT_FOUND", "Ese prospecto no existe o no es tuyo");
    leadId = l.id;
  }
  let propertyId: string | null = null;
  if (input.propertyId) {
    const p = await prisma.realtyProperty.findFirst({
      where: { id: input.propertyId, accountId },
      select: { id: true },
    });
    if (!p) throw new RealtyLeadError("INVALID", "Ese inmueble no está en tu cartera");
    propertyId = p.id;
  }

  const task = await prisma.realtyTask.create({
    data: { accountId, userId: owner.id, leadId, propertyId, title: input.title.trim(), dueAt: input.dueAt },
    select: { id: true },
  });
  if (leadId) {
    await logLeadActivity(accountId, leadId, "NOTA", `Pendiente: ${input.title.trim()}`, byUserId);
  }
  return task.id;
}

/**
 * Palomear un pendiente.
 *
 * 🔴 Solo los PROPIOS, salvo que la persona pueda repartir (leads.assign).
 * Sin este recorte era MÁS FÁCIL cerrarle el pendiente a un compañero que
 * verlo: leer los del equipo pide leads.assign y esto pedía solo leads.edit,
 * y la ficha del prospecto enseña los taskId de los demás.
 */
export async function setTaskDone(
  accountId: string,
  taskId: string,
  done: boolean,
  scope: RealtyLeadScope,
): Promise<boolean> {
  assertAccountId(accountId);
  // MISMA regla que leadScopeWhere: manda el ROL y el permiso solo AMPLÍA.
  // Con la condición puesta solo en leads.assign, un ASSISTANT —que es la
  // mesa de control y ve el tablero entero— se quedaba sin poder palomear
  // el pendiente de nadie.
  const canSeeAll =
    scope.role !== "AGENT" ||
    resolveRealtyPermissions(scope.role, scope.permissionsOverride).has("leads.assign");
  const res = await prisma.realtyTask.updateMany({
    where: {
      id: taskId,
      accountId,
      ...(canSeeAll ? {} : { userId: scope.realtyUserId }),
    },
    data: { done },
  });
  return res.count > 0;
}

export async function scheduleVisitFromLead(
  accountId: string,
  leadId: string,
  input: { propertyId: string; scheduledAt: Date; userId?: string | null },
  byUserId: string,
  scope: RealtyLeadScope,
): Promise<string> {
  assertAccountId(accountId);
  // 🔴 CON EL ALCANCE. Esta función AVANZA la etapa a VISITA, así que sin
  // el recorte era una puerta trasera a moveLeadStage: un asesor movía el
  // prospecto de un compañero sin pasar por el check que dice "no es tuyo".
  const lead = await prisma.realtyLead.findFirst({
    where: { AND: [{ accountId, id: leadId }, leadScopeWhere(scope)] },
    select: { id: true, stage: true, assignedUserId: true },
  });
  if (!lead) throw new RealtyLeadError("NOT_FOUND", "El prospecto no existe o no es tuyo");

  const property = await prisma.realtyProperty.findFirst({
    where: { id: input.propertyId, accountId },
    select: { id: true, title: true },
  });
  if (!property) throw new RealtyLeadError("INVALID", "Ese inmueble no está en tu cartera");

  // 🔴 El userId del body se valida CONTRA LA CUENTA, igual que en
  // createTask y assignLead. La FK de RealtyVisit.userId es global, no
  // compuesta: cualquier RealtyUser.id del planeta la satisface, y la ficha
  // del prospecto pinta visits[].userName — o sea que un id ajeno filtraba
  // el nombre de un empleado de otra inmobiliaria.
  let visitUserId: string | null = lead.assignedUserId ?? byUserId;
  if (input.userId) {
    const target = await prisma.realtyUser.findFirst({
      where: { id: input.userId, accountId, active: true },
      select: { id: true },
    });
    if (!target) throw new RealtyLeadError("INVALID", "Ese asesor no existe en tu cuenta");
    visitUserId = target.id;
  }

  const visit = await prisma.$transaction(async (tx) => {
    const v = await tx.realtyVisit.create({
      data: {
        accountId,
        propertyId: property.id,
        leadId,
        userId: visitUserId,
        scheduledAt: input.scheduledAt,
        status: "PROGRAMADA",
      },
      select: { id: true },
    });
    await logLeadActivity(
      accountId,
      leadId,
      "VISITA",
      `Visita agendada a ${property.title}`,
      byUserId,
      tx,
    );
    // Agendar visita ES avanzar el embudo, si la etapa lo permite.
    if (canTransition(lead.stage, "VISITA")) {
      await tx.realtyLead.update({ where: { id: leadId }, data: { stage: "VISITA" } });
      await logLeadActivity(accountId, leadId, "CAMBIO_ETAPA", `${lead.stage} → VISITA`, byUserId, tx);
    }
    return v;
  });
  return visit.id;
}

// ═══════════════════════════════════════════════════════════════════════
// 9. PUENTE AL MOTOR DE MATCH
// ═══════════════════════════════════════════════════════════════════════

const MATCH_PROPERTY_SELECT = {
  id: true,
  title: true,
  kind: true,
  operation: true,
  status: true,
  price: true,
  rentPrice: true,
  currency: true,
  bedrooms: true,
  colonia: true,
  city: true,
  state: true,
} satisfies Prisma.RealtyPropertySelect;

function toMatchProperty(
  p: Prisma.RealtyPropertyGetPayload<{ select: typeof MATCH_PROPERTY_SELECT }>,
): RealtyMatchProperty {
  return {
    id: p.id,
    title: p.title,
    kind: p.kind,
    operation: p.operation,
    status: p.status,
    price: num(p.price) ?? 0,
    rentPrice: num(p.rentPrice),
    currency: p.currency,
    bedrooms: p.bedrooms,
    colonia: p.colonia,
    city: p.city,
    state: p.state,
  };
}

/** Cuántos inmuebles/perfiles se cruzan como máximo por consulta. */
const MATCH_SCAN_LIMIT = 800;

/** Entra un PROSPECTO → qué inmuebles del inventario le quedan. */
export async function suggestPropertiesForLead(
  accountId: string,
  leadId: string,
  scope: RealtyLeadScope,
  opts: { tolerancePct?: number; limit?: number } = {},
): Promise<RealtyPropertyMatchDTO[]> {
  assertAccountId(accountId);
  const lead = await prisma.realtyLead.findFirst({
    where: { AND: [{ accountId, id: leadId }, leadScopeWhere(scope)] },
    select: {
      id: true,
      contactId: true,
      budgetMin: true,
      budgetMax: true,
      contact: { select: { name: true } },
    },
  });
  if (!lead) return [];

  const profile = await prisma.realtySearchProfile.findFirst({
    where: { accountId, contactId: lead.contactId },
    orderBy: { updatedAt: "desc" },
  });

  const seeker: RealtyMatchSeeker = {
    contactId: lead.contactId,
    leadId: lead.id,
    name: lead.contact.name,
    operation: profile?.operation ?? "VENTA",
    kinds: readSearchProfileKinds(profile?.kinds ?? null),
    zones: profile?.zones ?? [],
    // El presupuesto del PERFIL manda; si está vacío, el que trae el lead.
    budgetMin: num(profile?.budgetMin) ?? num(lead.budgetMin),
    budgetMax: num(profile?.budgetMax) ?? num(lead.budgetMax),
    bedroomsMin: profile?.bedroomsMin ?? null,
    notifyByWhatsapp: profile?.notifyByWhatsapp ?? false,
  };

  const properties = await prisma.realtyProperty.findMany({
    where: { accountId, status: "DISPONIBLE" },
    select: MATCH_PROPERTY_SELECT,
    take: MATCH_SCAN_LIMIT,
    orderBy: { createdAt: "desc" },
  });

  const matchOpts: RealtyMatchOptions = { budgetTolerancePct: opts.tolerancePct };
  const all = matchPropertiesForSeeker(seeker, properties.map(toMatchProperty), matchOpts);
  return opts.limit ? all.slice(0, opts.limit) : all;
}

/** Entra un INMUEBLE → qué prospectos lo están buscando. */
export async function findSeekersForProperty(
  accountId: string,
  propertyId: string,
  scope: RealtyLeadScope,
  opts: { tolerancePct?: number; limit?: number } = {},
): Promise<{ property: RealtyMatchProperty; matches: RealtySeekerMatchDTO[] } | null> {
  assertAccountId(accountId);
  const property = await prisma.realtyProperty.findFirst({
    where: { accountId, id: propertyId },
    select: MATCH_PROPERTY_SELECT,
  });
  if (!property) return null;

  // 🔴 EL ORDEN IMPORTA: primero los prospectos VIVOS y YA RECORTADOS por
  // alcance, y el tope se aplica sobre ESOS. Al revés (topar los perfiles de
  // toda la cuenta y recortar después), en una agencia con más perfiles que
  // MATCH_SCAN_LIMIT un asesor recibía una lista truncada —o vacía— sin que
  // nada se lo dijera.
  //
  // Y solo prospectos vivos: avisarle a alguien que ya cerró o que se marcó
  // como perdido es justo el mensaje que hace que el cliente apague los
  // avisos.
  const liveLeads = await prisma.realtyLead.findMany({
    where: {
      AND: [
        { accountId, stage: { notIn: ["CIERRE", "PERDIDO"] } },
        leadScopeWhere(scope),
      ],
    },
    select: { id: true, contactId: true },
    orderBy: { createdAt: "desc" },
    take: MATCH_SCAN_LIMIT,
  });
  const leadByContact = new Map<string, string>();
  for (const l of liveLeads) if (!leadByContact.has(l.contactId)) leadByContact.set(l.contactId, l.id);
  if (leadByContact.size === 0) {
    return { property: toMatchProperty(property), matches: [] };
  }

  const profiles = await prisma.realtySearchProfile.findMany({
    where: { accountId, contactId: { in: Array.from(leadByContact.keys()) } },
    orderBy: { updatedAt: "desc" },
    select: {
      contactId: true,
      operation: true,
      kinds: true,
      zones: true,
      budgetMin: true,
      budgetMax: true,
      bedroomsMin: true,
      notifyByWhatsapp: true,
      contact: { select: { name: true } },
    },
  });
  if (profiles.length === 0) {
    return { property: toMatchProperty(property), matches: [] };
  }

  const seekers: RealtyMatchSeeker[] = profiles
    .filter((p) => leadByContact.has(p.contactId))
    .map((p) => ({
      contactId: p.contactId,
      leadId: leadByContact.get(p.contactId) ?? null,
      name: p.contact.name,
      operation: p.operation,
      kinds: readSearchProfileKinds(p.kinds),
      zones: p.zones,
      budgetMin: num(p.budgetMin),
      budgetMax: num(p.budgetMax),
      bedroomsMin: p.bedroomsMin,
      notifyByWhatsapp: p.notifyByWhatsapp,
    }));

  const all = matchSeekersForProperty(toMatchProperty(property), seekers, {
    budgetTolerancePct: opts.tolerancePct,
  });
  return {
    property: toMatchProperty(property),
    matches: opts.limit ? all.slice(0, opts.limit) : all,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 10. PUERTA DE LAS APIS DEL ÁREA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Los TRES filtros del contrato (modo + feature del plan + permiso) en un
 * solo lugar, para que ninguna de las catorce rutas del área invente el
 * suyo. Devuelve un resultado tipado en vez de una NextResponse: así este
 * módulo no arrastra next/server y se puede probar en un test puro.
 *
 * 🔴 El MODO es control de acceso real, no cosmética: el sidebar ya esconde
 * Prospectos en modo OWNER, pero esconder un menú no impide un fetch a la
 * API escrito a mano.
 */
export interface RealtyLeadsGuardCtx {
  mode: "AGENCY" | "AGENT" | "OWNER";
  role: RealtyRole;
  user: { permissionsOverride: string[] };
  plan: { features: Record<string, unknown> };
}

/**
 * ⚠️ NO es una unión discriminada a propósito. El tsconfig del repo corre
 * con `strict: false`, y sin strictNullChecks TypeScript NO estrecha
 * `{ok:true} | {ok:false, error:string}` con un `if (!guard.ok)`: dentro
 * del if sigue viendo la rama `ok:true` y marca `guard.error` como
 * inexistente. Con un solo objeto de campos opcionales el patrón
 * `guard.error ?? "…"` compila y sigue siendo seguro.
 */
export interface RealtyLeadsGuard {
  ok: boolean;
  status?: 401 | 403;
  error?: string;
}

export function checkLeadsAccess(
  ctx: RealtyLeadsGuardCtx | null,
  permission: "leads.view" | "leads.edit" | "leads.assign" | "visits.manage",
): RealtyLeadsGuard {
  if (!ctx) return { ok: false, status: 401, error: "No autorizado" };
  if (ctx.mode === "OWNER") {
    return { ok: false, status: 403, error: "Esta sección no aplica a tu tipo de cuenta" };
  }
  if (ctx.plan.features.leads !== true) {
    return { ok: false, status: 403, error: "Tu plan no incluye el embudo de prospectos" };
  }
  if (!resolveRealtyPermissions(ctx.role, ctx.user.permissionsOverride).has(permission)) {
    return { ok: false, status: 403, error: "Sin permiso" };
  }
  return { ok: true };
}

// ── Catálogos que consume la UI ─────────────────────────────────────────

export interface RealtyLeadsCatalogs {
  agents: { id: string; name: string; role: RealtyRole }[];
  sources: string[];
  properties: { id: string; title: string }[];
}

export async function getLeadsCatalogs(accountId: string): Promise<RealtyLeadsCatalogs> {
  assertAccountId(accountId);
  const [users, portals, contactSources, properties] = await Promise.all([
    prisma.realtyUser.findMany({
      where: { accountId, active: true },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.realtyLead.findMany({
      where: { accountId, portal: { not: null } },
      select: { portal: true },
      distinct: ["portal"],
      take: 40,
    }),
    prisma.realtyContact.findMany({
      where: { accountId, kind: "PROSPECTO", source: { not: null } },
      select: { source: true },
      distinct: ["source"],
      take: 40,
    }),
    prisma.realtyProperty.findMany({
      where: { accountId, status: { in: ["DISPONIBLE", "APARTADO"] } },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
  ]);

  const sources = Array.from(
    new Set([
      ...portals.map((p) => p.portal).filter((v): v is string => Boolean(v)),
      ...contactSources.map((c) => c.source).filter((v): v is string => Boolean(v)),
    ]),
  ).sort((a, b) => a.localeCompare(b, "es"));

  return {
    agents: users.map((u) => ({ id: u.id, name: fullName(u), role: u.role })),
    sources,
    properties,
  };
}
