import { NextRequest, NextResponse } from "next/server";
import getStripe from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { createRoom, createMeetingToken } from "@/lib/daily";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const sig = req.headers.get("stripe-signature");

    if (!sig) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    const stripe = getStripe();
    const event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as any;
      const appointmentId = session.metadata?.appointmentId;

      if (!appointmentId) {
        console.error("Stripe webhook: no appointmentId in metadata");
        return NextResponse.json({ received: true });
      }

      // Update payment status
      await prisma.appointment.update({
        where: { id: appointmentId },
        data: {
          paymentStatus: "paid",
          paymentAmount: (session.amount_total ?? 0) / 100,
          stripePaymentId: session.payment_intent as string,
        },
      });

      // Fetch full appointment data
      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
          doctor:  { select: { id: true, firstName: true, lastName: true, phone: true } },
          clinic:  { select: { id: true, name: true, waConnected: true, waPhoneNumberId: true, waAccessToken: true, teleCommissionPct: true } },
        },
      });

      if (!appointment) {
        console.error("Stripe webhook: appointment not found", appointmentId);
        return NextResponse.json({ received: true });
      }

      // Create Daily.co room + tokens
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

      // Format date for messages
      const dateObj = new Date(appointment.date);
      const fecha = dateObj.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
      const hora = appointment.startTime;
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      const paymentAmount = (session.amount_total ?? 0) / 100;
      const commissionPct = appointment.clinic.teleCommissionPct ?? 10;
      const commission = Math.round(paymentAmount * (commissionPct / 100) * 100) / 100;
      const doctorAmount = paymentAmount - commission;

      // Send WhatsApp to patient
      if (appointment.clinic.waConnected && appointment.clinic.waPhoneNumberId && appointment.clinic.waAccessToken && appointment.patient.phone) {
        try {
          const patientMsg = `✅ Pago confirmado — Teleconsulta con Dr/a. ${appointment.doctor.firstName} ${appointment.doctor.lastName}\n📅 ${fecha}\n🕐 ${hora}\n💻 Únete aquí: ${appUrl}/teleconsulta/${appointmentId}?role=patient&token=${patientToken}\n\nRecomendaciones:\n- Usa conexión estable\n- Usa audífonos\n- Entra 5 min antes`;

          await sendWhatsAppMessage(
            appointment.clinic.waPhoneNumberId,
            appointment.clinic.waAccessToken,
            appointment.patient.phone,
            patientMsg
          );
        } catch (e) {
          console.error("WhatsApp to patient failed:", e);
        }
      }

      // Send WhatsApp to doctor
      if (appointment.clinic.waConnected && appointment.clinic.waPhoneNumberId && appointment.clinic.waAccessToken && appointment.doctor.phone) {
        try {
          const doctorMsg = `📹 Nueva teleconsulta pagada\n👤 Paciente: ${appointment.patient.firstName} ${appointment.patient.lastName}\n📅 ${fecha} a las ${hora}\n💻 Únete: ${appUrl}/teleconsulta/${appointmentId}?role=doctor\n💰 Recibirás $${doctorAmount} después de la sesión`;

          await sendWhatsAppMessage(
            appointment.clinic.waPhoneNumberId,
            appointment.clinic.waAccessToken,
            appointment.doctor.phone,
            doctorMsg
          );
        } catch (e) {
          console.error("WhatsApp to doctor failed:", e);
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook error:", error);
    return NextResponse.json({ error: "Webhook error" }, { status: 500 });
  }
}
