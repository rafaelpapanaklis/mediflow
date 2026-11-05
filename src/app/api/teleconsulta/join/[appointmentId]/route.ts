import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { nombreDelDoctor } from "@/lib/reminders/doctor-del-mensaje";

export async function GET(req: NextRequest, props: { params: Promise<{ appointmentId: string }> }) {
  const params = await props.params;
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
      // Visibilidad: si a este doctor le restringieron el paciente DESPUÉS de
      // asignarle la cita, ya no puede ver su identidad aunque siga siendo el
      // doctorId. assertPatientVisible además scopea por clínica (el findUnique no).
      if (appointment.patientId) {
        const denied = await assertPatientVisible(appointment.patientId, {
          userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
        });
        if (denied) return denied;
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
      // Cita «Sin doctor» no llega aquí (D11); si llegara, sin nombre en vez de un 500.
      doctorName: nombreDelDoctor(appointment.doctor) ?? "",
      type: appointment.type,
    });
  } catch (error) {
    console.error("Error joining teleconsulta:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
