// ═══════════════════════════════════════════════════════════════════════
// POST /api/barber/appointments/[id]/remind → «Mandar recordatorio ahora»
//
// Cita «B» (ws6-t5). Usa el MISMO motor de recordatorios que el automático
// (sendBarberReminderNow en src/lib/barber/whatsapp.ts): misma plantilla,
// ventana de 24 h, cupo y candado, y no duplica con el automático.
//
// Respuesta SIEMPRE 200 con { status: "sent" | "queued" | "skipped", reason,
// code } — «skipped» dice por qué (sin WhatsApp conectado, cita pasada o
// cancelada, ya salió uno hace poco…). Solo 401/403/404 son errores.
//
// QUIÉN: whatsapp.send (manda un mensaje en nombre de la barbería) y, sobre
// ESTA visita, agenda.edit o ser su barbero.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { sendBarberReminderNow } from "@/lib/barber/whatsapp";
import { canActOnOwnVisit, jsonError, openAgendaGate } from "../../_server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const branchId = new URL(req.url).searchParams.get("branchId");
  const gate = await openAgendaGate({ permission: "agenda.view", feature: "agenda", branchId });
  if (gate.response) return gate.response;
  const { shopId, ctx } = gate.gate;

  const appt = await prisma.barberAppointment.findFirst({
    where: { id, barbershopId: shopId },
    select: { id: true, barberId: true },
  });
  if (!appt) return jsonError("Esa visita no existe.", 404);
  const perm = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasBarberPermission(perm, "whatsapp.send") || !canActOnOwnVisit(ctx, appt)) {
    return jsonError("No tienes permiso para esto.", 403, { code: "FORBIDDEN", permission: "whatsapp.send" });
  }

  const result = await sendBarberReminderNow({ barbershopId: shopId, appointmentId: appt.id });
  return NextResponse.json(result);
}
