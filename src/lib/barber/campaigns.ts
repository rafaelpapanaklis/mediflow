import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isMissingColumnError } from "@/lib/barber/db-errors";
import { mxTenDigits } from "@/lib/phone-mx";
import type { BarberContext } from "@/lib/barber-auth";
import {
  getBarberClientsConfig,
  listBarberOutreach,
  NOT_CANCELLED,
  withReservedPreference,
  type BarberClientsConfig,
  type BarberOutreachTarget,
} from "@/lib/barber/clients";
import {
  BARBER_WA_PRICE_USD,
  barberWaTemplate,
  type BarberWaKind,
} from "@/lib/barber/whatsapp-core";
import { sendBarberCampaign, CAMPAIGN_BATCH_MAX } from "@/lib/barber/whatsapp";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — motor de CAMPAÑAS de retención.
 *
 * TERMINOLOGÍA: cliente / barbero / barbería / servicio / visita.
 *
 * POR QUÉ EXISTE ESTA PANTALLA: en 2025 las visitas de clientes NUEVOS a
 * barberías cayeron 17 % mientras las membresías subieron 20 %. El negocio
 * dejó de estar en conseguir gente nueva y pasó a estar en que vuelva la
 * que ya te conoce. Aquí se ataca eso y nada más.
 *
 * ── AISLAMIENTO MULTI-TENANT ────────────────────────────────────────
 * TODA función recibe el `BarberContext` de getBarberContext() y filtra por
 * `ctx.barbershopId` YA DESESTRUCTURADO a un string. Ninguna acepta un
 * barbershopId suelto por parámetro, para que no exista la forma de colarlo
 * desde el body. Ojo Prisma: `barbershopId: undefined` BORRA el filtro.
 *
 * ── LO QUE NO SE REESCRIBE ──────────────────────────────────────────
 * · Las listas de inactivos y cumpleaños son de T4: se CONSUMEN con
 *   listBarberOutreach() (que ya excluye bloqueados y normaliza teléfono).
 * · El envío es de T7: se delega en sendBarberCampaign(), que crea la fila
 *   de BarberMessage, descuenta cupo y habla con Meta. Aquí NO se vuelve a
 *   implementar un emisor.
 * · El precio por mensaje es BARBER_WA_PRICE_USD de whatsapp-core.
 *
 * ── DÓNDE VIVE EL ESTADO, SIN TOCAR EL SCHEMA ───────────────────────
 * El contrato de esta ola prohíbe crear tablas. Entonces:
 *
 * · BAJA ("ya no me escriban") y BITÁCORA de campañas viven en llaves
 *   RESERVADAS de `BarberClient.preferences` (__optout / __campaigns),
 *   igual que ya viven ahí la bitácora de lealtad y el bloqueo. Se
 *   escriben con withReservedPreference(), así un PATCH de preferencias
 *   desde el navegador no las puede borrar ni falsificar.
 *
 * · PLANTILLAS editables y días de descanso entre campañas viven en dos
 *   columnas sueltas de `barber_shops` creadas por sql/barber_campanas.sql
 *   y se leen con SQL parametrizado (el cliente Prisma no las conoce). Si
 *   el SQL no está aplicado se atrapa el 42703 y se cae a los textos por
 *   defecto: la pantalla funciona igual, solo que no se pueden guardar
 *   plantillas propias. Mismo patrón que la config de T4.
 *
 * · El RECIBO de lo enviado NO se inventa: son las filas reales de
 *   BarberMessage que crea el emisor. No se escribe ninguna fila de
 *   sistema en BarberMessage a propósito — el Inbox trata CUALQUIER fila
 *   con `templateName` que empiece en "sys:" como la última decisión de
 *   archivado del hilo, así que una marca nuestra desarchivaría hilos
 *   ajenos en silencio.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── Llaves reservadas dentro de BarberClient.preferences ───────────────

/** Baja: el cliente pidió no recibir campañas. */
export const CAMPAIGN_OPT_OUT_KEY = "__optout";
/** Bitácora: cuándo se le mandó cada campaña. Es el candado anti-repetido. */
export const CAMPAIGN_LEDGER_KEY = "__campaigns";

// ── Catálogo de audiencias ─────────────────────────────────────────────

export type BarberCampaignAudience =
  | "inactive"
  | "birthday"
  | "membershipExpiring"
  | "membershipExpired"
  | "loyaltyReward"
  | "noShow";

export interface BarberCampaignAudienceDef {
  id: BarberCampaignAudience;
  /**
   * Plantilla aprobada con la que sale. Meta solo tiene DOS de marketing
   * dadas de alta para el vertical (cumpleaños y "te extrañamos"), y una
   * plantilla nueva exige aprobación de Meta: no se puede inventar desde
   * la pantalla. Lo que la barbería edita es el TEXTO DE LA PROMOCIÓN, que
   * es la variable {{3}} de esas dos.
   */
  templateKind: Extract<BarberWaKind, "birthday" | "winback">;
  /** Días mínimos antes de repetir ESTA MISMA campaña al mismo cliente. */
  repeatAfterDays: number;
}

export const BARBER_CAMPAIGN_AUDIENCES: readonly BarberCampaignAudienceDef[] = [
  // 25 días y no 365: el cumpleaños es una vez al año, pero el candado solo
  // tiene que cubrir el mes en curso para que dos envíos del mismo mes no
  // le lleguen dos veces al mismo cliente.
  { id: "birthday", templateKind: "birthday", repeatAfterDays: 25 },
  { id: "inactive", templateKind: "winback", repeatAfterDays: 90 },
  { id: "membershipExpiring", templateKind: "winback", repeatAfterDays: 25 },
  { id: "membershipExpired", templateKind: "winback", repeatAfterDays: 60 },
  { id: "loyaltyReward", templateKind: "winback", repeatAfterDays: 45 },
  { id: "noShow", templateKind: "winback", repeatAfterDays: 90 },
] as const;

export function barberCampaignAudienceDef(
  id: string,
): BarberCampaignAudienceDef | null {
  return BARBER_CAMPAIGN_AUDIENCES.find((a) => a.id === id) ?? null;
}

export function isBarberCampaignAudience(v: unknown): v is BarberCampaignAudience {
  return typeof v === "string" && barberCampaignAudienceDef(v) !== null;
}

/** Nombres de plantilla que cuentan como "campaña" en el historial. */
export const CAMPAIGN_TEMPLATE_NAMES: string[] = Array.from(
  new Set(BARBER_CAMPAIGN_AUDIENCES.map((a) => barberWaTemplate(a.templateKind).name)),
);

// ── Config de campañas (columnas sueltas de barber_shops) ──────────────

export interface BarberCampaignTemplate {
  audience: BarberCampaignAudience;
  /** Texto de la promoción, con fichas {nombre} {servicio} {barbero}… */
  promo: string;
}

export interface BarberCampaignConfig {
  /** Días de descanso entre CUALQUIER par de campañas al mismo teléfono. */
  cooldownDays: number;
  templates: Record<BarberCampaignAudience, string>;
  /** false = falta aplicar sql/barber_campanas.sql (no se puede guardar). */
  persisted: boolean;
}

export const CAMPAIGN_COOLDOWN_MIN = 3;
export const CAMPAIGN_COOLDOWN_MAX = 180;
export const CAMPAIGN_COOLDOWN_DEFAULT = 21;
export const CAMPAIGN_PROMO_MAX = 300;

/**
 * Textos por defecto. Son la promoción ({{3}}), no la plantilla entera: el
 * cuerpo aprobado por Meta ya saluda al cliente y nombra la barbería.
 */
export const CAMPAIGN_DEFAULT_PROMOS: Record<BarberCampaignAudience, string> = {
  birthday: "Este mes tu corte lleva barba de cortesía.",
  inactive: "Tu silla te está esperando: aparta tu lugar cuando gustes.",
  membershipExpiring: "Tu membresía está por vencer; renuévala y sigues igual.",
  membershipExpired: "Tu membresía ya venció; reactívala cuando quieras.",
  loyaltyReward: "Ya juntaste tus visitas: tienes {premio} esperándote.",
  noShow: "Te guardamos lugar; apártalo y llegas sin fila.",
};

/**
 * Recuerda, por proceso, que las columnas de config no existen todavía
 * (P2022: esta base va atrás de prisma/schema.prisma). Las columnas
 * `campaignCooldownDays` y `campaignTemplates` nacieron en
 * sql/barber_campanas.sql y hoy están en el schema.
 */
let campaignColumnsMissing = false;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Limpia el texto de una promoción. Meta RECHAZA un parámetro con saltos de
 * línea o tabulaciones, así que se colapsa todo a espacios simples.
 */
export function sanitizeCampaignPromo(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.replace(/\s+/g, " ").trim().slice(0, CAMPAIGN_PROMO_MAX);
}

function defaultTemplates(): Record<BarberCampaignAudience, string> {
  return { ...CAMPAIGN_DEFAULT_PROMOS };
}

function readTemplates(raw: unknown): Record<BarberCampaignAudience, string> {
  const src = asRecord(raw);
  const out = defaultTemplates();
  for (const def of BARBER_CAMPAIGN_AUDIENCES) {
    const clean = sanitizeCampaignPromo(src[def.id]);
    if (clean) out[def.id] = clean;
  }
  return out;
}

export async function getBarberCampaignConfig(
  ctx: BarberContext,
): Promise<BarberCampaignConfig> {
  const fallback: BarberCampaignConfig = {
    cooldownDays: CAMPAIGN_COOLDOWN_DEFAULT,
    templates: defaultTemplates(),
    persisted: false,
  };
  if (campaignColumnsMissing) return fallback;

  const barbershopId = ctx.barbershopId;
  try {
    // En barber_shops el inquilino ES el id de la fila.
    const row = await prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { campaignCooldownDays: true, campaignTemplates: true },
    });
    if (!row) return fallback;
    return {
      cooldownDays: clampInt(
        row.campaignCooldownDays,
        CAMPAIGN_COOLDOWN_MIN,
        CAMPAIGN_COOLDOWN_MAX,
        CAMPAIGN_COOLDOWN_DEFAULT,
      ),
      templates: readTemplates(row.campaignTemplates),
      persisted: true,
    };
  } catch (e) {
    if (isMissingColumnError(e)) {
      campaignColumnsMissing = true;
      return fallback;
    }
    console.warn("[barber/campaigns] no se pudo leer la config:", (e as Error).message);
    return fallback;
  }
}

export interface SaveCampaignConfigResult {
  ok: boolean;
  /** "sql_pendiente" = falta aplicar sql/barber_campanas.sql. */
  reason?: "sql_pendiente" | "error";
  config: BarberCampaignConfig;
}

export async function saveBarberCampaignConfig(
  ctx: BarberContext,
  input: { cooldownDays?: unknown; templates?: unknown },
): Promise<SaveCampaignConfigResult> {
  const barbershopId = ctx.barbershopId;
  const current = await getBarberCampaignConfig(ctx);

  const cooldownDays =
    input.cooldownDays === undefined
      ? current.cooldownDays
      : clampInt(
          input.cooldownDays,
          CAMPAIGN_COOLDOWN_MIN,
          CAMPAIGN_COOLDOWN_MAX,
          current.cooldownDays,
        );

  // Solo llaves conocidas: un objeto libre del navegador no puede meter
  // basura en la columna.
  const incoming = asRecord(input.templates);
  const templates = { ...current.templates };
  for (const def of BARBER_CAMPAIGN_AUDIENCES) {
    if (!(def.id in incoming)) continue;
    const clean = sanitizeCampaignPromo(incoming[def.id]);
    templates[def.id] = clean || CAMPAIGN_DEFAULT_PROMOS[def.id];
  }

  const next: BarberCampaignConfig = { cooldownDays, templates, persisted: true };
  if (campaignColumnsMissing) {
    return { ok: false, reason: "sql_pendiente", config: { ...next, persisted: false } };
  }

  try {
    // `update` exige un where único: un id undefined truena aquí en vez de
    // convertirse en un UPDATE sin filtro.
    await prisma.barbershop.update({
      where: { id: barbershopId },
      data: { campaignCooldownDays: cooldownDays, campaignTemplates: templates },
      select: { id: true },
    });
    return { ok: true, config: next };
  } catch (e) {
    if (isMissingColumnError(e)) {
      campaignColumnsMissing = true;
      return { ok: false, reason: "sql_pendiente", config: { ...next, persisted: false } };
    }
    console.warn("[barber/campaigns] no se pudo guardar la config:", (e as Error).message);
    return { ok: false, reason: "error", config: current };
  }
}

// ── Baja y bitácora (llaves reservadas de preferences) ─────────────────

export interface BarberCampaignOptOut {
  at: string;
  /** "client" = lo pidió por WhatsApp; "staff" = lo marcó el mostrador. */
  source: "client" | "staff";
  byUserId: string | null;
  reason: string | null;
}

export function readCampaignOptOut(raw: unknown): BarberCampaignOptOut | null {
  const node = asRecord(asRecord(raw)[CAMPAIGN_OPT_OUT_KEY]);
  if (typeof node.at !== "string" || !node.at) return null;
  return {
    at: node.at,
    source: node.source === "client" ? "client" : "staff",
    byUserId: typeof node.byUserId === "string" && node.byUserId ? node.byUserId : null,
    reason: typeof node.reason === "string" && node.reason ? node.reason : null,
  };
}

export interface BarberCampaignLedger {
  /** Última vez que se le mandó CADA campaña (ISO). */
  last: Partial<Record<BarberCampaignAudience, string>>;
  /** Última campaña de cualquier tipo (ISO). Es el candado del descanso. */
  lastAnyAt: string | null;
  /** Cuántas campañas ha recibido en total. Solo informativo. */
  total: number;
}

export function readCampaignLedger(raw: unknown): BarberCampaignLedger {
  const node = asRecord(asRecord(raw)[CAMPAIGN_LEDGER_KEY]);
  const lastRaw = asRecord(node.last);
  const last: Partial<Record<BarberCampaignAudience, string>> = {};
  for (const def of BARBER_CAMPAIGN_AUDIENCES) {
    const v = lastRaw[def.id];
    if (typeof v === "string" && v) last[def.id] = v;
  }
  const total = Number(node.total);
  return {
    last,
    lastAnyAt: typeof node.lastAnyAt === "string" && node.lastAnyAt ? node.lastAnyAt : null,
    total: Number.isFinite(total) && total > 0 ? Math.floor(total) : 0,
  };
}

function ledgerWith(
  previous: BarberCampaignLedger,
  audience: BarberCampaignAudience,
  atIso: string,
): BarberCampaignLedger {
  return {
    last: { ...previous.last, [audience]: atIso },
    lastAnyAt: atIso,
    total: previous.total + 1,
  };
}

export interface SetOptOutResult {
  ok: boolean;
  optOut: BarberCampaignOptOut | null;
}

/**
 * Da de baja (o revierte la baja) a un cliente. Es lo que hace que un
 * "ya no me escriban" se respete PARA SIEMPRE y en TODAS las listas: la
 * baja se lee en el mismo lugar donde se arman las audiencias, no en cada
 * pantalla por separado.
 */
export async function setBarberCampaignOptOut(
  ctx: BarberContext,
  args: {
    clientId: string;
    optOut: boolean;
    source?: "client" | "staff";
    reason?: string | null;
  },
): Promise<SetOptOutResult> {
  const barbershopId = ctx.barbershopId;
  const row = await prisma.barberClient.findFirst({
    where: { id: args.clientId, barbershopId },
    select: { id: true, preferences: true },
  });
  if (!row) return { ok: false, optOut: null };

  const value: BarberCampaignOptOut | null = args.optOut
    ? {
        at: new Date().toISOString(),
        source: args.source === "client" ? "client" : "staff",
        byUserId: ctx.barberUserId,
        reason: (args.reason ?? "").trim().slice(0, 240) || null,
      }
    : null;

  await prisma.barberClient.update({
    where: { id: row.id },
    data: {
      preferences: withReservedPreference(row.preferences, CAMPAIGN_OPT_OUT_KEY, value),
    },
  });
  return { ok: true, optOut: value };
}

/**
 * Marca la baja a partir de un teléfono. Lo usa el flujo de "responde BAJA":
 * el mensaje entrante trae número, no id de ficha.
 */
export async function optOutBarberClientByPhone(
  barbershopId: string,
  phone: string,
): Promise<boolean> {
  const clean = mxTenDigits(phone);
  if (!clean || !barbershopId) return false;
  const row = await prisma.barberClient.findFirst({
    where: { barbershopId, phone: clean },
    select: { id: true, preferences: true },
  });
  if (!row) return false;
  await prisma.barberClient.update({
    where: { id: row.id },
    data: {
      preferences: withReservedPreference(row.preferences, CAMPAIGN_OPT_OUT_KEY, {
        at: new Date().toISOString(),
        source: "client",
        byUserId: null,
        reason: null,
      }),
    },
  });
  return true;
}

// ── Costo ──────────────────────────────────────────────────────────────

export interface BarberCampaignCost {
  messages: number;
  /** Siempre MARKETING: las dos plantillas de campaña lo son. */
  category: "MARKETING";
  unitUsd: number;
  totalUsd: number;
}

/**
 * Lo que Meta le va a cobrar A LA BARBERÍA (no nosotros). Se calcula aparte
 * del envío para poder enseñarlo ANTES de que nadie apriete nada: un
 * mensaje de marketing en México cuesta ~4x uno de utilidad.
 */
export function estimateBarberCampaignCost(messages: number): BarberCampaignCost {
  const n = Math.max(0, Math.floor(messages));
  const unitUsd = BARBER_WA_PRICE_USD.MARKETING;
  return {
    messages: n,
    category: "MARKETING",
    unitUsd,
    // 4 decimales: a $0.0324 el mensaje, redondear a centavos daría $0.00
    // para tandas chicas y la barbería creería que es gratis.
    totalUsd: Number((n * unitUsd).toFixed(4)),
  };
}

// ── Fichas de la promoción ─────────────────────────────────────────────

/** Datos por cliente que puede usar el texto de la promoción. */
export interface CampaignTokenValues {
  nombre: string;
  barberia: string;
  servicio: string;
  barbero: string;
  dias: string;
  premio: string;
  vence: string;
}

export const CAMPAIGN_TOKENS: readonly (keyof CampaignTokenValues)[] = [
  "nombre",
  "barberia",
  "servicio",
  "barbero",
  "dias",
  "premio",
  "vence",
] as const;

/** Primer nombre: en un mensaje personal nadie usa el apellido. */
export function campaignFirstName(name: string | null | undefined): string {
  const clean = (name ?? "").trim();
  if (!clean) return "";
  return clean.split(/\s+/)[0];
}

/**
 * Sustituye las fichas {nombre}, {servicio}… del texto de la promoción.
 * Una ficha sin dato se borra (y de paso se limpia el espacio que deja),
 * NUNCA se manda un "{servicio}" crudo al cliente.
 */
export function renderCampaignPromo(
  promo: string,
  values: Partial<CampaignTokenValues>,
): string {
  const replaced = promo.replace(/\{(\w+)\}/g, (match, rawKey: string) => {
    const key = rawKey as keyof CampaignTokenValues;
    if (!(CAMPAIGN_TOKENS as readonly string[]).includes(key)) return match;
    const value = values[key];
    return typeof value === "string" ? value.trim() : "";
  });
  return sanitizeCampaignPromo(replaced);
}

// ── Audiencias ─────────────────────────────────────────────────────────

export type CampaignSkipReason =
  | "optOut"
  | "blocked"
  | "noPhone"
  | "alreadySent"
  | "cooldown";

export interface BarberCampaignTarget {
  clientId: string;
  name: string;
  phone: string;
  /** Frase corta que explica por qué está en la lista. La arma la pantalla. */
  lastVisitAt: string | null;
  daysSinceLastVisit: number | null;
  totalVisits: number;
  loyaltyCount: number;
  /** Gasto histórico en la barbería (MXN). Ordena la lista de inactivos. */
  spentMxn: number;
  /** Solo en cumpleaños: día del mes. */
  birthdayDay: number | null;
  /** Solo en membresías: cuándo vence/venció (ISO). */
  membershipEndAt: string | null;
  membershipName: string | null;
  /** Solo en no-shows: cuántas veces no llegó. */
  noShowCount: number;
  /** Si ya se le mandó ESTA campaña antes (ISO). Informativo. */
  lastSentAt: string | null;
  /** Elegible = ninguna regla lo excluye. Solo estos se pueden enviar. */
  eligible: boolean;
  skipReason: CampaignSkipReason | null;
}

export interface BarberCampaignAudienceResult {
  audience: BarberCampaignAudience;
  templateName: string;
  targets: BarberCampaignTarget[];
  /** Cuántos quedaron fuera y por qué. Se enseña: nada se cae en silencio. */
  skipped: Record<CampaignSkipReason, number>;
  /** Días de inactividad usados (solo "inactive"). */
  days: number | null;
  /** Mes 1-12 (solo "birthday"). */
  month: number | null;
}

/** Tope por lectura: una campaña no puede salirse de un solo query. */
export const CAMPAIGN_AUDIENCE_MAX = 500;
/** Ventana de la lista de no-shows y de membresías vencidas. */
const RECENT_WINDOW_DAYS = 180;
/** Cuántos días antes se avisa que una membresía está por vencer. */
export const MEMBERSHIP_EXPIRING_DAYS = 10;
/** Mínimo de faltas para considerar a alguien reincidente. */
export const NO_SHOW_MIN = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

const CLIENT_PICK = {
  id: true,
  name: true,
  phone: true,
  birthday: true,
  lastVisitAt: true,
  totalVisits: true,
  loyaltyCount: true,
  blockedAt: true,
  preferences: true,
} satisfies Prisma.BarberClientSelect;

type ClientPick = Prisma.BarberClientGetPayload<{ select: typeof CLIENT_PICK }>;

interface AudienceSeed {
  clientId: string;
  membershipEndAt?: Date | null;
  membershipName?: string | null;
  noShowCount?: number;
  /** Orden preferido de la audiencia (menor = primero). */
  rank?: number;
}

/**
 * Convierte los objetivos que devuelve T4 en semillas. Se conserva el orden
 * en el que vinieron: para cumpleaños ese orden ES el día del mes, que lo
 * decide el SQL de T4 y no un ORDER BY nuestro.
 */
function seedsFromOutreach(targets: BarberOutreachTarget[]): AudienceSeed[] {
  return targets.map((t, i) => ({ clientId: t.clientId, rank: i }));
}

async function seedsForAudience(
  ctx: BarberContext,
  audience: BarberCampaignAudience,
  clientsConfig: BarberClientsConfig,
  args: { month?: number; days?: number },
): Promise<{ seeds: AudienceSeed[]; days: number | null; month: number | null }> {
  const barbershopId = ctx.barbershopId;
  const now = new Date();

  if (audience === "birthday") {
    // Lista de T4: NO se reimplementa el EXTRACT(MONTH…) aquí.
    const list = await listBarberOutreach(ctx, {
      kind: "birthday",
      month: args.month,
      limit: CAMPAIGN_AUDIENCE_MAX,
    });
    return { seeds: seedsFromOutreach(list.targets), days: null, month: list.month };
  }

  if (audience === "inactive") {
    const list = await listBarberOutreach(ctx, {
      kind: "inactive",
      days: args.days,
      limit: CAMPAIGN_AUDIENCE_MAX,
    });
    return { seeds: seedsFromOutreach(list.targets), days: list.days, month: null };
  }

  if (audience === "membershipExpiring" || audience === "membershipExpired") {
    const horizon = new Date(now.getTime() + MEMBERSHIP_EXPIRING_DAYS * DAY_MS);
    const floor = new Date(now.getTime() - RECENT_WINDOW_DAYS * DAY_MS);
    const where: Prisma.BarberClientMembershipWhereInput =
      audience === "membershipExpiring"
        ? { barbershopId, status: "ACTIVE", endAt: { gte: now, lte: horizon } }
        : {
            barbershopId,
            // Vencida "de verdad" es la fecha, no el estado: si el estado
            // aún dice ACTIVE porque nadie lo ha recalculado, la membresía
            // ya venció igual. Las dos ramas entran.
            endAt: { gte: floor, lt: now },
            status: { in: ["ACTIVE", "EXPIRED"] },
          };

    const rows = await prisma.barberClientMembership.findMany({
      where: { ...where, barbershopId },
      select: {
        clientId: true,
        endAt: true,
        membership: { select: { name: true } },
      },
      orderBy: { endAt: audience === "membershipExpiring" ? "asc" : "desc" },
      take: CAMPAIGN_AUDIENCE_MAX,
    });

    // Un cliente puede tener más de una membresía en la ventana: se queda
    // con la primera (la más urgente por el orderBy) y no se duplica.
    const seen = new Set<string>();
    const seeds: AudienceSeed[] = [];
    for (const row of rows) {
      if (seen.has(row.clientId)) continue;
      seen.add(row.clientId);
      seeds.push({
        clientId: row.clientId,
        membershipEndAt: row.endAt,
        membershipName: row.membership?.name ?? null,
        rank: seeds.length,
      });
    }
    return { seeds, days: null, month: null };
  }

  if (audience === "loyaltyReward") {
    // Mismo criterio que la vista "reward" de la pantalla de clientes: el
    // contador vivo de la ficha contra el umbral de la barbería. Si aquí se
    // usara otra cuenta, la lista diría una cosa y la ficha otra.
    const rows = await prisma.barberClient.findMany({
      where: {
        barbershopId,
        blockedAt: null,
        loyaltyCount: { gte: clientsConfig.loyaltyThreshold },
      },
      select: { id: true, loyaltyCount: true },
      orderBy: [{ loyaltyCount: "desc" }],
      take: CAMPAIGN_AUDIENCE_MAX,
    });
    return {
      seeds: rows.map((r, i) => ({ clientId: r.id, rank: i })),
      days: null,
      month: null,
    };
  }

  // noShow
  const floor = new Date(now.getTime() - RECENT_WINDOW_DAYS * DAY_MS);
  const grouped = await prisma.barberAppointment.groupBy({
    by: ["clientId"],
    where: {
      barbershopId,
      status: "NO_SHOW",
      startAt: { gte: floor },
      clientId: { not: null },
    },
    _count: { _all: true },
  });
  const seeds = grouped
    .filter((g) => g.clientId && g._count._all >= NO_SHOW_MIN)
    .sort((a, b) => b._count._all - a._count._all)
    .slice(0, CAMPAIGN_AUDIENCE_MAX)
    .map((g, i) => ({ clientId: g.clientId as string, noShowCount: g._count._all, rank: i }));
  return { seeds, days: null, month: null };
}

/**
 * La lista de una campaña, YA filtrada y ordenada, con el motivo de cada
 * exclusión. Es la única función que decide a quién se le puede escribir:
 * el envío vuelve a llamarla, así que nadie puede mandar por fuera de estas
 * reglas mandando ids a mano en el body.
 */
export async function listBarberCampaignAudience(
  ctx: BarberContext,
  args: { audience: BarberCampaignAudience; month?: number; days?: number },
): Promise<BarberCampaignAudienceResult> {
  const barbershopId = ctx.barbershopId;
  const def = barberCampaignAudienceDef(args.audience);
  if (!def) throw new Error(`Audiencia desconocida: ${args.audience}`);

  const [clientsConfig, config] = await Promise.all([
    getBarberClientsConfig(ctx),
    getBarberCampaignConfig(ctx),
  ]);

  const { seeds, days, month } = await seedsForAudience(ctx, args.audience, clientsConfig, args);
  const skipped: Record<CampaignSkipReason, number> = {
    optOut: 0,
    blocked: 0,
    noPhone: 0,
    alreadySent: 0,
    cooldown: 0,
  };

  const templateName = barberWaTemplate(def.templateKind).name;
  if (seeds.length === 0) {
    return { audience: args.audience, templateName, targets: [], skipped, days, month };
  }

  const ids = seeds.map((s) => s.clientId);
  // El `barbershopId` se repite en la llamada a propósito aunque el id ya
  // venga de una lista de esta barbería: el filtro de inquilino tiene que
  // verse EN el query, no deducirse de dos saltos atras.
  const [rows, spend] = await Promise.all([
    prisma.barberClient.findMany({
      where: { barbershopId, id: { in: ids } },
      select: CLIENT_PICK,
    }),
    prisma.barberSale.groupBy({
      by: ["clientId"],
      where: { barbershopId, clientId: { in: ids }, ...NOT_CANCELLED },
      _sum: { total: true },
    }),
  ]);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const spentById = new Map<string, number>();
  for (const g of spend) {
    if (g.clientId) spentById.set(g.clientId, Number(g._sum.total ?? 0));
  }

  const now = Date.now();
  const repeatFloor = now - def.repeatAfterDays * DAY_MS;
  const cooldownFloor = now - config.cooldownDays * DAY_MS;

  const targets: BarberCampaignTarget[] = [];
  for (const seed of seeds) {
    const row = byId.get(seed.clientId);
    if (!row) continue;

    const ledger = readCampaignLedger(row.preferences);
    const lastSentIso = ledger.last[args.audience] ?? null;
    const target = buildTarget(row, seed, spentById.get(row.id) ?? 0, now, lastSentIso);

    // Orden de las reglas: primero lo que es una decisión del cliente
    // (baja, bloqueo), después lo técnico, y al final los candados de
    // frecuencia. Así el motivo que se enseña es el más importante.
    let reason: CampaignSkipReason | null = null;
    if (readCampaignOptOut(row.preferences)) reason = "optOut";
    else if (row.blockedAt) reason = "blocked";
    else if (!mxTenDigits(row.phone)) reason = "noPhone";
    else if (lastSentIso && Date.parse(lastSentIso) > repeatFloor) reason = "alreadySent";
    else if (ledger.lastAnyAt && Date.parse(ledger.lastAnyAt) > cooldownFloor) {
      reason = "cooldown";
    }

    if (reason) skipped[reason]++;
    targets.push({ ...target, eligible: reason === null, skipReason: reason });
  }

  // Los inactivos se ordenan por lo que gastaban: si solo alcanza para
  // escribirle a 60, que sean los 60 que más valían. En las demás
  // audiencias manda el orden natural de la lista (día del cumpleaños,
  // fecha de vencimiento, número de faltas).
  if (args.audience === "inactive") {
    targets.sort((a, b) => b.spentMxn - a.spentMxn);
  }

  return { audience: args.audience, templateName, targets, skipped, days, month };
}

function buildTarget(
  row: ClientPick,
  seed: AudienceSeed,
  spentMxn: number,
  now: number,
  lastSentIso: string | null,
): Omit<BarberCampaignTarget, "eligible" | "skipReason"> {
  return {
    clientId: row.id,
    name: row.name,
    phone: row.phone,
    lastVisitAt: row.lastVisitAt ? row.lastVisitAt.toISOString() : null,
    daysSinceLastVisit: row.lastVisitAt
      ? Math.floor((now - row.lastVisitAt.getTime()) / DAY_MS)
      : null,
    totalVisits: row.totalVisits,
    loyaltyCount: row.loyaltyCount,
    spentMxn,
    birthdayDay: row.birthday ? row.birthday.getUTCDate() : null,
    membershipEndAt: seed.membershipEndAt ? seed.membershipEndAt.toISOString() : null,
    membershipName: seed.membershipName ?? null,
    noShowCount: seed.noShowCount ?? 0,
    lastSentAt: lastSentIso,
  };
}

// ── Vista previa del texto final ───────────────────────────────────────

export interface CampaignPreview {
  /** Nombre real de un cliente de la lista, para ver el texto de verdad. */
  sampleName: string | null;
  promo: string;
  /** El mensaje COMPLETO tal como le llega al cliente. */
  text: string;
}

/**
 * Datos que solo se necesitan para las fichas del texto ({servicio},
 * {barbero}): la última visita atendida de cada cliente. Se piden en UNA
 * lectura para toda la tanda, no una por cliente.
 */
async function lastServiceByClient(
  barbershopId: string,
  clientIds: string[],
): Promise<Map<string, { servicio: string; barbero: string }>> {
  const out = new Map<string, { servicio: string; barbero: string }>();
  if (clientIds.length === 0) return out;

  const rows = await prisma.barberAppointment.findMany({
    where: { barbershopId, clientId: { in: clientIds }, status: "DONE" },
    select: {
      clientId: true,
      startAt: true,
      barber: { select: { name: true, nickname: true } },
      services: { select: { service: { select: { name: true } } }, take: 1 },
    },
    orderBy: { startAt: "desc" },
    // Varias citas por cliente: se recorre de la más nueva a la más vieja y
    // se conserva la primera de cada uno.
    take: Math.min(1000, clientIds.length * 4),
  });

  for (const row of rows) {
    if (!row.clientId || out.has(row.clientId)) continue;
    out.set(row.clientId, {
      servicio: row.services[0]?.service?.name ?? "",
      barbero: row.barber?.nickname || row.barber?.name || "",
    });
  }
  return out;
}

// ── Envío ──────────────────────────────────────────────────────────────

/**
 * Tope por tanda. Se RE-EXPORTA el del emisor en vez de copiar el número:
 * si T7 cambia su tope, la pantalla y el candado cambian con él.
 */
export { CAMPAIGN_BATCH_MAX };

export interface CampaignSendResult {
  sent: number;
  failed: number;
  /** Quedaron fuera por una regla (baja, repetido, descanso, sin cupo). */
  skipped: number;
  /** Motivo por cliente, para poder decir exactamente qué pasó. */
  detail: { clientId: string; name: string; ok: boolean; reason: string | null }[];
  cost: BarberCampaignCost;
  /** true = se cortó porque se acabó el cupo de mensajes del plan. */
  quotaExhausted: boolean;
}

export interface SendCampaignArgs {
  audience: BarberCampaignAudience;
  clientIds: string[];
  /** Texto de la promoción. Si viene vacío se usa la plantilla guardada. */
  promo?: string;
  month?: number;
  days?: number;
}

/**
 * Manda la campaña. TRES cosas que no se negocian:
 *
 * 1. La lista de elegibles se vuelve a calcular AQUÍ. Los `clientIds` del
 *    body solo pueden RESTRINGIR esa lista, nunca ampliarla: un id de otra
 *    barbería, un dado de baja o un repetido no entran aunque el navegador
 *    los mande.
 * 2. El envío real es de T7 (sendBarberCampaign): descuenta cupo, crea la
 *    fila de BarberMessage y habla con Meta. Aquí no hay un segundo emisor.
 *    Se llama UNA VEZ POR CLIENTE porque cada uno lleva su propio texto
 *    (las fichas {servicio}/{barbero} son personales) y porque así se sabe
 *    exactamente quién falló, no solo cuántos.
 * 3. La bitácora se escribe SOLO si el mensaje salió. Un fallo no quema el
 *    turno del cliente: se le puede volver a intentar.
 */
export async function sendBarberCampaignRun(
  ctx: BarberContext,
  args: SendCampaignArgs,
): Promise<CampaignSendResult> {
  const barbershopId = ctx.barbershopId;
  const def = barberCampaignAudienceDef(args.audience);
  if (!def) throw new Error(`Audiencia desconocida: ${args.audience}`);

  const [config, audienceList] = await Promise.all([
    getBarberCampaignConfig(ctx),
    listBarberCampaignAudience(ctx, {
      audience: args.audience,
      month: args.month,
      days: args.days,
    }),
  ]);

  const wanted = new Set(args.clientIds.filter((id) => typeof id === "string" && id));
  const eligible = audienceList.targets.filter((t) => t.eligible && wanted.has(t.clientId));
  const requestedButNotEligible = wanted.size - eligible.length;

  const batch = eligible.slice(0, CAMPAIGN_BATCH_MAX);
  const cost = estimateBarberCampaignCost(batch.length);

  const promoTemplate =
    sanitizeCampaignPromo(args.promo) || config.templates[args.audience];

  const [extras, clientsConfig] = await Promise.all([
    lastServiceByClient(
      barbershopId,
      batch.map((t) => t.clientId),
    ),
    getBarberClientsConfig(ctx),
  ]);

  const detail: CampaignSendResult["detail"] = [];
  let sent = 0;
  let failed = 0;
  let quotaExhausted = false;

  for (const target of batch) {
    if (quotaExhausted) {
      detail.push({ clientId: target.clientId, name: target.name, ok: false, reason: "quota" });
      continue;
    }

    const extra = extras.get(target.clientId);
    const promo = renderCampaignPromo(promoTemplate, {
      nombre: campaignFirstName(target.name),
      barberia: ctx.barbershop.name,
      servicio: extra?.servicio ?? "",
      barbero: extra?.barbero ?? "",
      dias: target.daysSinceLastVisit === null ? "" : String(target.daysSinceLastVisit),
      premio: clientsConfig.loyaltyReward,
      vence: formatShortDate(target.membershipEndAt, ctx.barbershop.locale),
    });

    // Una llamada por cliente: cada uno lleva su propio texto.
    const result = await sendBarberCampaign({
      barbershopId,
      kind: def.templateKind,
      promo,
      clientIds: [target.clientId],
    });

    if (result.sent === 1) {
      sent++;
      detail.push({ clientId: target.clientId, name: target.name, ok: true, reason: null });
      await stampLedger(barbershopId, target.clientId, args.audience);
    } else if (result.failed === 1) {
      failed++;
      detail.push({ clientId: target.clientId, name: target.name, ok: false, reason: "failed" });
    } else {
      // skipped del emisor = o no hay cupo, o no hay conexión de WhatsApp,
      // o la ficha dejó de ser elegible entre el cálculo y el envío.
      quotaExhausted = true;
      detail.push({ clientId: target.clientId, name: target.name, ok: false, reason: "quota" });
    }
  }

  return {
    sent,
    failed,
    skipped: detail.length - sent - failed + Math.max(0, requestedButNotEligible),
    detail,
    cost: { ...cost, messages: sent, totalUsd: Number((sent * cost.unitUsd).toFixed(4)) },
    quotaExhausted,
  };
}

function formatShortDate(iso: string | null, locale: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
      day: "numeric",
      month: "long",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

/**
 * Deja constancia de que a este cliente ya le tocó esta campaña. Se lee la
 * fila justo antes de escribir para no pisar otras llaves reservadas
 * (lealtad, bloqueo) que hayan cambiado mientras corría la tanda.
 */
async function stampLedger(
  barbershopId: string,
  clientId: string,
  audience: BarberCampaignAudience,
): Promise<void> {
  try {
    const row = await prisma.barberClient.findFirst({
      where: { id: clientId, barbershopId },
      select: { id: true, preferences: true },
    });
    if (!row) return;
    const next = ledgerWith(
      readCampaignLedger(row.preferences),
      audience,
      new Date().toISOString(),
    );
    await prisma.barberClient.update({
      where: { id: row.id },
      data: {
        preferences: withReservedPreference(row.preferences, CAMPAIGN_LEDGER_KEY, next),
      },
    });
  } catch (e) {
    // El mensaje YA salió: que falle la bitácora no puede tumbar la tanda.
    // Se avisa fuerte porque el precio de perderla es un repetido.
    console.error("[barber/campaigns] no se pudo anotar la bitácora:", (e as Error).message);
  }
}

// ── Resultados: qué se mandó y quién volvió ────────────────────────────

export interface CampaignHistoryRow {
  /** Día (ISO, YYYY-MM-DD) en el que salió la tanda. */
  day: string;
  templateName: string;
  audienceLabel: string | null;
  messages: number;
  delivered: number;
  failed: number;
  costUsd: number;
  /** Cuántos de esos clientes volvieron DESPUÉS de recibir el mensaje. */
  returned: number;
}

export interface CampaignHistory {
  rows: CampaignHistoryRow[];
  totals: {
    messages: number;
    delivered: number;
    failed: number;
    costUsd: number;
    returned: number;
  };
  /** Días hacia atrás que cubre el reporte. */
  windowDays: number;
}

export const HISTORY_WINDOW_DAYS = 120;

/**
 * El recibo de las campañas. Sale de las filas REALES de BarberMessage que
 * creó el emisor — no de una bitácora paralela que podría mentir.
 *
 * "Volvió" = el cliente tuvo una visita DESPUÉS de recibir el mensaje. Es
 * la única cifra que le dice al dueño si la campaña sirvió, y sin ella no
 * hay razón para volver a usarla. Visita = cita en DONE o venta con
 * servicio (misma definición que la ficha del cliente).
 */
export async function listBarberCampaignHistory(
  ctx: BarberContext,
): Promise<CampaignHistory> {
  const barbershopId = ctx.barbershopId;
  const since = new Date(Date.now() - HISTORY_WINDOW_DAYS * DAY_MS);

  const messages = await prisma.barberMessage.findMany({
    where: {
      barbershopId,
      direction: "OUTBOUND",
      templateName: { in: CAMPAIGN_TEMPLATE_NAMES },
      createdAt: { gte: since },
    },
    select: {
      clientId: true,
      templateName: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  const clientIds = Array.from(
    new Set(messages.map((m) => m.clientId).filter((id): id is string => Boolean(id))),
  );

  // "Volvió" se calcula con la ÚLTIMA visita de cada cliente: si su última
  // visita es posterior al mensaje, volvió. Dos lecturas para toda la
  // tabla, no una por mensaje.
  const [appts, sales] = clientIds.length
    ? await Promise.all([
        prisma.barberAppointment.groupBy({
          by: ["clientId"],
          where: { barbershopId, clientId: { in: clientIds }, status: "DONE" },
          _max: { startAt: true },
        }),
        prisma.barberSale.groupBy({
          by: ["clientId"],
          where: {
            barbershopId,
            clientId: { in: clientIds },
            items: { some: { serviceId: { not: null } } },
            ...NOT_CANCELLED,
          },
          _max: { createdAt: true },
        }),
      ])
    : [[], []];

  const lastVisit = new Map<string, number>();
  const bump = (id: string | null, at: Date | null | undefined) => {
    if (!id || !at) return;
    const prev = lastVisit.get(id) ?? 0;
    if (at.getTime() > prev) lastVisit.set(id, at.getTime());
  };
  for (const g of appts) bump(g.clientId, g._max.startAt);
  for (const g of sales) bump(g.clientId, g._max.createdAt);

  const unit = BARBER_WA_PRICE_USD.MARKETING;
  const byKey = new Map<string, CampaignHistoryRow>();

  for (const msg of messages) {
    const day = msg.createdAt.toISOString().slice(0, 10);
    const key = `${day}|${msg.templateName ?? ""}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        day,
        templateName: msg.templateName ?? "",
        audienceLabel: null,
        messages: 0,
        delivered: 0,
        failed: 0,
        costUsd: 0,
        returned: 0,
      };
      byKey.set(key, row);
    }
    row.messages++;
    if (msg.status === "FAILED") row.failed++;
    // Meta cobra el mensaje ENTREGADO. Un FAILED no se cobra.
    else row.delivered++;

    const visitedAt = msg.clientId ? lastVisit.get(msg.clientId) : undefined;
    if (visitedAt && visitedAt > msg.createdAt.getTime()) row.returned++;
  }

  const rows = Array.from(byKey.values())
    .map((r) => ({ ...r, costUsd: Number((r.delivered * unit).toFixed(4)) }))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));

  const totals = rows.reduce(
    (acc, r) => ({
      messages: acc.messages + r.messages,
      delivered: acc.delivered + r.delivered,
      failed: acc.failed + r.failed,
      costUsd: Number((acc.costUsd + r.costUsd).toFixed(4)),
      returned: acc.returned + r.returned,
    }),
    { messages: 0, delivered: 0, failed: 0, costUsd: 0, returned: 0 },
  );

  return { rows, totals, windowDays: HISTORY_WINDOW_DAYS };
}

// ── Bajas: la lista para poder verlas y revertirlas ────────────────────

export interface CampaignOptOutRow {
  clientId: string;
  name: string;
  phone: string;
  optOut: BarberCampaignOptOut;
}

/**
 * Quiénes están dados de baja. Se lee en memoria y no en SQL porque la
 * llave vive dentro del Json `preferences` y un filtro por path de Json
 * sobre una columna sin índice no compra nada a esta escala.
 */
export async function listBarberCampaignOptOuts(
  ctx: BarberContext,
): Promise<CampaignOptOutRow[]> {
  const barbershopId = ctx.barbershopId;
  const rows = await prisma.barberClient.findMany({
    // Solo las fichas que tienen algo en `preferences`: una baja siempre
    // vive ahí, así que las de columna NULL no hace falta ni traerlas.
    where: { barbershopId, preferences: { not: Prisma.DbNull } },
    select: { id: true, name: true, phone: true, preferences: true },
    orderBy: { name: "asc" },
    take: 2000,
  });

  const out: CampaignOptOutRow[] = [];
  for (const row of rows) {
    const optOut = readCampaignOptOut(row.preferences);
    if (!optOut) continue;
    out.push({ clientId: row.id, name: row.name, phone: row.phone, optOut });
  }
  return out;
}
