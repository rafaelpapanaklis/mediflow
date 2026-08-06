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

    // La ruta escribe COMPLETED sobre la cita: que sea de verdad una
    // teleconsulta, como ya exige `/room`. Sin esto, el atajo de estados de
    // abajo le daría a un doctor un SCHEDULED → COMPLETED sobre CUALQUIER cita
    // suya, transición que /complete y /status rechazan.
    if (appointment.mode !== "TELECONSULTATION") {
      return NextResponse.json({ error: "Esta cita no es teleconsulta" }, { status: 400 });
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
    //
    // CLAVE: lo que la máquina de estados condiciona es SOLO la escritura del
    // status. Colgar siempre "funciona". Si mientras el doctor estaba en la
    // llamada el paciente canceló por WhatsApp (el webhook escribe CANCELLED
    // directo) o recepción marcó NO_SHOW, la cita se queda como quedó —correcto,
    // es justo lo que el gate protege— pero la sala SÍ se destruye y la
    // respuesta es 200: devolver 409 aquí dejaba la sala viva y rejoinable con
    // los tokens del paciente, y el cliente (que no mira `res.ok`) pintaba
    // "consulta finalizada" igual. Un 409 que nadie lee es peor que el bug.
    const now = new Date();
    const check = canCloseTeleconsulta(
      appointment.status as Exclude<typeof appointment.status, "PENDING">,
      ctx.role as Role,
      now,
      appointment.startsAt,
    );

    if (check.ok) {
      await prisma.appointment.update({
        where: { id: appointmentId },
        data: { status: "COMPLETED", completedAt: now },
      });

      // NOM-024: las otras dos puertas a COMPLETED dejan rastro; ésta no
      // escribía nada. clinicId SIEMPRE de la sesión (multi-tenant).
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
    } else {
      // No se cambia el status, pero queda rastro de que se colgó: si no, este
      // caso sería invisible en la bitácora.
      console.warn(
        `[teleconsulta/end] cita ${appointmentId} colgada en estado ${appointment.status}: ${check.error}`,
      );
    }

    // Try to delete the Daily.co room, don't fail if it errors.
    // Fuera del if a propósito: la llamada terminó pase lo que pase con el
    // status, y dejar la sala viva es un acceso abierto al expediente.
    if (appointment.teleRoomId) {
      try {
        const roomName = appointmentId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
        await deleteRoom(roomName);
      } catch (e) {
        console.error("Error deleting Daily.co room:", e);
      }
    }

    return NextResponse.json({
      success: true,
      // `false` = la cita NO quedó COMPLETED porque su estado ya no lo permitía
      // (cancelada, no-show, o ya cerrada). La llamada terminó igual.
      statusChanged: check.ok,
      ...(check.ok ? {} : { reason: check.error }),
    });
  } catch (error) {
    console.error("Error ending teleconsulta:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
