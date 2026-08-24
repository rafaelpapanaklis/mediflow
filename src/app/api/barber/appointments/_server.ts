// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — piezas de SERVIDOR que comparten las APIs de la
// agenda, los horarios y la fila virtual.
//
// POR QUÉ VIVE AQUÍ Y NO EN src/lib/barber/agenda.ts: aquel módulo es
// client-safe a propósito (lo importan los componentes del navegador para
// previsualizar el arrastre) y meter prisma ahí tumbaría el bundle. Este
// archivo sí toca prisma, así que se queda dentro de /api.
//
// REGLA DE ORO DEL VERTICAL: el barbershopId sale SIEMPRE de la sesión
// (getBarberContext). Nada de leerlo del body ni del query. Y ojo Prisma:
// un `barbershopId: undefined` en un where BORRA el filtro de inquilino y
// te deja leer la agenda de otra barbería.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  assertBarberPermission,
  getAccessibleBranchIds,
  getBarberContext,
  BarberForbiddenError,
  type BarberContext,
  type BarberPermissionKey,
} from "@/lib/barber-auth";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { mxTenDigits } from "@/lib/phone-mx";
import { getBarberPlan } from "@/lib/barber/plans";
import { barberPlanHasFeature, type BarberResolvedPlan } from "@/lib/barber/plan-shared";
import {
  pendingReminderInvalidationWhere,
  reminderInvalidationData,
  toAppointmentDTO,
  toBarberDTO,
  toScheduleDTO,
  toServiceDTO,
  toTimeOffDTO,
  type BarberReminderInvalidationCause,
} from "@/lib/barber/agenda";
import type {
  BarberAppointmentDTO,
  BarberDTO,
  BarberScheduleDTO,
  BarberServiceDTO,
  BarberTimeOffDTO,
} from "@/lib/barber/types";

// ── Puerta de entrada de toda API del área ─────────────────────────────

export interface BarberAgendaGate {
  ctx: BarberContext;
  /** Sede sobre la que se opera. SIEMPRE validada contra las accesibles. */
  shopId: string;
  /** Nombre de ESA sede (no siempre el de la sesión, si se cambió de sede). */
  shopName: string;
  timezone: string;
  plan: BarberResolvedPlan;
}

/**
 * Resultado deliberadamente NO discriminado: el repo compila con
 * `strict: false`, y ahí TypeScript no estrecha una unión por la
 * veracidad de una propiedad opcional. Con dos campos siempre presentes
 * (uno de los dos en null) el patrón `if (x.response) return x.response`
 * funciona sin guardas de tipo.
 */
interface GateResult {
  gate: BarberAgendaGate | null;
  response: NextResponse | null;
}

export function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

/**
 * Sesión + sede + plan + permiso, en ese orden. Devuelve o el contexto ya
 * resuelto o la respuesta de error lista para regresar:
 *
 *   const gate = await openAgendaGate({ permission: "agenda.edit", feature: "agenda" });
 *   if (gate.response) return gate.response;
 *   const { shopId, timezone } = gate.gate;
 *
 * `branchId` es lo ÚNICO que se acepta del request, y aun así se valida
 * contra getAccessibleBranchIds() — punto único del filtro multisucursal.
 * Un id ajeno no da error: simplemente cae a la sede de la sesión.
 */
export async function openAgendaGate(opts: {
  permission: BarberPermissionKey;
  feature?: string | null;
  branchId?: string | null;
}): Promise<GateResult> {
  const ctx = await getBarberContext();
  if (!ctx) return deny(jsonError("No autorizado", 401));
  if (!ctx.barbershop.isActive) {
    return deny(jsonError("Esta barbería está desactivada.", 403));
  }

  let shopId = ctx.barbershopId;
  let shopName = ctx.barbershop.name;
  let timezone = ctx.barbershop.timezone;
  if (opts.branchId && opts.branchId !== ctx.barbershopId) {
    const allowed = await getAccessibleBranchIds(ctx);
    if (allowed.includes(opts.branchId)) {
      const branch = await prisma.barbershop.findFirst({
        where: { id: opts.branchId, isActive: true },
        // select explícito: la fila completa de Barbershop trae el token de
        // WhatsApp y los ids de Stripe. Nunca se carga entera "por si acaso".
        select: { id: true, name: true, branchName: true, timezone: true },
      });
      if (branch) {
        shopId = branch.id;
        shopName = branch.branchName ? `${branch.name} · ${branch.branchName}` : branch.name;
        timezone = branch.timezone;
      }
    }
  }

  const plan = await getBarberPlan(ctx.barbershop.plan);
  if (opts.feature && !barberPlanHasFeature(plan, opts.feature)) {
    return deny(
      jsonError("Tu plan no incluye esta función.", 403, {
        code: "PLAN_FEATURE",
        feature: opts.feature,
      }),
    );
  }

  try {
    assertBarberPermission(ctx, opts.permission);
  } catch (err) {
    if (err instanceof BarberForbiddenError) {
      return deny(jsonError("No tienes permiso para esto.", 403, { permission: err.permission }));
    }
    throw err;
  }

  return { gate: { ctx, shopId, shopName, timezone, plan }, response: null };
}

function deny(response: NextResponse): GateResult {
  return { gate: null, response };
}

// ── Lectura del rango de agenda ────────────────────────────────────────

export interface AgendaWindow {
  barbers: BarberDTO[];
  services: BarberServiceDTO[];
  schedules: BarberScheduleDTO[];
  timeOff: BarberTimeOffDTO[];
  appointments: BarberAppointmentDTO[];
}

/** Include canónico para que toAppointmentDTO tenga todo lo que necesita. */
export const APPOINTMENT_INCLUDE = {
  client: { select: { name: true, phone: true } },
  barber: { select: { name: true, nickname: true } },
  services: {
    select: {
      id: true,
      serviceId: true,
      priceAtBooking: true,
      service: { select: { name: true } },
    },
  },
} as const;

/**
 * Todo lo que la pantalla de agenda necesita para un rango: el equipo, el
 * catálogo, los horarios, los bloqueos y las visitas. Una sola ida a la
 * base para la pantalla que la barbería tiene abierta todo el día.
 */
export async function loadAgendaWindow(
  shopId: string,
  fromUtc: Date,
  toUtc: Date,
): Promise<AgendaWindow> {
  const [barbers, services, schedules, timeOff, appointments] = await Promise.all([
    prisma.barber.findMany({
      where: { barbershopId: shopId },
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.barberService.findMany({
      where: { barbershopId: shopId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.barberSchedule.findMany({
      where: { barbershopId: shopId },
      orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    }),
    prisma.barberTimeOff.findMany({
      // Un bloqueo cuenta si TOCA el rango, aunque empiece antes o acabe
      // después (unas vacaciones de dos semanas tapan cualquier día de en
      // medio).
      where: { barbershopId: shopId, startAt: { lt: toUtc }, endAt: { gt: fromUtc } },
      orderBy: { startAt: "asc" },
    }),
    prisma.barberAppointment.findMany({
      where: { barbershopId: shopId, startAt: { lt: toUtc }, endAt: { gt: fromUtc } },
      include: APPOINTMENT_INCLUDE,
      orderBy: { startAt: "asc" },
    }),
  ]);

  return {
    barbers: barbers.map(toBarberDTO),
    services: services.map(toServiceDTO),
    schedules: schedules.map(toScheduleDTO),
    timeOff: timeOff.map(toTimeOffDTO),
    appointments: appointments.map(toAppointmentDTO),
  };
}

/**
 * Lo mínimo para decidir si un hueco está libre: horarios del barbero,
 * bloqueos que tocan la franja y visitas del día. Lo usan crear y mover.
 */
export async function loadSlotContext(shopId: string, fromUtc: Date, toUtc: Date) {
  const [schedules, timeOff, appointments] = await Promise.all([
    prisma.barberSchedule.findMany({ where: { barbershopId: shopId } }),
    prisma.barberTimeOff.findMany({
      where: { barbershopId: shopId, startAt: { lt: toUtc }, endAt: { gt: fromUtc } },
    }),
    prisma.barberAppointment.findMany({
      where: { barbershopId: shopId, startAt: { lt: toUtc }, endAt: { gt: fromUtc } },
      select: { id: true, barberId: true, startAt: true, endAt: true, status: true },
    }),
  ]);
  return {
    schedules: schedules.map(toScheduleDTO),
    timeOff: timeOff.map(toTimeOffDTO),
    appointments: appointments.map((a) => ({
      id: a.id,
      barberId: a.barberId,
      startAt: a.startAt.toISOString(),
      endAt: a.endAt.toISOString(),
      status: a.status,
    })),
  };
}

// ── El bug M-22 del dental que aquí NO se repite ───────────────────────
//
// Dental (hallazgo abierto M-22): reagendar una cita NO cancela el
// recordatorio ya programado y al cliente le llega el aviso de la hora
// vieja. Aquí, CADA vez que una visita se mueve, se cancela o se marca "no
// llegó", sus recordatorios OUTBOUND todavía PENDING pasan a FAILED con la
// marca canónica BARBER_REMINDER_INVALIDATED_MARK.
//
// Se MARCA en vez de borrar para dejar rastro de por qué no salió. T7
// (ola de WhatsApp) reprograma desde cero leyendo la visita ya movida y
// jamás debe tomar como pendiente una fila marcada así.

/** Invalida los recordatorios pendientes de una visita. Devuelve cuántos. */
export async function invalidateAppointmentReminders(
  shopId: string,
  appointmentId: string,
  cause: BarberReminderInvalidationCause,
): Promise<number> {
  const result = await prisma.barberMessage.updateMany({
    where: pendingReminderInvalidationWhere(shopId, appointmentId),
    data: reminderInvalidationData(cause),
  });
  return result.count;
}

// ── Cliente de la visita ───────────────────────────────────────────────
/**
 * Tres caminos, en este orden:
 *  1. clientId → tiene que ser de ESTA sede (si no, 404).
 *  2. nombre + teléfono válido y quien agenda tiene clients.edit → se da de
 *     alta o se reutiliza por (barbershopId, phone), que es ÚNICO en el
 *     schema, así que dos reservas simultáneas no duplican al cliente.
 *  3. cualquier otro caso → se guarda suelto en clientName/clientPhone de la
 *     visita. Para eso existen esas columnas, y así alguien con agenda.edit
 *     pero SIN clients.edit no acaba dando de alta clientes de rebote.
 */
export interface ResolvedClient {
  clientId: string | null;
  clientName: string | null;
  clientPhone: string | null;
}

export async function resolveAppointmentClient(
  body: Record<string, unknown>,
  shopId: string,
  ctx: BarberContext,
): Promise<{ client: ResolvedClient; error: null } | { client: null; error: NextResponse }> {
  const clientId = asString(body.clientId);
  if (clientId) {
    const found = await prisma.barberClient.findFirst({
      where: { id: clientId, barbershopId: shopId },
      select: { id: true, name: true, phone: true },
    });
    if (!found) {
      return { client: null, error: jsonError("Ese cliente no existe en tu barbería.", 404) };
    }
    return {
      client: { clientId: found.id, clientName: found.name, clientPhone: found.phone },
      error: null,
    };
  }

  const name = asString(body.clientName);
  if (!name) {
    return { client: null, error: jsonError("Escribe el nombre del cliente.", 400) };
  }
  const phone = mxTenDigits(asString(body.clientPhone) ?? "");

  const canCreate = hasBarberPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "clients.edit",
  );
  if (!phone || !canCreate) {
    return { client: { clientId: null, clientName: name, clientPhone: phone }, error: null };
  }

  const client = await prisma.barberClient.upsert({
    where: { barbershopId_phone: { barbershopId: shopId, phone } },
    create: { barbershopId: shopId, name, phone },
    update: {},
    select: { id: true, name: true, phone: true },
  });
  return {
    client: { clientId: client.id, clientName: client.name, clientPhone: client.phone },
    error: null,
  };
}

// ── Utilidades de parseo del request ───────────────────────────────────

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = asString(item);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Fecha ISO válida o null (nunca un Invalid Date suelto). */
export function asDate(value: unknown): Date | null {
  const s = asString(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}
