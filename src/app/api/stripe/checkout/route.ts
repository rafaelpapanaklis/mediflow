import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createCheckoutSession } from "@/lib/stripe-connect";
import { timeHHMMInTz } from "@/lib/agenda/legacy-helpers";

export async function POST(req: NextRequest) {
  try {
    const { appointmentId } = await req.json();

    // Public endpoint — auth is optional
    const ctx = await getAuthContext();

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, email: true } },
        doctor:  { select: { id: true, firstName: true, lastName: true, stripeAccountId: true } },
        clinic:  { select: { id: true, name: true, timezone: true, teleCommissionPct: true } },
      },
    });

    if (!appointment) {
      return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
    }

    if (appointment.mode !== "TELECONSULTATION") {
      return NextResponse.json({ error: "Esta cita no es teleconsulta" }, { status: 400 });
    }

    if (appointment.paymentStatus === "paid") {
      return NextResponse.json({ error: "Esta cita ya fue pagada" }, { status: 400 });
    }

    if (!appointment.doctor.stripeAccountId) {
      return NextResponse.json({ error: "Doctor no configurado para pagos" }, { status: 400 });
    }

    // Format date and time for display
    const dateFormatted = new Intl.DateTimeFormat("es-MX", {
      timeZone: appointment.clinic.timezone, weekday: "long", day: "numeric", month: "long",
    }).format(appointment.startsAt);

    const { sessionId, url } = await createCheckoutSession({
      appointmentId: appointment.id,
      amount: appointment.paymentAmount ?? 0,
      doctorStripeAccountId: appointment.doctor.stripeAccountId,
      commissionPct: appointment.clinic.teleCommissionPct ?? 10,
      patientEmail: appointment.patient.email ?? undefined,
      clinicName: appointment.clinic.name,
      doctorName: `${appointment.doctor.firstName} ${appointment.doctor.lastName}`,
      appointmentDate: dateFormatted,
      appointmentTime: timeHHMMInTz(appointment.startsAt, appointment.clinic.timezone),
    });

    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { stripeSessionId: sessionId },
    });

    return NextResponse.json({ url });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
