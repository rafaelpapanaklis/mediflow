import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { deleteRoom } from "@/lib/daily";

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

    if (appointment.doctorId !== ctx.userId) {
      return NextResponse.json({ error: "Solo el doctor puede finalizar la sesión" }, { status: 403 });
    }

    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: "COMPLETED" },
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
