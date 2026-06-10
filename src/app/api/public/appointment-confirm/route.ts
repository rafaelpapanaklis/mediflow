// Endpoint PÚBLICO (sin login): confirmar / cancelar asistencia a una cita
// vía confirmToken. El token aleatorio es la credencial; no se exponen ids.
//
// POST { token: string, action: "confirm" | "cancel" }

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, 10, 60_000);
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const token = body && typeof body.token === "string" ? body.token.trim() : "";
  const action = body ? body.action : null;
  if (!token || token.length > 64 || (action !== "confirm" && action !== "cancel")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const appt = await prisma.appointment.findUnique({
    where: { confirmToken: token },
    select: { id: true, startsAt: true, status: true },
  });
  // 404 genérico: no se distingue entre token inexistente o mal formado.
  if (!appt) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const now = new Date();
  if (appt.startsAt < now) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  if (action === "confirm") {
    if (appt.status === "PENDING" || appt.status === "SCHEDULED") {
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { status: "CONFIRMED", confirmedAt: now },
      });
      return NextResponse.json({ status: "CONFIRMED", changed: true });
    }
    if (appt.status === "CONFIRMED") {
      // Idempotente: ya estaba confirmada.
      return NextResponse.json({ status: "CONFIRMED", changed: false });
    }
    return NextResponse.json({ status: appt.status, changed: false });
  }

  // action === "cancel"
  if (
    appt.status === "PENDING" ||
    appt.status === "SCHEDULED" ||
    appt.status === "CONFIRMED"
  ) {
    await prisma.appointment.update({
      where: { id: appt.id },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelReason: "Canceló desde el enlace de confirmación",
      },
    });
    return NextResponse.json({ status: "CANCELLED", changed: true });
  }
  if (appt.status === "CANCELLED") {
    return NextResponse.json({ status: "CANCELLED", changed: false });
  }
  return NextResponse.json({ status: appt.status, changed: false });
}
