// ═══════════════════════════════════════════════════════════════════════
// DELETE /api/barber/schedules/timeoff/[id]  → quitar un bloqueo
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError, openAgendaGate } from "../../../appointments/_server";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const gate = await openAgendaGate({ permission: "schedule.manage", feature: "agenda" });
  if (gate.response) return gate.response;
  const { shopId } = gate.gate;

  // deleteMany con el filtro de inquilino: si el id es de otra barbería,
  // borra cero filas y contesta 404. Nunca un delete por id a secas.
  const result = await prisma.barberTimeOff.deleteMany({
    where: { id: params.id, barbershopId: shopId },
  });
  if (result.count === 0) return jsonError("Ese bloqueo no existe.", 404);

  return NextResponse.json({ ok: true });
}
