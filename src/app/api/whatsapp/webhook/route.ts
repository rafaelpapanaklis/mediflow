import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHmac } from "crypto";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

// GET — webhook verification by Meta
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WA_WEBHOOK_VERIFY_TOKEN ?? "mediflow_webhook_2026";

  if (mode === "subscribe" && token === verifyToken) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// POST — incoming messages from Meta
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    // Verify X-Hub-Signature-256 from Meta (REQUIRED)
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    const signature = req.headers.get("x-hub-signature-256");
    if (appSecret) {
      if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 403 });
      const expectedSig = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
      if (signature !== expectedSig) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
      }
    }

    const body = JSON.parse(rawBody);

    // Extract message from WhatsApp webhook payload
    const entry    = body?.entry?.[0];
    const changes  = entry?.changes?.[0];
    const value    = changes?.value;
    const messages = value?.messages;

    if (!messages?.length) return NextResponse.json({ ok: true });

    const msg      = messages[0];
    const from     = msg.from;           // patient's phone number (international format)
    const text     = msg.text?.body?.trim().toLowerCase() ?? "";

    if (!from || !text) return NextResponse.json({ ok: true });

    // Find clinic by WhatsApp phone number ID
    const phoneNumberId = value?.metadata?.phone_number_id;
    const clinic = await prisma.clinic.findFirst({
      where: { waPhoneNumberId: phoneNumberId },
    });
    if (!clinic) return NextResponse.json({ ok: true });

    // Find patient by phone number
    // Normalize: Meta sends "521234567890", strip country code to get last 10 digits
    const fromNormalized = from.replace(/^52/, "").slice(-10);
    const patient = await prisma.patient.findFirst({
      where: { clinicId: clinic.id, phone: { contains: fromNormalized } },
    });
    if (!patient) return NextResponse.json({ ok: true });

    // Find the most recent pending reminder for this patient
    const reminder = await prisma.whatsAppReminder.findFirst({
      where: {
        clinicId:    clinic.id,
        appointment: { patientId: patient.id },
        status:      "SENT",
        repliedAt:   null,
      },
      include: { appointment: true },
      orderBy: { sentAt: "desc" },
    });

    if (!reminder) return NextResponse.json({ ok: true });

    // Parse patient reply
    const isConfirm = ["si","sí","confirmar","confirmo","yes","1"].some(k => text.includes(k));
    const isCancel  = ["no","cancelar","cancelo","cancel","2"].some(k => text.includes(k));

    if (isConfirm) {
      await prisma.appointment.update({
        where: { id: reminder.appointmentId },
        data:  { status: "CONFIRMED", confirmedAt: new Date() },
      });
      await prisma.$executeRawUnsafe(
        `UPDATE whatsapp_reminders SET "patientReply"=$1,"repliedAt"=NOW() WHERE id=$2`,
        text, reminder.id
      );

      if (clinic.waAccessToken && clinic.waPhoneNumberId) {
        const appt = reminder.appointment;
        const dateStr = new Date(appt.date).toLocaleDateString("es-MX", {
          weekday: "long", day: "numeric", month: "long"
        });
        await sendWhatsAppMessage(clinic.waPhoneNumberId, clinic.waAccessToken, from,
          `✅ ¡Perfecto! Tu cita del ${dateStr} a las ${appt.startTime} está *confirmada*. Te esperamos. 😊`
        );
      }
    } else if (isCancel) {
      await prisma.appointment.update({
        where: { id: reminder.appointmentId },
        data:  { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Cancelado por paciente vía WhatsApp" },
      });
      await prisma.$executeRawUnsafe(
        `UPDATE whatsapp_reminders SET "patientReply"=$1,"repliedAt"=NOW() WHERE id=$2`,
        text, reminder.id
      );

      if (clinic.waAccessToken && clinic.waPhoneNumberId) {
        await sendWhatsAppMessage(clinic.waPhoneNumberId, clinic.waAccessToken, from,
          `❌ Tu cita ha sido *cancelada*. Si deseas reagendar, comunícate con nosotros. ¡Hasta pronto!`
        );
      }
    } else {
      // Save reply but don't change appointment status
      await prisma.$executeRawUnsafe(
        `UPDATE whatsapp_reminders SET "patientReply"=$1,"repliedAt"=NOW() WHERE id=$2`,
        text, reminder.id
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("WhatsApp webhook error:", err);
    return NextResponse.json({ ok: true }); // always 200 to avoid Meta retries
  }
}
