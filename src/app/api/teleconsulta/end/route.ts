import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { getAuthContext } from "@/lib/auth-context";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { deleteRoom } from "@/lib/daily";
import { canCloseTeleconsulta } from "@/lib/agenda/transitions";
import { logMutation } from "@/lib/audit";

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const { appointmentId } = await req.json();

    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId: ctx.clinicId },
    });

    if (!appointment) {
      return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
    }

    // Visibilidad por paciente (barrido Ola 3): room y join ya assertan; end
    // era la única sin gate. 404 antes del 403 de doctor-dueño.
    if (appointment.patientId) {
      const visDenied = await assertPatientVisible(appointment.patientId, {
        userId: ctx.userId,
        role: ctx.role,
        clinicId: ctx.clinicId,
      });
      if (visDenied) return visDenied;
    }

    if (appointment.doctorId !== ctx.userId) {
      return NextResponse.json({ error: "Solo el doctor puede finalizar la sesión" }, { status: 403 });
    }

    if (appointment.status === "PENDING") {
      return NextResponse.json(
        { error: "legacy_status", reason: "Status PENDING ya no soportado. Migrá a SCHEDULED." },
        { status: 409 },
      );
    }

    // Máquina de estados (P1-1). Ésta es la TERCERA puerta que escribe
    // COMPLETED sobre una cita, junto a PATCH /status y PATCH /[id]/complete, y
    // era la única sin ninguna validación de estado de origen: cerrar una cita
    // ya CANCELLED, o cerrarla dos veces, pasaba sin más.
    //
    // Se valida por el camino que de verdad ocurrió: colgar la videollamada es
    // iniciar y cerrar la consulta de una. El porqué del doble salto está
    // documentado en `canCloseTeleconsulta` — resumen: nada en el flujo de
    // teleconsulta mueve la cita a IN_PROGRESS, así que exigir X → COMPLETED a
    // secas daría 409 en el 100% de las teleconsultas reales.
    const now = new Date();
    const check = canCloseTeleconsulta(
      appointment.status as Exclude<typeof appointment.status, "PENDING">,
      ctx.role as Role,
      now,
      appointment.startsAt,
    );
    if (!check.ok) {
      // La sala de Daily NO se borra si la transición no procede: el doctor
      // sigue dentro de la llamada y quitarle la sala por un 409 sería peor que
      // el bug. Mismo contrato de códigos que PATCH /status.
      if (check.code === "forbidden_role") {
        return NextResponse.json({ error: "forbidden", reason: check.error }, { status: 403 });
      }
      return NextResponse.json(
        { error: "invalid_transition", reason: check.error },
        { status: 409 },
      );
    }

    await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: "COMPLETED",
        completedAt: now,
        // El paso por IN_PROGRESS fue real (la llamada ocurrió): se deja su
        // timestamp si no lo había, para que la duración en analytics no salga
        // nula. Si ya estaba, se respeta.
        startedAt: appointment.startedAt ?? now,
      },
    });

    // NOM-024: las otras dos puertas a COMPLETED dejan rastro; ésta no escribía
    // nada. clinicId SIEMPRE de la sesión (multi-tenant); best-effort.
    await logMutation({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "appointment",
      entityId: appointmentId,
      action: "update",
      before: { status: appointment.status },
      after: { status: "COMPLETED", completedAt: now.toISOString(), via: "teleconsulta" },
    });

    // Try to delete the Daily.co room, don't fail if it errors
    if (appointment.teleRoomId) {
      try {
        const roomName = appointmentId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
        await deleteRoom(roomName);
      } catch (e) {
        console.error("Error deleting Daily.co room:", e);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error ending teleconsulta:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
