import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createRoom, createMeetingToken } from "@/lib/daily";

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const { appointmentId } = await req.json();

    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId: ctx.clinicId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
        doctor:  { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!appointment) {
      return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
    }

    if (appointment.mode !== "TELECONSULTATION") {
      return NextResponse.json({ error: "Esta cita no es teleconsulta" }, { status: 400 });
    }

    if (appointment.paymentStatus !== "paid") {
      return NextResponse.json({ error: "El pago no ha sido confirmado" }, { status: 400 });
    }

    // Calculate room expiration: appointment date + endTime + 1 hour
    const [endH, endM] = appointment.endTime.split(":").map(Number);
    const expiresAt = new Date(appointment.date);
    expiresAt.setHours(endH + 1, endM, 0, 0);

    const room = await createRoom(appointmentId, expiresAt);

    const roomName = appointmentId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
    const doctorToken = await createMeetingToken(roomName, true, `Dr. ${appointment.doctor.firstName} ${appointment.doctor.lastName}`);
    const patientToken = await createMeetingToken(roomName, false, `${appointment.patient.firstName} ${appointment.patient.lastName}`);

    await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        teleRoomId: room.id,
        teleRoomUrl: room.url,
        teleDoctorToken: doctorToken,
        telePatientToken: patientToken,
      },
    });

    return NextResponse.json({ roomUrl: room.url, doctorToken, patientToken });
  } catch (error) {
    console.error("Error creating teleconsulta room:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
