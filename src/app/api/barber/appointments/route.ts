// ═══════════════════════════════════════════════════════════════════════
// GET  /api/barber/appointments  → todo lo que pinta la agenda de un rango
// POST /api/barber/appointments  → crear una visita (2 clics desde el hueco)
//
// El barbershopId NUNCA llega del request: sale de getBarberContext() vía
// openAgendaGate(). Lo único que se acepta del query es `branchId`, y aun
// así se valida contra getAccessibleBranchIds().
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasBarberPermission } from "@/lib/barber/permissions";
import {
  addDaysISO,
  checkAppointmentSlot,
  isBarberOverlapError,
  isValidDateISO,
  shopDateISO,
  shopLocalToUtc,
  toAppointmentDTO,
  totalServiceMinutes,
} from "@/lib/barber/agenda";
import {
  APPOINTMENT_INCLUDE,
  asDate,
  asString,
  asStringArray,
  jsonError,
  loadAgendaWindow,
  loadSlotContext,
  openAgendaGate,
  readJson,
  resolveAppointmentClient,
} from "./_server";

export const dynamic = "force-dynamic";

const MAX_DAYS = 14;

// ── GET ────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const url = new URL(req.url);
  const gate = await openAgendaGate({
    permission: "agenda.view",
    feature: "agenda",
    branchId: url.searchParams.get("branchId"),
  });
  if (gate.response) return gate.response;
  const { ctx, shopId, timezone } = gate.gate;

  const rawDate = url.searchParams.get("date");
  const dateISO = isValidDateISO(rawDate) ? rawDate : shopDateISO(new Date(), timezone);
  const rawDays = parseInt(url.searchParams.get("days") ?? "1", 10);
  const days = Number.isFinite(rawDays) ? Math.min(MAX_DAYS, Math.max(1, rawDays)) : 1;

  // El rango va de la medianoche local del primer día a la medianoche local
  // del día siguiente al último: así una visita de las 23:30 sigue dentro.
  const fromUtc = shopLocalToUtc(dateISO, 0, timezone);
  const toUtc = shopLocalToUtc(addDaysISO(dateISO, days), 0, timezone);

  const window = await loadAgendaWindow(shopId, fromUtc, toUtc);
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };

  return NextResponse.json({
    branchId: shopId,
    timezone,
    dateISO,
    days,
    from: fromUtc.toISOString(),
    to: toUtc.toISOString(),
    ...window,
    can: {
      edit: hasBarberPermission(permUser, "agenda.edit"),
      schedule: hasBarberPermission(permUser, "schedule.manage"),
      clients: hasBarberPermission(permUser, "clients.view"),
      createClients: hasBarberPermission(permUser, "clients.edit"),
    },
  });
}

// ── POST ───────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return jsonError("Cuerpo de la solicitud inválido.", 400);

  const gate = await openAgendaGate({
    permission: "agenda.edit",
    feature: "agenda",
    branchId: asString(body.branchId),
  });
  if (gate.response) return gate.response;
  const { ctx, shopId, timezone } = gate.gate;

  const barberId = asString(body.barberId);
  const startAt = asDate(body.startAt);
  const serviceIds = asStringArray(body.serviceIds);
  const notes = asString(body.notes);

  if (!barberId) return jsonError("Elige al barbero que va a atender la visita.", 400);
  if (!startAt) return jsonError("La hora de inicio no es válida.", 400);
  if (serviceIds.length === 0) return jsonError("Elige al menos un servicio.", 400);

  // El barbero tiene que ser de ESTA sede y estar activo.
  const barber = await prisma.barber.findFirst({
    where: { id: barberId, barbershopId: shopId, isActive: true },
    select: { id: true },
  });
  if (!barber) return jsonError("Ese barbero no existe en tu barbería.", 404);

  // Los servicios también: se leen del catálogo de la sede, jamás del body.
  const services = await prisma.barberService.findMany({
    where: { id: { in: serviceIds }, barbershopId: shopId, isActive: true },
    select: { id: true, durationMin: true, price: true },
  });
  if (services.length === 0) return jsonError("Los servicios elegidos ya no están disponibles.", 400);

  const durationMin = totalServiceMinutes(services);
  const endAt = new Date(startAt.getTime() + durationMin * 60_000);

  // Pre-chequeo en memoria (mensaje bonito). La palabra final la tiene la
  // constraint EXCLUDE de Postgres, más abajo.
  const slotCtx = await loadSlotContext(shopId, startAt, endAt);
  const check = checkAppointmentSlot({
    startAt,
    endAt,
    barberId,
    timezone,
    schedules: slotCtx.schedules,
    timeOff: slotCtx.timeOff,
    appointments: slotCtx.appointments,
  });
  if (!check.ok) {
    return jsonError(check.message ?? "Ese horario no está disponible.", 409, {
      code: check.issue,
      conflictId: check.conflictId,
    });
  }

  const resolved = await resolveAppointmentClient(body, shopId, ctx);
  if (resolved.error) return resolved.error;
  const client = resolved.client;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const appt = await tx.barberAppointment.create({
        data: {
          barbershopId: shopId,
          barberId,
          clientId: client.clientId,
          clientName: client.clientName,
          clientPhone: client.clientPhone,
          startAt,
          endAt,
          status: "PENDING",
          source: "PANEL",
          notes,
        },
        select: { id: true },
      });
      // priceAtBooking CONGELA el precio vivo del catálogo: si mañana sube
      // el corte, esta visita sigue valiendo lo de hoy.
      await tx.barberAppointmentService.createMany({
        data: services.map((s) => ({
          appointmentId: appt.id,
          serviceId: s.id,
          priceAtBooking: s.price,
        })),
      });
      return tx.barberAppointment.findUniqueOrThrow({
        where: { id: appt.id },
        include: APPOINTMENT_INCLUDE,
      });
    });

    return NextResponse.json({ appointment: toAppointmentDTO(created) }, { status: 201 });
  } catch (err) {
    if (isBarberOverlapError(err)) {
      return jsonError("Ese barbero ya tiene otra visita a esa hora.", 409, { code: "OVERLAP" });
    }
    throw err;
  }
}
