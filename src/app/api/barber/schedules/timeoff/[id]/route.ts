// ═══════════════════════════════════════════════════════════════════════
// DELETE /api/barber/schedules/timeoff/[id]  → quitar un bloqueo
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, openAgendaGate } from "../../../appointments/_server";
import { timeOffAllowed, timeOffScope } from "@/lib/barber/permissions";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await openAgendaGate({ permission: ["timeoff.manage", "timeoff.own"], feature: "agenda" });
  if (gate.response) return gate.response;
  const { ctx, shopId } = gate.gate;

  const scope = timeOffScope({
    role: ctx.role,
    permissionsOverride: ctx.user.permissionsOverride,
    ownBarberId: ctx.barber?.id ?? null,
  });
  if (scope !== "all") {
    // El Barbero solo quita los SUYOS: se lee primero (con el inquilino) para
    // contestar 403 y no un 404 engañoso.
    const row = await prisma.barberTimeOff.findFirst({
      where: { id: params.id, barbershopId: shopId },
      select: { barberId: true },
    });
    if (!row) return jsonError("Ese bloqueo no existe.", 404);
    if (!timeOffAllowed(scope, row.barberId)) return jsonError("Solo puedes quitar tus propios bloqueos.", 403);
  }

  // deleteMany con el filtro de inquilino: si el id es de otra barbería,
  // borra cero filas y contesta 404. Nunca un delete por id a secas.
  const result = await prisma.barberTimeOff.deleteMany({
    where: { id: params.id, barbershopId: shopId },
  });
  if (result.count === 0) return jsonError("Ese bloqueo no existe.", 404);

  return NextResponse.json({ ok: true });
}
