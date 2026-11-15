// ═══════════════════════════════════════════════════════════════════════
// POST   /api/barber/appointments/[id]/arrived  → «Ya llegó» (arrivedAt = ahora)
// DELETE /api/barber/appointments/[id]/arrived  → quitarlo (arrivedAt = null)
//
// Cita «B» (ws6-t5). Solo en visitas PENDIENTES o CONFIRMADAS de HOY (en la
// zona de la sede): marcar que llegó alguien que viene mañana, o que ya está
// en la silla, no significa nada. No cambia el estado de la visita: «Iniciar
// servicio» sigue siendo el paso a «En silla».
//
// QUIÉN: quien tiene agenda.edit, o el rol Barbero en SU visita (lo mismo que
// avanzar sus visitas). La sede es la de la sesión (o la de la pantalla).
// Sin sql/barber_cita_b.sql → 409 SQL_PENDING, sin tocar nada.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startOfDayInTz } from "@/lib/barber/commissions";
import { saveArrivedAt } from "@/lib/barber/appointment-extras";
import { canActOnOwnVisit, jsonError, openAgendaGate } from "../../_server";

export const dynamic = "force-dynamic";

const ARRIVABLE = new Set(["PENDING", "CONFIRMED"]);

async function handle(req: Request, id: string, arrived: boolean) {
  const branchId = new URL(req.url).searchParams.get("branchId");
  const gate = await openAgendaGate({ permission: "agenda.view", feature: "agenda", branchId });
  if (gate.response) return gate.response;
  const { shopId, ctx, timezone } = gate.gate;

  const appt = await prisma.barberAppointment.findFirst({
    where: { id, barbershopId: shopId },
    select: { id: true, status: true, startAt: true, barberId: true },
  });
  if (!appt) return jsonError("Esa visita no existe.", 404);
  if (!canActOnOwnVisit(ctx, appt)) {
    return jsonError("No tienes permiso para esto.", 403, { code: "FORBIDDEN", permission: "agenda.edit" });
  }

  if (arrived) {
    if (!ARRIVABLE.has(appt.status)) {
      return jsonError("Solo se marca «Ya llegó» en una visita pendiente o confirmada.", 409, { code: "BAD_STATUS" });
    }
    const now = new Date();
    const dayStart = startOfDayInTz(now, timezone || "America/Mexico_City");
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    if (appt.startAt < dayStart || appt.startAt >= dayEnd) {
      return jsonError("Solo se marca «Ya llegó» en una visita de hoy.", 409, { code: "NOT_TODAY" });
    }
  }

  const at = arrived ? new Date() : null;
  const saved = await saveArrivedAt(prisma, { barbershopId: shopId, appointmentId: appt.id, at });
  if (!saved) {
    return jsonError("Falta aplicar sql/barber_cita_b.sql para marcar «Ya llegó».", 409, { code: "SQL_PENDING" });
  }
  return NextResponse.json({ arrivedAt: at ? at.toISOString() : null });
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  return handle(req, (await props.params).id, true);
}

export async function DELETE(req: Request, props: { params: Promise<{ id: string }> }) {
  return handle(req, (await props.params).id, false);
}
