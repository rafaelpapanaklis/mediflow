import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

async function getClinicId() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const dbUser = await prisma.user.findUnique({ where: { supabaseId: user.id } });
  return dbUser?.clinicId ?? null;
}

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  message: string
) {
  // Format phone number - remove spaces, dashes, ensure country code
  const phone = to.replace(/[\s\-\(\)]/g, "");
  const formattedPhone = phone.startsWith("+") ? phone.slice(1) : phone.startsWith("52") ? phone : `52${phone}`;

  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: formattedPhone,
      type: "text",
      text: { body: message },
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message ?? "Error al enviar mensaje");
  }
  return await res.json();
}

// Send reminder manually for a specific appointment
export async function POST(req: NextRequest) {
  const clinicId = await getClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { appointmentId } = await req.json();

  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId } });
  if (!clinic?.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
    return NextResponse.json({ error: "WhatsApp no está conectado" }, { status: 400 });
  }

  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId },
    include: { patient: true, doctor: true },
  });
  if (!appt) return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
  if (!appt.patient.phone) return NextResponse.json({ error: "El paciente no tiene teléfono registrado" }, { status: 400 });

  const date = new Date(appt.date).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  const defaultMsg = clinic.waReminderMsg ||
    `Hola ${appt.patient.firstName} 👋, te recordamos que tienes una cita en *${clinic.name}* el *${date}* a las *${appt.startTime}h*.\n\nDr/a. ${appt.doctor.firstName} ${appt.doctor.lastName}\n\n_Si necesitas cancelar o reprogramar, responde este mensaje._`;

  try {
    await sendWhatsAppMessage(clinic.waPhoneNumberId, clinic.waAccessToken, appt.patient.phone, defaultMsg);
    await prisma.appointment.update({ where: { id: appointmentId }, data: { reminderSent: true } });
    await prisma.whatsAppReminder.create({
      data: { clinicId, appointmentId, type: "MANUAL", status: "SENT", sentAt: new Date(), scheduledFor: new Date() },
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    await prisma.whatsAppReminder.create({
      data: { clinicId, appointmentId, type: "MANUAL", status: "FAILED", errorMsg: err.message, scheduledFor: new Date() },
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
