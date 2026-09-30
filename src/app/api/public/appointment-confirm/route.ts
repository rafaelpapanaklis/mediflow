// Endpoint PÚBLICO (sin login): confirmar / cancelar asistencia a una cita
// vía confirmToken. El token aleatorio es la credencial; no se exponen ids.
//
// POST { token: string, action: "confirm" | "cancel" }

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { marcarPendienteSiHayDinero } from "@/lib/anticipos/cita-cancelada.server";
import { registrarMovimientoExterno } from "@/lib/movimientos-paciente/registrar";
import { textoCita } from "@/lib/movimientos-paciente/textos";
import { zonaDeClinica } from "@/lib/movimientos-paciente/zona";
import { sincronizarCitaEnSegundoPlano } from "@/lib/agenda/google-sync";

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
    select: { id: true, clinicId: true, patientId: true, startsAt: true, status: true, holdExpiresAt: true },
  });
  // 404 genérico: no se distingue entre token inexistente o mal formado.
  if (!appt) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const now = new Date();
  if (appt.startsAt < now) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  if (action === "confirm") {
    // WS1-T5 — la cita apartada esperando el anticipo solo la confirma el pago.
    if (appt.status === "SCHEDULED" && appt.holdExpiresAt) {
      return NextResponse.json({ error: "espera_anticipo" }, { status: 409 });
    }
    if (appt.status === "PENDING" || appt.status === "SCHEDULED") {
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { status: "CONFIRMED", confirmedAt: now },
      });
      await registrarMovimientoExterno({
        actor: "public",
        clinicId: appt.clinicId,
        patientId: appt.patientId,
        entityType: "appointment",
        entityId: appt.id,
        action: "update",
        texto: `${textoCita.estado(appt.startsAt, appt.status, "CONFIRMED", await zonaDeClinica(appt.clinicId))} (desde el enlace de confirmación)`,
        campos: ["status"],
        req,
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
    // Google Calendar: la cita quedó cancelada, el evento se borra. No lanza.
    await sincronizarCitaEnSegundoPlano(appt.clinicId, appt.id);
    // H15 (ws1-t4): si su factura tiene dinero, queda «pendiente de decidir».
    await marcarPendienteSiHayDinero({ clinicId: appt.clinicId, appointmentId: appt.id, quien: "el paciente (enlace de confirmación)" });
    await registrarMovimientoExterno({
      actor: "public",
      clinicId: appt.clinicId,
      patientId: appt.patientId,
      entityType: "appointment",
      entityId: appt.id,
      action: "update",
      texto: `${textoCita.cancelada(appt.startsAt, await zonaDeClinica(appt.clinicId))} (desde el enlace de confirmación)`,
      campos: ["status"],
      req,
    });
    return NextResponse.json({ status: "CANCELLED", changed: true });
  }
  if (appt.status === "CANCELLED") {
    return NextResponse.json({ status: "CANCELLED", changed: false });
  }
  return NextResponse.json({ status: appt.status, changed: false });
}
