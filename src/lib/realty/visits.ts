// ═══════════════════════════════════════════════════════════════════════
// VISITAS — servidor. Agenda, reagenda, retroalimentación y recordatorios.
//
// Reglas que esta terminal NO negocia:
//
//  1. accountId SIEMPRE sale de getRealtyContext, nunca del body ni del
//     query. Ojo Prisma: un `undefined` BORRA el filtro, así que hay una
//     guarda explícita (assertRealtyAccountId) en cada entrada.
//
//  2. El recorte por OFICINA va por el inmueble, porque RealtyVisit no
//     tiene officeId. Y va con el OR de los nulos: un inmueble sin oficina
//     asignada sigue siendo de la cuenta, y dejarlo fuera haría desaparecer
//     visitas reales de la pantalla (es el mismo criterio de deals).
//
//  3. Las escrituras van por updateMany con el accountId DENTRO del where.
//     Un `update({ where: { id } })` a secas cruza cuentas.
//
//  4. 🔴 REAGENDAR CANCELA EL RECORDATORIO ANTERIOR. Es el bug M-22 del
//     dental y aquí se cierra llamando a cancelRealtyVisitReminders, que
//     T6 dejó escrita y hasta hoy no tenía un solo llamador.
//
//  5. El envío de WhatsApp NO se reimplementa. Se llama a la función de T6.
//     Este archivo no habla con Meta ni una sola vez.
// ═══════════════════════════════════════════════════════════════════════
import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { RealtyContext } from "@/lib/realty-auth";
import { getAccessibleOfficeIds } from "@/lib/realty-auth";
import { hasRealtyPermission } from "@/lib/realty/permissions";
import { realtyCan } from "@/lib/realty/gating";
import { realtyVisitClaimKey, claimFromExternalId } from "@/lib/realty/whatsapp-core";
import {
  addDaysISO,
  canVisitTransition,
  daysBetween,
  formatVisitFeedback,
  isVisitMovable,
  parseVisitFeedback,
  realtyDateISO,
  realtyLocalToUtc,
  type RealtyVisitAgentDTO,
  type RealtyVisitCardDTO,
  type RealtyVisitOutcome,
  type RealtyVisitStatusKey,
} from "@/components/realty/visits/visit-core";

// ── 0. Errores y guardas ────────────────────────────────────────────────

export type RealtyVisitErrorCode =
  | "NOT_FOUND"
  | "INVALID"
  | "BAD_TRANSITION"
  | "NOT_MOVABLE";

export class RealtyVisitError extends Error {
  readonly code: RealtyVisitErrorCode;
  constructor(code: RealtyVisitErrorCode, message: string) {
    super(message);
    this.name = "RealtyVisitError";
    this.code = code;
  }
}

export function visitErrorStatus(code: RealtyVisitErrorCode): number {
  if (code === "NOT_FOUND") return 404;
  if (code === "BAD_TRANSITION" || code === "NOT_MOVABLE") return 409;
  return 400;
}

/**
 * Guard del área. Se devuelve un objeto y no un NextResponse para poder
 * probarlo sin `next/server`.
 *
 * ⚠️ NO es una unión discriminada, igual que `checkLeadsAccess`: el tsconfig
 * corre con `strict: false` y sin strictNullChecks TypeScript NO estrecha
 * `{ok:true} | {ok:false, error:string}` con un `if (!guard.ok)`.
 *
 * 🔴 Y NO se reusa `checkLeadsAccess`: ése exige `plan.features.leads`, y en
 * el contrato el item `visitas` tiene `featureKey: null` — Visitas NO está
 * gateada por plan. Reusarlo habría apagado la agenda a quien sí la paga.
 * Lo que sí se copia es el corte por MODO: una cuenta de rentista (OWNER)
 * no comercializa para terceros y no tiene agenda de visitas, igual que el
 * `modes: BROKER_MODES` del contrato.
 */
export interface RealtyVisitsGuard {
  ok: boolean;
  status?: 401 | 403;
  error?: string;
}

export function checkVisitsAccess(
  ctx: RealtyContext | null,
  permission: "visits.manage" | "keys.manage",
): RealtyVisitsGuard {
  if (!ctx) return { ok: false, status: 401, error: "No autorizado" };
  if (ctx.mode === "OWNER") {
    return { ok: false, status: 403, error: "Esta sección no aplica a tu tipo de cuenta" };
  }
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, permission)) {
    return { ok: false, status: 403, error: "Sin permiso" };
  }
  return { ok: true };
}

/**
 * Sin esto, un accountId vacío se vuelve `undefined` en el where de Prisma
 * y la consulta devuelve las visitas de TODAS las inmobiliarias.
 */
function assertRealtyAccountId(accountId: string): string {
  if (!accountId || typeof accountId !== "string") {
    throw new Error("realty/visits: accountId ausente — la consulta habría cruzado cuentas");
  }
  return accountId;
}

// ── 1. Alcance ──────────────────────────────────────────────────────────

/**
 * Un ASESOR ve SOLO sus visitas.
 *
 * Mismo criterio que `filtroLeadsDelRol` en las calculadoras y que el
 * embudo: esconder lo ajeno es la dirección segura. Las visitas SIN asesor
 * tampoco se le enseñan — un `userId: X` descarta los nulos y así debe ser:
 * una visita que no tiene dueño puede colgar del prospecto de otro, y la
 * tarjeta pinta el nombre y el teléfono de esa persona.
 *
 * OWNER, MANAGER y ASSISTANT ven la agenda completa de la cuenta: son la
 * mesa de control, y una agenda por asesor sin poder ver a los asesores no
 * sirve de nada.
 */
export function visitRoleWhere(ctx: RealtyContext): { userId?: string } {
  return ctx.role === "AGENT" ? { userId: ctx.realtyUserId } : {};
}

/**
 * El where base: cuenta + oficinas alcanzables + alcance del rol.
 *
 * 🔴 El OR de los nulos NO es opcional. `officeId: { in: [...] }` descarta
 * los inmuebles sin oficina, que en una cuenta de un solo asesor son
 * TODOS: la agenda salía vacía y parecía que no había visitas.
 */
export async function visitScopeWhere(
  ctx: RealtyContext,
): Promise<Prisma.RealtyVisitWhereInput> {
  assertRealtyAccountId(ctx.accountId);
  const officeIds = await getAccessibleOfficeIds(ctx);
  return {
    accountId: ctx.accountId,
    property: { OR: [{ officeId: { in: officeIds } }, { officeId: null }] },
    ...visitRoleWhere(ctx),
  };
}

// ── 2. Lectura ──────────────────────────────────────────────────────────

const VISIT_SELECT = {
  id: true,
  propertyId: true,
  leadId: true,
  userId: true,
  scheduledAt: true,
  status: true,
  feedback: true,
  property: {
    select: {
      title: true,
      address: true,
      colonia: true,
      city: true,
      lat: true,
      lng: true,
      showExactAddress: true,
    },
  },
  lead: { select: { contact: { select: { name: true, phone: true } } } },
  user: { select: { firstName: true, lastName: true } },
} satisfies Prisma.RealtyVisitSelect;

type VisitRow = Prisma.RealtyVisitGetPayload<{ select: typeof VISIT_SELECT }>;

/** Decimal de Prisma → number. null si no hay coordenada utilizable. */
function coord(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fullName(user: { firstName: string; lastName: string } | null): string | null {
  if (!user) return null;
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || null;
}

function toVisitCard(row: VisitRow): RealtyVisitCardDTO {
  const parsed = parseVisitFeedback(row.feedback);
  return {
    id: row.id,
    propertyId: row.propertyId,
    propertyTitle: row.property?.title ?? "—",
    // La dirección exacta es del PANEL: showExactAddress recorta la web
    // pública, no a quien tiene que llegar a enseñar la casa.
    propertyAddress: row.property?.address ?? null,
    propertyColonia: row.property?.colonia ?? null,
    propertyCity: row.property?.city ?? null,
    lat: coord(row.property?.lat),
    lng: coord(row.property?.lng),
    leadId: row.leadId,
    leadName: row.lead?.contact?.name ?? null,
    leadPhone: row.lead?.contact?.phone ?? null,
    userId: row.userId,
    userName: fullName(row.user),
    scheduledAt: row.scheduledAt.toISOString(),
    status: row.status as RealtyVisitStatusKey,
    outcome: parsed.outcome,
    note: parsed.note,
  };
}

export interface RealtyVisitsWindow {
  visits: RealtyVisitCardDTO[];
  agents: RealtyVisitAgentDTO[];
  /** Zona de la CUENTA. La rejilla se dibuja con ésta, no con la del navegador. */
  timeZone: string;
  fromISO: string;
  days: number;
}

/** Tope duro de la ventana: una semana de una agencia grande cabe de sobra. */
const VISITS_WINDOW_TAKE = 500;

/**
 * Las visitas de un rango de días, en la zona de la cuenta.
 *
 * El rango va de la medianoche LOCAL del primer día a la medianoche LOCAL
 * del día siguiente al último: así una visita de las 23:30 sigue dentro.
 * Con `T00:00:00Z` se perdía el último tramo del día en México.
 */
export async function listVisitsWindow(
  ctx: RealtyContext,
  args: { fromISO: string; days: number; userId?: string | null },
): Promise<RealtyVisitsWindow> {
  assertRealtyAccountId(ctx.accountId);
  const timeZone = ctx.account.timezone || "America/Mexico_City";
  const days = Math.max(1, Math.min(31, Math.floor(args.days) || 1));

  const fromUtc = realtyLocalToUtc(args.fromISO, 0, timeZone);
  const toUtc = realtyLocalToUtc(addDaysISO(args.fromISO, days), 0, timeZone);

  const scope = await visitScopeWhere(ctx);
  const where: Prisma.RealtyVisitWhereInput = {
    ...scope,
    scheduledAt: { gte: fromUtc, lt: toUtc },
  };
  // El filtro por asesor de la barra de herramientas se APILA sobre el
  // alcance del rol; nunca lo sustituye. Un AGENT que mande el id de otro
  // en el query sigue viendo solo lo suyo (el where del rol ya está puesto
  // y `userId` se sobrescribiría con el mismo valor o con uno imposible).
  if (args.userId) {
    where.AND = [{ userId: args.userId }];
  }

  const [rows, agents] = await Promise.all([
    prisma.realtyVisit.findMany({
      where,
      select: VISIT_SELECT,
      orderBy: { scheduledAt: "asc" },
      take: VISITS_WINDOW_TAKE,
    }),
    listVisitAgents(ctx),
  ]);

  return {
    visits: rows.map(toVisitCard),
    agents,
    timeZone,
    fromISO: args.fromISO,
    days,
  };
}

/** Los asesores de la cuenta, para el selector y las columnas del día. */
export async function listVisitAgents(ctx: RealtyContext): Promise<RealtyVisitAgentDTO[]> {
  assertRealtyAccountId(ctx.accountId);
  // Un AGENT no necesita el directorio del equipo para ver su propia
  // agenda: se devuelve a sí mismo y ya. Es el mismo criterio de "el
  // permiso da la puerta, la consulta da el alcance".
  if (ctx.role === "AGENT") {
    return [
      {
        id: ctx.realtyUserId,
        name: `${ctx.user.firstName ?? ""} ${ctx.user.lastName ?? ""}`.trim() || "Yo",
      },
    ];
  }
  const rows = await prisma.realtyUser.findMany({
    where: { accountId: ctx.accountId, active: true },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    name: `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || "—",
  }));
}

/**
 * Quita los comodines de LIKE del término de búsqueda.
 *
 * 🔴 Prisma NO escapa `%` ni `_` dentro de `contains`: van directos al LIKE
 * de Postgres. Sin esto, buscar "%" empareja con TODA la cartera y el
 * selector se convierte en un volcado de la base.
 */
function cleanSearch(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export interface VisitTargets {
  properties: { id: string; title: string; colonia: string | null }[];
  leads: { id: string; name: string; phone: string | null }[];
}

/**
 * Lo que hace falta para agendar: inmuebles de la cartera y prospectos.
 *
 * Los prospectos van con el MISMO recorte por rol que el embudo — un AGENT
 * solo ve los suyos. Sin eso, el selector de "a quién le enseño" sería una
 * puerta trasera al directorio de prospectos de los compañeros.
 */
export async function searchVisitTargets(
  ctx: RealtyContext,
  search?: string | null,
): Promise<VisitTargets> {
  assertRealtyAccountId(ctx.accountId);
  const officeIds = await getAccessibleOfficeIds(ctx);
  const term = cleanSearch(search);

  const propWhere: Prisma.RealtyPropertyWhereInput = {
    accountId: ctx.accountId,
    OR: [{ officeId: { in: officeIds } }, { officeId: null }],
  };
  if (term) {
    // El OR de arriba es el de las oficinas; el del buscador va en un AND
    // aparte o se fusionarían y el filtro de oficina dejaría de aplicar.
    propWhere.AND = [
      {
        OR: [
          { title: { contains: term, mode: "insensitive" } },
          { colonia: { contains: term, mode: "insensitive" } },
          { address: { contains: term, mode: "insensitive" } },
        ],
      },
    ];
  }

  const leadWhere: Prisma.RealtyLeadWhereInput = {
    accountId: ctx.accountId,
    ...(ctx.role === "AGENT" ? { assignedUserId: ctx.realtyUserId } : {}),
  };
  if (term) {
    leadWhere.contact = {
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { phone: { contains: term } },
      ],
    };
  }

  const [properties, leads] = await Promise.all([
    prisma.realtyProperty.findMany({
      where: propWhere,
      select: { id: true, title: true, colonia: true },
      orderBy: { title: "asc" },
      take: 40,
    }),
    prisma.realtyLead.findMany({
      where: leadWhere,
      select: { id: true, contact: { select: { name: true, phone: true } } },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);

  return {
    properties,
    leads: leads.map((l) => ({
      id: l.id,
      name: l.contact?.name ?? "—",
      phone: l.contact?.phone ?? null,
    })),
  };
}

/**
 * Las visitas de HOY. Es lo que consume el Inicio y lo que alimenta la ruta
 * del día. Se expone aparte para que la pantalla de Inicio no tenga que
 * saber nada de rangos ni de zonas horarias.
 */
export async function getTodayVisits(ctx: RealtyContext): Promise<RealtyVisitsWindow> {
  const timeZone = ctx.account.timezone || "America/Mexico_City";
  return listVisitsWindow(ctx, { fromISO: realtyDateISO(new Date(), timeZone), days: 1 });
}

/** La oficina desde la que arranca la ruta del día: la principal accesible. */
export async function getRouteOrigin(
  ctx: RealtyContext,
): Promise<{ name: string; query: string; lat: number | null; lng: number | null } | null> {
  assertRealtyAccountId(ctx.accountId);
  const officeIds = await getAccessibleOfficeIds(ctx);
  if (officeIds.length === 0) return null;
  const office = await prisma.realtyOffice.findFirst({
    where: { id: officeIds[0], accountId: ctx.accountId },
    select: { name: true, address: true, lat: true, lng: true },
  });
  if (!office) return null;
  const lat = coord(office.lat);
  const lng = coord(office.lng);
  const query = office.address ?? (lat !== null && lng !== null ? `${lat},${lng}` : "");
  if (!query) return null;
  return { name: office.name, query, lat, lng };
}

// ── 3. Escrituras ───────────────────────────────────────────────────────

/**
 * Carga una visita DENTRO del alcance. Devuelve null si no es de la cuenta,
 * no es de una oficina alcanzable, o es de otro asesor y quien pregunta es
 * un AGENT. Es la puerta única de toda escritura.
 */
async function loadVisitInScope(ctx: RealtyContext, visitId: string) {
  const scope = await visitScopeWhere(ctx);
  return prisma.realtyVisit.findFirst({
    where: { ...scope, id: visitId },
    select: {
      id: true,
      accountId: true,
      leadId: true,
      userId: true,
      propertyId: true,
      scheduledAt: true,
      status: true,
      feedback: true,
      property: { select: { title: true } },
    },
  });
}

/** Valida que un asesor sea de ESTA cuenta antes de asignarle nada. */
async function resolveAgent(
  ctx: RealtyContext,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null;
  // 🔴 La FK de RealtyVisit.userId es global, no compuesta: cualquier
  // RealtyUser.id del planeta la satisface. Sin este check, mandar el id de
  // un empleado de otra inmobiliaria pintaba su nombre en la tarjeta.
  const target = await prisma.realtyUser.findFirst({
    where: { id: userId, accountId: ctx.accountId, active: true },
    select: { id: true },
  });
  if (!target) throw new RealtyVisitError("INVALID", "Ese asesor no existe en tu cuenta");
  return target.id;
}

/** Escribe en la bitácora del prospecto, si la visita tiene prospecto. */
async function logVisitActivity(
  accountId: string,
  leadId: string | null,
  kind: "VISITA" | "NOTA" | "CORREO" | "WHATSAPP",
  note: string,
  byUserId: string | null,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  // leadId es nullable en RealtyVisit: una visita puede no tener prospecto
  // (un curioso que llamó al letrero). Sin prospecto no hay bitácora, y no
  // pasa nada — lo que no puede es reventar la operación.
  if (!leadId) return;
  await tx.realtyLeadActivity.create({ data: { accountId, leadId, kind, note, userId: byUserId } });
}

export interface CreateVisitInput {
  propertyId: string;
  leadId?: string | null;
  userId?: string | null;
  scheduledAt: Date;
}

/**
 * Alta de una visita desde la agenda o desde la ficha del inmueble.
 *
 * (La ficha del PROSPECTO ya tenía su propia alta desde T2:
 * `scheduleVisitFromLead` en leads.ts, que además avanza el embudo. No se
 * duplica aquí — esa sigue siendo la puerta desde el prospecto.)
 */
export async function createVisit(
  ctx: RealtyContext,
  input: CreateVisitInput,
): Promise<string> {
  assertRealtyAccountId(ctx.accountId);

  const officeIds = await getAccessibleOfficeIds(ctx);
  const property = await prisma.realtyProperty.findFirst({
    where: {
      id: input.propertyId,
      accountId: ctx.accountId,
      OR: [{ officeId: { in: officeIds } }, { officeId: null }],
    },
    select: { id: true, title: true },
  });
  if (!property) throw new RealtyVisitError("INVALID", "Ese inmueble no está en tu cartera");

  let leadId: string | null = null;
  if (input.leadId) {
    const lead = await prisma.realtyLead.findFirst({
      where: { id: input.leadId, accountId: ctx.accountId },
      select: { id: true },
    });
    if (!lead) throw new RealtyVisitError("INVALID", "Ese prospecto no es de tu cuenta");
    leadId = lead.id;
  }

  // Un AGENT solo se agenda a sí mismo: si pudiera poner a otro, se saltaría
  // el recorte de rol por la puerta de atrás (la visita dejaría de ser suya
  // y desaparecería de su propia agenda).
  const asked = ctx.role === "AGENT" ? ctx.realtyUserId : input.userId;
  const userId = (await resolveAgent(ctx, asked)) ?? (ctx.role === "AGENT" ? ctx.realtyUserId : null);

  const visit = await prisma.$transaction(async (tx) => {
    const v = await tx.realtyVisit.create({
      data: {
        accountId: ctx.accountId,
        propertyId: property.id,
        leadId,
        userId,
        scheduledAt: input.scheduledAt,
        status: "PROGRAMADA",
      },
      select: { id: true },
    });
    await logVisitActivity(
      ctx.accountId,
      leadId,
      "VISITA",
      `Visita agendada a ${property.title}`,
      ctx.realtyUserId,
      tx,
    );
    return v;
  });
  return visit.id;
}

export interface MoveVisitResult {
  visit: RealtyVisitCardDTO;
  /** Cuántos recordatorios sin salir se cancelaron. La UI lo DICE. */
  remindersCancelled: number;
}

/**
 * Mueve una visita de hora (arrastrar en el calendario) y opcionalmente de
 * asesor (soltarla en otra columna).
 *
 * 🔴 AQUÍ VIVE EL ARREGLO DEL M-22.
 *
 * El bug del dental era: se reagenda la cita y el recordatorio viejo, que
 * ya estaba encolado con la hora anterior, sale igual. El prospecto recibe
 * DOS avisos con dos horas distintas y no sabe a cuál hacerle caso.
 *
 * En este vertical hay dos cerrojos, y los dos hacen falta:
 *
 *   · El de T6, por construcción: la llave de idempotencia del recordatorio
 *     LLEVA DENTRO la hora (realtyVisitClaimKey), así que al mover la visita
 *     la llave cambia y el aviso nuevo no queda bloqueado por el viejo.
 *
 *   · El de aquí, explícito: cancelRealtyVisitReminders marca como fallidos
 *     los avisos que se quedaron a medio salir con la hora anterior. T6 la
 *     dejó escrita y documentada ("quien reagenda debe llamar a…") y hasta
 *     esta terminal NO TENÍA UN SOLO LLAMADOR.
 *
 * ORDEN: primero se mueve, después se cancela. Al revés hay una rendija —
 * entre cancelar y mover, un cron podría reclamar el aviso con la hora
 * VIEJA y ése ya no lo barre nadie. Cancelando después, cualquier aviso
 * reclamado en medio lleva la hora NUEVA (y además ya salió, así que no
 * está PENDING y la cancelación no lo toca).
 */
export async function moveVisit(
  ctx: RealtyContext,
  visitId: string,
  args: { scheduledAt: Date; userId?: string | null },
): Promise<MoveVisitResult> {
  assertRealtyAccountId(ctx.accountId);
  const current = await loadVisitInScope(ctx, visitId);
  if (!current) throw new RealtyVisitError("NOT_FOUND", "Esa visita no existe o no es tuya");

  if (!isVisitMovable(current.status as RealtyVisitStatusKey)) {
    throw new RealtyVisitError(
      "NOT_MOVABLE",
      "Esa visita ya se cerró. Vuélvela a programar si hay que rehacerla.",
    );
  }

  const movedTime = current.scheduledAt.getTime() !== args.scheduledAt.getTime();
  // `undefined` deja el asesor como estaba; un `null` explícito lo quita.
  let nextUserId: string | null | undefined = undefined;
  if (args.userId !== undefined) {
    nextUserId = ctx.role === "AGENT" ? ctx.realtyUserId : await resolveAgent(ctx, args.userId);
  }

  // ⚠️ `Unchecked` y no `UpdateManyMutationInput`: `userId` es la LLAVE de una
  // relación, y Prisma la deja fuera del input "checked" (ahí solo van los
  // escalares puros). Sin la variante Unchecked no hay forma de reasignar el
  // asesor en un updateMany, que es justo lo que hace soltar la tarjeta en
  // otra columna.
  const data: Prisma.RealtyVisitUncheckedUpdateManyInput = { scheduledAt: args.scheduledAt };
  if (nextUserId !== undefined) data.userId = nextUserId;

  const res = await prisma.realtyVisit.updateMany({
    where: { id: visitId, accountId: ctx.accountId },
    data,
  });
  if (res.count === 0) throw new RealtyVisitError("NOT_FOUND", "Esa visita ya no existe");

  let remindersCancelled = 0;
  if (movedTime) {
    const { cancelRealtyVisitReminders } = await import("@/lib/realty/whatsapp");
    remindersCancelled = await cancelRealtyVisitReminders({
      accountId: ctx.accountId,
      visitId,
    });
    await logVisitActivity(
      ctx.accountId,
      current.leadId,
      "VISITA",
      `Visita reagendada a ${args.scheduledAt.toISOString()}`,
      ctx.realtyUserId,
    ).catch(() => {
      /* la bitácora es un extra: no puede tumbar el movimiento */
    });
  }

  const fresh = await prisma.realtyVisit.findFirst({
    where: { id: visitId, accountId: ctx.accountId },
    select: VISIT_SELECT,
  });
  if (!fresh) throw new RealtyVisitError("NOT_FOUND", "Esa visita ya no existe");
  return { visit: toVisitCard(fresh), remindersCancelled };
}

export interface SetVisitStatusResult {
  visit: RealtyVisitCardDTO;
  remindersCancelled: number;
}

/**
 * Cambia el estado. Si se marca REALIZADA, se guarda además la
 * retroalimentación en dos toques (resultado + nota libre).
 *
 * Cancelar TAMBIÉN cancela el recordatorio: una visita cancelada ya no sale
 * del barrido de T6 (filtra por PROGRAMADA/CONFIRMADA), pero si se canceló
 * justo mientras un aviso se estaba mandando, ese aviso se queda PENDING
 * para siempre y el panel enseña "por salir" de algo que no va a salir.
 */
export async function setVisitStatus(
  ctx: RealtyContext,
  visitId: string,
  status: RealtyVisitStatusKey,
  feedback?: { outcome: RealtyVisitOutcome | null; note: string | null } | null,
): Promise<SetVisitStatusResult> {
  assertRealtyAccountId(ctx.accountId);
  const current = await loadVisitInScope(ctx, visitId);
  if (!current) throw new RealtyVisitError("NOT_FOUND", "Esa visita no existe o no es tuya");

  const from = current.status as RealtyVisitStatusKey;
  if (!canVisitTransition(from, status)) {
    throw new RealtyVisitError("BAD_TRANSITION", "Ese cambio de estado no tiene sentido");
  }

  const data: Prisma.RealtyVisitUpdateManyMutationInput = { status };
  if (feedback !== undefined && feedback !== null) {
    data.feedback = formatVisitFeedback(feedback.outcome, feedback.note);
  }

  const res = await prisma.realtyVisit.updateMany({
    where: { id: visitId, accountId: ctx.accountId },
    data,
  });
  if (res.count === 0) throw new RealtyVisitError("NOT_FOUND", "Esa visita ya no existe");

  let remindersCancelled = 0;
  if (status === "CANCELADA") {
    const { cancelRealtyVisitReminders } = await import("@/lib/realty/whatsapp");
    remindersCancelled = await cancelRealtyVisitReminders({
      accountId: ctx.accountId,
      visitId,
    });
  }

  const note = statusActivityNote(status, current.property?.title ?? "", feedback);
  if (note) {
    await logVisitActivity(ctx.accountId, current.leadId, "VISITA", note, ctx.realtyUserId).catch(
      () => {},
    );
  }

  const fresh = await prisma.realtyVisit.findFirst({
    where: { id: visitId, accountId: ctx.accountId },
    select: VISIT_SELECT,
  });
  if (!fresh) throw new RealtyVisitError("NOT_FOUND", "Esa visita ya no existe");
  return { visit: toVisitCard(fresh), remindersCancelled };
}

const OUTCOME_NOTE: Record<RealtyVisitOutcome, string> = {
  LE_GUSTO: "Le gustó",
  PRECIO_ALTO: "Le gustó, pero el precio se le hizo alto",
  NO_LE_GUSTO: "No le gustó",
  NO_ERA: "No era lo que buscaba",
};

function statusActivityNote(
  status: RealtyVisitStatusKey,
  propertyTitle: string,
  feedback?: { outcome: RealtyVisitOutcome | null; note: string | null } | null,
): string | null {
  const casa = propertyTitle ? ` a ${propertyTitle}` : "";
  if (status === "REALIZADA") {
    const partes: string[] = [`Visita realizada${casa}`];
    if (feedback && feedback.outcome) partes.push(OUTCOME_NOTE[feedback.outcome]);
    if (feedback && feedback.note) partes.push(feedback.note);
    return partes.join(". ");
  }
  if (status === "NO_ASISTIO") return `No llegó a la visita${casa}`;
  if (status === "CANCELADA") return `Visita cancelada${casa}`;
  if (status === "CONFIRMADA") return `Confirmó la visita${casa}`;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// 4. REPORTE AL PROPIETARIO — 🔴 CONTRATO CON O2-T5
//
// Esta es la función que consume la terminal del reporte al propietario. Su
// firma NO cambia sin avisar: es una frontera entre olas.
//
//   import { getPropertyVisitReport } from "@/lib/realty/visits";
//   const r = await getPropertyVisitReport({ accountId, propertyId });
//
// Devuelve el conteo por resultado y un titular honesto en español de
// México ("7 visitas y 4 dijeron que el precio está arriba"). El titular es
// null cuando la muestra no alcanza: con dos visitas no se le dice a un
// propietario que su casa está cara.
// ═══════════════════════════════════════════════════════════════════════

export interface RealtyPropertyVisitReport {
  propertyId: string;
  /** Todas las visitas del periodo, sin importar el estado. */
  total: number;
  realizadas: number;
  noAsistio: number;
  canceladas: number;
  /** PROGRAMADA + CONFIRMADA que todavía no ocurren. */
  pendientes: number;
  /** Realizadas que además dejaron resultado capturado. */
  conRetroalimentacion: number;
  outcomes: Record<RealtyVisitOutcome, number>;
  /** El titular ya redactado. null si la muestra es demasiado chica. */
  headline: string | null;
  /** Lo que dijo la gente, lo más reciente primero. */
  notes: {
    visitId: string;
    at: string;
    outcome: RealtyVisitOutcome | null;
    note: string;
  }[];
  lastVisitAt: string | null;
}

/** Mínimo de opiniones para decirle algo a un propietario sobre su precio. */
export const REALTY_REPORT_MIN_SAMPLE = 3;

/**
 * Retroalimentación agregada de UN inmueble.
 *
 * `accountId` es obligatorio y entra al where: aunque el llamador se
 * equivoque de propietario, jamás salen visitas de otra cuenta.
 *
 * ⚠️ NO recorta por OFICINA ni por ROL, y es a propósito: el reporte se le
 * manda AL PROPIETARIO del inmueble, que quiere saber de SU casa completa,
 * no del trozo que ve el asesor que la esté enseñando esta semana. Quien
 * llame ya tuvo que resolver el inmueble dentro de su alcance — que es el
 * único lugar donde ese recorte significa algo.
 */
export async function getPropertyVisitReport(args: {
  accountId: string;
  propertyId: string;
  /** Desde cuándo contar. Por defecto, todo el historial. */
  since?: Date | null;
  /** Cuántas notas libres devolver. Por defecto 10. */
  maxNotes?: number;
}): Promise<RealtyPropertyVisitReport> {
  assertRealtyAccountId(args.accountId);

  const rows = await prisma.realtyVisit.findMany({
    where: {
      accountId: args.accountId,
      propertyId: args.propertyId,
      ...(args.since ? { scheduledAt: { gte: args.since } } : {}),
    },
    select: { id: true, scheduledAt: true, status: true, feedback: true },
    orderBy: { scheduledAt: "desc" },
    take: 400,
  });

  const outcomes: Record<RealtyVisitOutcome, number> = {
    LE_GUSTO: 0,
    PRECIO_ALTO: 0,
    NO_LE_GUSTO: 0,
    NO_ERA: 0,
  };
  const notes: RealtyPropertyVisitReport["notes"] = [];
  const maxNotes = typeof args.maxNotes === "number" ? args.maxNotes : 10;

  let realizadas = 0;
  let noAsistio = 0;
  let canceladas = 0;
  let pendientes = 0;
  let conRetro = 0;
  let lastVisitAt: string | null = null;

  const now = Date.now();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const st = r.status as RealtyVisitStatusKey;
    if (st === "REALIZADA") realizadas++;
    else if (st === "NO_ASISTIO") noAsistio++;
    else if (st === "CANCELADA") canceladas++;
    else if (r.scheduledAt.getTime() >= now) pendientes++;

    if (st === "REALIZADA" && lastVisitAt === null) lastVisitAt = r.scheduledAt.toISOString();

    const parsed = parseVisitFeedback(r.feedback);
    if (parsed.outcome) {
      outcomes[parsed.outcome]++;
      conRetro++;
    }
    if (parsed.note && notes.length < maxNotes) {
      notes.push({
        visitId: r.id,
        at: r.scheduledAt.toISOString(),
        outcome: parsed.outcome,
        note: parsed.note,
      });
    }
  }

  return {
    propertyId: args.propertyId,
    total: rows.length,
    realizadas,
    noAsistio,
    canceladas,
    pendientes,
    conRetroalimentacion: conRetro,
    outcomes,
    headline: buildReportHeadline(realizadas, conRetro, outcomes),
    notes,
    lastVisitAt,
  };
}

/**
 * El titular. Se calla cuando no tiene con qué hablar.
 *
 * El orden importa: el precio se menciona primero porque es el único
 * hallazgo sobre el que el propietario puede ACTUAR. "No era lo que
 * buscaban" es un problema de a quién se le está enseñando, no del
 * inmueble, y decirlo como si fuera lo mismo confunde.
 */
export function buildReportHeadline(
  realizadas: number,
  conRetroalimentacion: number,
  outcomes: Record<RealtyVisitOutcome, number>,
): string | null {
  if (conRetroalimentacion < REALTY_REPORT_MIN_SAMPLE) return null;
  const visitas = `${realizadas} ${realizadas === 1 ? "visita" : "visitas"}`;

  if (outcomes.PRECIO_ALTO >= Math.ceil(conRetroalimentacion / 2)) {
    return `${visitas} y ${outcomes.PRECIO_ALTO} dijeron que les gustó pero el precio se les hizo alto. El precio está arriba de lo que está pagando la zona.`;
  }
  if (outcomes.NO_ERA >= Math.ceil(conRetroalimentacion / 2)) {
    return `${visitas} y ${outcomes.NO_ERA} dijeron que no era lo que buscaban. No es el precio: se lo estamos enseñando a la gente equivocada.`;
  }
  if (outcomes.NO_LE_GUSTO >= Math.ceil(conRetroalimentacion / 2)) {
    return `${visitas} y ${outcomes.NO_LE_GUSTO} no quedaron conformes con el inmueble. Vale la pena revisar fotos, limpieza y detalles antes de seguir enseñándolo.`;
  }
  if (outcomes.LE_GUSTO >= Math.ceil(conRetroalimentacion / 2)) {
    return `${visitas} y a ${outcomes.LE_GUSTO} les gustó. Hay interés real: falta empujar la oferta.`;
  }
  return `${visitas} con opiniones repartidas. Todavía no hay un patrón claro.`;
}

// ═══════════════════════════════════════════════════════════════════════
// 5. RECORDATORIOS
//
// 🔴 EL ENVÍO POR WHATSAPP NO SE REIMPLEMENTA. Se llama a
// sendRealtyVisitReminders (T6) y punto. Aquí solo vive lo que T6 no
// cubre: el camino por CORREO para el plan PROPIETARIO (que no tiene la
// feature `whatsapp`), el aviso al ASESOR, y la lista de pendientes que se
// pinta en el panel.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Ventana del recordatorio. ESPEJO de VISIT_MIN_LEAD_MS / VISIT_MAX_LEAD_MS
 * en src/lib/realty/whatsapp.ts, que son privadas.
 *
 * ⚠️ Si allá cambian, aquí también: el panel enseñaría "pendiente" de un
 * aviso que el barrido de T6 ya considera fuera de ventana. Se duplican a
 * conciencia y con esta nota, en vez de exportarlas tocando un archivo que
 * es de otra terminal.
 */
export const VISIT_REMINDER_MIN_LEAD_MS = 45 * 60 * 1000;
export const VISIT_REMINDER_MAX_LEAD_MS = 24 * 60 * 60 * 1000;

/**
 * Marca del recordatorio por correo dentro de la bitácora.
 *
 * Es la MISMA técnica que MARCA_BITACORA en las calculadoras: no hay tabla
 * de recordatorios y esta terminal no puede crearla, así que la prueba de
 * "ya se mandó" es la fila de bitácora, reconocible por su primera palabra
 * y con la llave de reclamo de T6 dentro. La llave lleva la hora, así que
 * al reagendar cambia sola y el recordatorio nuevo SÍ sale.
 */
export const REALTY_VISIT_MAIL_MARK = "[recordatorio]";

function mailMarkFor(visitId: string, scheduledAt: Date): string {
  return `${REALTY_VISIT_MAIL_MARK} ${realtyVisitClaimKey(visitId, scheduledAt)}`;
}

export type RealtyReminderChannel = "WHATSAPP" | "CORREO" | "PANEL";

export interface RealtyVisitPending {
  visitId: string;
  propertyTitle: string;
  leadName: string | null;
  agentName: string | null;
  scheduledAt: string;
  /** Por dónde debería salir según el plan. */
  channel: RealtyReminderChannel;
  /** Ya salió (WhatsApp entregado o correo registrado). */
  sent: boolean;
  /** Por qué NO se puede mandar. null si sí se puede. */
  blocked: string | null;
}

/**
 * Qué recordatorios tocan ahora y cuáles ya salieron.
 *
 * Se calcula EN VIVO, sin materializar filas: es exactamente lo que hace el
 * canal PANEL de la cobranza de T4. Una cola persistida sería una segunda
 * fuente de verdad compitiendo con la de T6.
 */
export async function listVisitReminders(ctx: RealtyContext): Promise<{
  channel: RealtyReminderChannel;
  pending: RealtyVisitPending[];
}> {
  assertRealtyAccountId(ctx.accountId);
  const hasWa = realtyCan(ctx.plan, "whatsapp");
  const now = Date.now();

  const scope = await visitScopeWhere(ctx);
  const rows = await prisma.realtyVisit.findMany({
    where: {
      ...scope,
      status: { in: ["PROGRAMADA", "CONFIRMADA"] },
      scheduledAt: {
        gte: new Date(now + VISIT_REMINDER_MIN_LEAD_MS),
        lte: new Date(now + VISIT_REMINDER_MAX_LEAD_MS),
      },
    },
    select: {
      id: true,
      leadId: true,
      scheduledAt: true,
      property: { select: { title: true } },
      lead: { select: { contact: { select: { name: true, phone: true, email: true } } } },
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: { scheduledAt: "asc" },
    take: 200,
  });

  const sentKeys = hasWa
    ? await loadSentWhatsappClaims(ctx.accountId)
    : await loadSentMailMarks(ctx.accountId, rows);

  const pending: RealtyVisitPending[] = rows.map((r) => {
    const claim = realtyVisitClaimKey(r.id, r.scheduledAt);
    const phone = r.lead?.contact?.phone ?? null;
    const email = r.lead?.contact?.email ?? null;
    let blocked: string | null = null;
    if (!r.leadId) blocked = "Esta visita no tiene prospecto: no hay a quién avisarle.";
    else if (hasWa && !phone) blocked = "El prospecto no tiene teléfono capturado.";
    else if (!hasWa && !email) blocked = "El prospecto no tiene correo capturado.";
    return {
      visitId: r.id,
      propertyTitle: r.property?.title ?? "—",
      leadName: r.lead?.contact?.name ?? null,
      agentName: fullName(r.user),
      scheduledAt: r.scheduledAt.toISOString(),
      channel: hasWa ? "WHATSAPP" : "CORREO",
      sent: hasWa ? sentKeys.has(claim) : sentKeys.has(mailMarkFor(r.id, r.scheduledAt)),
      blocked,
    };
  });

  return { channel: hasWa ? "WHATSAPP" : "CORREO", pending };
}

/** Llaves de reclamo de los recordatorios que YA salieron por WhatsApp. */
async function loadSentWhatsappClaims(accountId: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const rows = await prisma.realtyMessage.findMany({
      where: {
        accountId,
        direction: "OUTBOUND",
        // La llave siempre empieza así; el externalId la lleva de sufijo.
        externalId: { contains: "visitReminder:" },
        status: { not: "FAILED" },
        createdAt: { gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
      },
      select: { externalId: true },
      take: 1000,
    });
    for (let i = 0; i < rows.length; i++) {
      const claim = claimFromExternalId(rows[i].externalId);
      if (claim) out.add(claim);
    }
  } catch (e) {
    // Sin esta lista se enseña todo como "por salir": es una pantalla
    // menos exacta, no una pantalla rota.
    console.error("[realty/visits] no se pudieron leer los avisos enviados:", e);
  }
  return out;
}

/** Marcas de bitácora de los recordatorios que YA salieron por correo. */
async function loadSentMailMarks(
  accountId: string,
  rows: { id: string; leadId: string | null; scheduledAt: Date }[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const leadIds: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].leadId) leadIds.push(rows[i].leadId as string);
  }
  if (leadIds.length === 0) return out;
  try {
    const found = await prisma.realtyLeadActivity.findMany({
      where: {
        accountId,
        leadId: { in: leadIds },
        kind: "CORREO",
        note: { startsWith: REALTY_VISIT_MAIL_MARK },
        createdAt: { gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
      },
      select: { note: true },
      take: 1000,
    });
    for (let i = 0; i < found.length; i++) {
      const note = found[i].note ?? "";
      // La marca es la primera línea: "[recordatorio] visitReminder:<id>:<min>".
      const firstLine = note.split("\n")[0].trim();
      if (firstLine) out.add(firstLine);
    }
  } catch (e) {
    console.error("[realty/visits] no se pudieron leer los recordatorios por correo:", e);
  }
  return out;
}

export interface RunRemindersResult {
  channel: RealtyReminderChannel;
  sent: number;
  failed: number;
  skipped: number;
  /** Avisos al ASESOR que salieron (siempre por correo). */
  agentsNotified: number;
}

/**
 * Manda los recordatorios que tocan AHORA.
 *
 * · Con la feature `whatsapp` → se delega ENTERO en T6
 *   (sendRealtyVisitReminders). Esta terminal no arma un segundo camino de
 *   envío: dos colas para el mismo aviso son dos WhatsApps al mismo
 *   prospecto, que es la lección que ya dejó escrita la ola de rentas.
 *
 * · Sin la feature (plan PROPIETARIO) → sale por CORREO y queda como
 *   pendiente en el panel. Mismo reparto que `noticeChannelsFor` de T4.
 *
 * El aviso al ASESOR va SIEMPRE por correo: RealtyUser no guarda teléfono,
 * así que no hay por dónde mandarle un WhatsApp aunque el plan lo incluya.
 */
export async function runVisitReminders(ctx: RealtyContext): Promise<RunRemindersResult> {
  assertRealtyAccountId(ctx.accountId);
  const hasWa = realtyCan(ctx.plan, "whatsapp");

  const agentsNotified = await notifyAgentsByMail(ctx);

  if (hasWa) {
    const { sendRealtyVisitReminders } = await import("@/lib/realty/whatsapp");
    const r = await sendRealtyVisitReminders(ctx.accountId);
    return { channel: "WHATSAPP", sent: r.sent, failed: r.failed, skipped: r.skipped, agentsNotified };
  }

  const r = await sendVisitRemindersByMail(ctx);
  return { channel: "CORREO", ...r, agentsNotified };
}

/** Las visitas que caen en la ventana del recordatorio, con todo lo del envío. */
async function dueVisits(ctx: RealtyContext) {
  const now = Date.now();
  const scope = await visitScopeWhere(ctx);
  return prisma.realtyVisit.findMany({
    where: {
      ...scope,
      status: { in: ["PROGRAMADA", "CONFIRMADA"] },
      scheduledAt: {
        gte: new Date(now + VISIT_REMINDER_MIN_LEAD_MS),
        lte: new Date(now + VISIT_REMINDER_MAX_LEAD_MS),
      },
    },
    select: {
      id: true,
      leadId: true,
      scheduledAt: true,
      property: { select: { title: true, address: true, colonia: true, city: true } },
      lead: { select: { contact: { select: { name: true, email: true } } } },
      user: { select: { email: true, firstName: true } },
    },
    orderBy: { scheduledAt: "asc" },
    take: 200,
  });
}

function whenLabel(at: Date, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
    timeZone: timeZone || "America/Mexico_City",
    dateStyle: "full",
    timeStyle: "short",
  }).format(at);
}

function placeLabel(p: { address: string | null; colonia: string | null; city: string | null }): string {
  const parts: string[] = [];
  if (p.address) parts.push(p.address);
  if (p.colonia) parts.push(p.colonia);
  if (p.city) parts.push(p.city);
  return parts.join(", ");
}

/** Escapa lo que se mete en el HTML del correo. */
function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;");
}

/** Recordatorio por CORREO al prospecto. Solo para cuentas sin WhatsApp. */
async function sendVisitRemindersByMail(
  ctx: RealtyContext,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const rows = await dueVisits(ctx);
  const already = await loadSentMailMarks(ctx.accountId, rows);
  const tz = ctx.account.timezone || "America/Mexico_City";
  const locale = ctx.account.locale === "en" ? "en" : "es";

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const { sendEmail } = await import("@/lib/email");

  for (let i = 0; i < rows.length; i++) {
    const v = rows[i];
    const email = v.lead?.contact?.email ?? null;
    const mark = mailMarkFor(v.id, v.scheduledAt);
    // Sin prospecto o sin correo NO se manda y NO se marca: en cuanto
    // alguien capture el correo, el aviso sale solo.
    if (!v.leadId || !email) {
      skipped++;
      continue;
    }
    if (already.has(mark)) {
      skipped++;
      continue;
    }

    const nombre = (v.lead?.contact?.name ?? "").split(" ")[0] || "¡Hola!";
    const cuando = whenLabel(v.scheduledAt, tz, locale);
    const donde = placeLabel(v.property);
    const casa = v.property?.title ?? "el inmueble";

    const res = await sendEmail({
      to: email,
      subject: `Recordatorio de tu visita: ${casa}`,
      text:
        `Hola ${nombre}, te recordamos tu visita a ${casa}` +
        (donde ? ` (${donde})` : "") +
        `.\n\nCuándo: ${cuando}\n\n` +
        `Si no puedes llegar o quieres moverla, contéstanos este correo.\n${ctx.account.name}`,
      html:
        `<p>Hola ${esc(nombre)}, te recordamos tu visita a <strong>${esc(casa)}</strong>` +
        (donde ? ` (${esc(donde)})` : "") +
        `.</p><p><strong>Cuándo:</strong> ${esc(cuando)}</p>` +
        `<p>Si no puedes llegar o quieres moverla, contéstanos este correo.</p>` +
        `<p>${esc(ctx.account.name)}</p>`,
    });

    if (!res || res.delivered !== true) {
      // `delivered:false` también es "no hay transporte configurado". No se
      // marca la bitácora: mentir diciendo que salió es peor que reintentar.
      failed++;
      continue;
    }
    sent++;
    await logVisitActivity(
      ctx.accountId,
      v.leadId,
      "CORREO",
      `${mark}\nRecordatorio de visita enviado por correo a ${email}.`,
      null,
    ).catch(() => {});
  }

  return { sent, failed, skipped };
}

/**
 * Aviso al ASESOR de las visitas que trae hoy. Va por correo SIEMPRE (ver
 * runVisitReminders) y se agrupa: un correo por asesor con todas sus
 * visitas, no uno por visita.
 *
 * Sin idempotencia por visita a propósito: es un resumen, no un aviso
 * individual, y se dispara desde el botón del panel o del cron una vez por
 * corrida. Duplicarlo molesta; perderlo cuesta una visita.
 */
async function notifyAgentsByMail(ctx: RealtyContext): Promise<number> {
  const rows = await dueVisits(ctx);
  if (rows.length === 0) return 0;

  const tz = ctx.account.timezone || "America/Mexico_City";
  const locale = ctx.account.locale === "en" ? "en" : "es";

  const byAgent = new Map<string, { name: string; lines: string[] }>();
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i];
    const email = v.user?.email ?? null;
    if (!email) continue;
    const bucket = byAgent.get(email) ?? { name: v.user?.firstName ?? "", lines: [] };
    bucket.lines.push(
      `${whenLabel(v.scheduledAt, tz, locale)} — ${v.property?.title ?? "—"}` +
        (v.lead?.contact?.name ? ` con ${v.lead.contact.name}` : ""),
    );
    byAgent.set(email, bucket);
  }
  if (byAgent.size === 0) return 0;

  const { sendEmail } = await import("@/lib/email");
  let notified = 0;
  const entries = Array.from(byAgent.entries());
  for (let i = 0; i < entries.length; i++) {
    const email = entries[i][0];
    const data = entries[i][1];
    const res = await sendEmail({
      to: email,
      subject: `Tus próximas visitas (${data.lines.length})`,
      text: `Hola ${data.name}, esto es lo que traes:\n\n${data.lines.join("\n")}\n\n${ctx.account.name}`,
      html:
        `<p>Hola ${esc(data.name)}, esto es lo que traes:</p><ul>` +
        data.lines.map((l) => `<li>${esc(l)}</li>`).join("") +
        `</ul><p>${esc(ctx.account.name)}</p>`,
    }).catch(() => null);
    if (res && res.delivered === true) notified++;
  }
  return notified;
}

// ── 6. Utilidades para otras olas ───────────────────────────────────────

/** Cuántas visitas trae hoy la cuenta. Barato, para las tarjetas del Inicio. */
export async function countTodayVisits(ctx: RealtyContext): Promise<number> {
  const timeZone = ctx.account.timezone || "America/Mexico_City";
  const todayISO = realtyDateISO(new Date(), timeZone);
  const scope = await visitScopeWhere(ctx);
  return prisma.realtyVisit.count({
    where: {
      ...scope,
      scheduledAt: {
        gte: realtyLocalToUtc(todayISO, 0, timeZone),
        lt: realtyLocalToUtc(addDaysISO(todayISO, 1), 0, timeZone),
      },
      status: { in: ["PROGRAMADA", "CONFIRMADA"] },
    },
  });
}

export { daysBetween };

/**
 * Re-exportados para que O2-T5 tenga UN SOLO import.
 *
 * Los tipos nacen en `@/components/realty/visits/visit-core` (módulo puro,
 * sin Prisma), pero quien consuma `getPropertyVisitReport` no tiene por qué
 * saberlo ni acordarse de dos rutas distintas.
 */
export type { RealtyVisitOutcome, RealtyVisitStatusKey };
