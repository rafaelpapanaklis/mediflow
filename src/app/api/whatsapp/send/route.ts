import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

async function getClinicId() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const cookieStore = cookies();
  const activeClinicId = cookieStore.get("activeClinicId")?.value;
  if (activeClinicId) {
    const u = await prisma.user.findFirst({ where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true } });
    if (u) return u.clinicId;
  }
  const dbUser = await prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true }, orderBy: { createdAt: "asc" } });
  return dbUser?.clinicId ?? null;
}

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

  const date = new Date(appt.date).toLocaleDateString("es-MX", {
    weekday: "long", day: "numeric", month: "long",
  });

  // Bidirectional reminder — patient can reply CONFIRMAR or CANCELAR
  const defaultMsg = clinic.waReminderMsg ||
    `Hola ${appt.patient.firstName} 👋, te recordamos que tienes una cita en *${clinic.name}* el *${date}* a las *${appt.startTime}h*.\n\nDr/a. ${appt.doctor.firstName} ${appt.doctor.lastName}\n\n✅ Responde *CONFIRMAR* para confirmar tu cita\n❌ Responde *CANCELAR* si no podrás asistir`;

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
