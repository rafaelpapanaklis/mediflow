import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: { appointmentId: string } }
) {
  try {
    const { searchParams } = req.nextUrl;
    const role = searchParams.get("role");
    const token = searchParams.get("token");

    const appointment = await prisma.appointment.findUnique({
      where: { id: params.appointmentId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
        doctor:  { select: { id: true, firstName: true, lastName: true } },
        clinic:  { select: { id: true, name: true } },
      },
    });

    if (!appointment) {
      return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
    }

    // Verify access based on role
    if (role === "doctor") {
      const ctx = await getAuthContext();
      if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
      if (ctx.userId !== appointment.doctorId) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }
    } else if (role === "patient") {
      if (!token || token !== appointment.telePatientToken) {
        return NextResponse.json({ error: "Token inválido" }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: "Rol no válido" }, { status: 400 });
    }

    // Check if room is ready
    if (!appointment.teleRoomUrl) {
      return NextResponse.json({ error: "La sala aún no está lista" }, { status: 425 });
    }

    return NextResponse.json({
      roomUrl: appointment.teleRoomUrl,
      token: role === "doctor" ? appointment.teleDoctorToken : appointment.telePatientToken,
      appointmentId: appointment.id,
      patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`,
      doctorName: `${appointment.doctor.firstName} ${appointment.doctor.lastName}`,
      type: appointment.type,
    });
  } catch (error) {
    console.error("Error joining teleconsulta:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
