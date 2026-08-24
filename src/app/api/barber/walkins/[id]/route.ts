// ═══════════════════════════════════════════════════════════════════════
// POST /api/barber/walkins/[id]  → llamar / atender / se fue / regresar
//
// "Atender" es la bisagra entre la fila y la agenda: la entrada se
// convierte en una VISITA EN SILLA (BarberAppointment IN_PROGRESS, source
// WALKIN) para que el ticket (T3) y la comisión (T6) salgan de ahí y no de
// un registro paralelo. Si la silla ya está ocupada, la base lo impide y la
// entrada NO se marca atendida (todo va en una transacción).
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mxTenDigits } from "@/lib/phone-mx";
import { hasBarberPermission } from "@/lib/barber/permissions";
import {
  checkAppointmentSlot,
  isBarberOverlapError,
  toAppointmentDTO,
  toWalkInDTO,
  totalServiceMinutes,
} from "@/lib/barber/agenda";
import type { BarberWalkInStatus } from "@/lib/barber/types";
import {
  APPOINTMENT_INCLUDE,
  asString,
  asStringArray,
  jsonError,
  openAgendaGate,
  readJson,
} from "../../appointments/_server";
import { loadQueueSnapshot, WALKIN_FEATURE } from "../_server";

export const dynamic = "force-dynamic";

type WalkInAction = "call" | "wait" | "left" | "serve" | "restore";

const ACTIONS: WalkInAction[] = ["call", "wait", "left", "serve", "restore"];

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await readJson(req);
  if (!body) return jsonError("Cuerpo de la solicitud inválido.", 400);

  const gate = await openAgendaGate({
    permission: "walkin.manage",
    feature: WALKIN_FEATURE,
    branchId: asString(body.branchId),
  });
  if (gate.response) return gate.response;
  const { ctx, shopId, timezone } = gate.gate;

  const action = asString(body.action) as WalkInAction | null;
  if (!action || !ACTIONS.includes(action)) return jsonError("Esa acción no existe.", 400);

  const entry = await prisma.barberWalkIn.findFirst({
    where: { id: params.id, barbershopId: shopId },
  });
  if (!entry) return jsonError("Esa persona ya no está en la fila.", 404);

  // ── Acciones simples de fila ─────────────────────────────────────────
  if (action !== "serve") {
    const nextStatus: Record<Exclude<WalkInAction, "serve">, BarberWalkInStatus> = {
      call: "CALLED",
      wait: "WAITING",
      left: "LEFT",
      restore: "WAITING",
    };
    if (entry.status === "SERVED") {
      return jsonError("Esa visita ya se atendió; no se puede regresar a la fila.", 409);
    }
    const updated = await prisma.barberWalkIn.update({
      where: { id: entry.id },
      data: {
        status: nextStatus[action],
        calledAt: action === "call" ? new Date() : action === "wait" ? null : entry.calledAt,
      },
    });
    return NextResponse.json({ walkIn: toWalkInDTO(updated) });
  }

  // ── Atender: fila → visita en silla ──────────────────────────────────
  if (entry.status === "SERVED") {
    return jsonError("Esa persona ya fue atendida.", 409);
  }

  const barberId = asString(body.barberId) ?? entry.barberId;
  if (!barberId) return jsonError("Elige con qué barbero se sienta.", 400);

  const barber = await prisma.barber.findFirst({
    where: { id: barberId, barbershopId: shopId, isActive: true },
    select: { id: true },
  });
  if (!barber) return jsonError("Ese barbero no existe en tu barbería.", 404);

  const serviceIds = asStringArray(body.serviceIds);
  const services = serviceIds.length
    ? await prisma.barberService.findMany({
        where: { id: { in: serviceIds }, barbershopId: shopId, isActive: true },
        select: { id: true, durationMin: true, price: true },
      })
    : [];

  const snapshot = await loadQueueSnapshot(shopId);
  const durationMin = services.length
    ? totalServiceMinutes(services)
    : snapshot.avgServiceMin;

  const startAt = new Date();
  const endAt = new Date(startAt.getTime() + durationMin * 60_000);

  // El horario y los bloqueos NO aplican aquí a propósito: el cliente YA
  // está sentado en la silla, es un hecho consumado. Lo que sí se respeta
  // —porque es físicamente imposible— es que el barbero no puede atender a
  // dos personas a la vez.
  const busy = await prisma.barberAppointment.findMany({
    where: { barbershopId: shopId, startAt: { lt: endAt }, endAt: { gt: startAt } },
    select: { id: true, barberId: true, startAt: true, endAt: true, status: true },
  });
  const check = checkAppointmentSlot({
    startAt,
    endAt,
    barberId,
    timezone,
    schedules: [],
    timeOff: [],
    requireSchedule: false,
    appointments: busy.map((a) => ({
      id: a.id,
      barberId: a.barberId,
      startAt: a.startAt.toISOString(),
      endAt: a.endAt.toISOString(),
      status: a.status,
    })),
  });
  if (!check.ok) {
    return jsonError(check.message ?? "Ese barbero está ocupado ahora mismo.", 409, {
      code: check.issue,
      conflictId: check.conflictId,
    });
  }

  const phone = mxTenDigits(entry.phone ?? "");
  const canCreateClients = hasBarberPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "clients.edit",
  );

  try {
    const result = await prisma.$transaction(async (tx) => {
      let clientId: string | null = null;
      if (phone && canCreateClients) {
        const client = await tx.barberClient.upsert({
          where: { barbershopId_phone: { barbershopId: shopId, phone } },
          create: { barbershopId: shopId, name: entry.clientName, phone },
          update: {},
          select: { id: true },
        });
        clientId = client.id;
      }

      const appt = await tx.barberAppointment.create({
        data: {
          barbershopId: shopId,
          barberId,
          clientId,
          clientName: entry.clientName,
          clientPhone: phone ?? entry.phone,
          startAt,
          endAt,
          status: "IN_PROGRESS",
          source: "WALKIN",
        },
        select: { id: true },
      });

      if (services.length > 0) {
        await tx.barberAppointmentService.createMany({
          data: services.map((s) => ({
            appointmentId: appt.id,
            serviceId: s.id,
            priceAtBooking: s.price,
          })),
        });
      }

      const walkIn = await tx.barberWalkIn.update({
        where: { id: entry.id },
        data: { status: "SERVED", servedAt: new Date(), barberId },
      });

      const full = await tx.barberAppointment.findUniqueOrThrow({
        where: { id: appt.id },
        include: APPOINTMENT_INCLUDE,
      });
      return { walkIn, appointment: full };
    });

    return NextResponse.json({
      walkIn: toWalkInDTO(result.walkIn),
      appointment: toAppointmentDTO(result.appointment),
    });
  } catch (err) {
    if (isBarberOverlapError(err)) {
      return jsonError("Ese barbero ya tiene otra visita a esa hora.", 409, { code: "OVERLAP" });
    }
    throw err;
  }
}
