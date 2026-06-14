import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { encryptField, isEnvelope } from "@/lib/crypto/envelope";
import { sanitizeReminderSettings, sanitizeRecallSettings } from "@/lib/reminders/config";

export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  // Whitelist of allowed fields to update
  const allowed = [
    "name", "phone", "email", "address", "city", "description", "logoUrl",
    "taxId", "rfcEmisor", "regimenFiscal", "cpEmisor",
    "waReminderActive", "waReminder24h", "waReminder1h", "waReminderMsg",
    "recallActive", "recallMonths",
    "isPublic",
    // Inbox integrations (Fase 6)
    "twilioAccountSid", "twilioAuthToken", "twilioWhatsappNumber",
    "postmarkInboundEmail",
  ];

  const data: Record<string, any> = {};
  for (const key of allowed) {
    if (key in body) data[key] = body[key];
  }

  // reminderSettings = config de recordatorios de cita (offsets/canal/plantilla)
  // + reminderSettings.recall = config del recall genérico (WS1-T8). Comparten
  // el MISMO Json, así que al guardar una mitad LEEMOS la actual y mezclamos
  // para no pisar la otra. `reminderSettings: null` limpia la config de citas
  // (el recall se conserva); `recall: null` limpia sólo el recall.
  if ("reminderSettings" in body || "recall" in body) {
    const current = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { reminderSettings: true },
    });
    const cur =
      current?.reminderSettings &&
      typeof current.reminderSettings === "object" &&
      !Array.isArray(current.reminderSettings)
        ? (current.reminderSettings as Record<string, any>)
        : null;

    // Parte de recordatorios de cita.
    let apptPart: ReturnType<typeof sanitizeReminderSettings> | undefined;
    if ("reminderSettings" in body) {
      if (body.reminderSettings === null) {
        apptPart = undefined;
      } else {
        apptPart = sanitizeReminderSettings(body.reminderSettings);
        if (!apptPart) {
          return NextResponse.json({ error: "reminderSettings inválido" }, { status: 400 });
        }
      }
    } else {
      apptPart = sanitizeReminderSettings(cur) ?? undefined;
    }

    // Parte de recall.
    let recallPart: ReturnType<typeof sanitizeRecallSettings> | undefined;
    if ("recall" in body) {
      if (body.recall === null) {
        recallPart = undefined;
      } else {
        recallPart = sanitizeRecallSettings(body.recall);
        if (!recallPart) {
          return NextResponse.json({ error: "recall inválido" }, { status: 400 });
        }
      }
    } else {
      recallPart = cur?.recall ? sanitizeRecallSettings(cur.recall) ?? undefined : undefined;
    }

    const merged: Record<string, any> = {};
    if (apptPart) Object.assign(merged, apptPart);
    if (recallPart) merged.recall = recallPart;
    data.reminderSettings = Object.keys(merged).length > 0 ? merged : Prisma.DbNull;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // twilioAuthToken se guarda cifrado en reposo (envelope AES-256-GCM); se
  // descifra solo al usarlo en twilio-conversations. isEnvelope evita
  // re-cifrar si el cliente reenvía un valor ya cifrado.
  if (typeof data.twilioAuthToken === "string" && data.twilioAuthToken && !isEnvelope(data.twilioAuthToken)) {
    data.twilioAuthToken = encryptField(data.twilioAuthToken);
  }

  const clinic = await prisma.clinic.update({
    where: { id: ctx.clinicId },
    data,
  });

  revalidateAfter("clinic");
  return NextResponse.json(clinic);
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
  });

  return NextResponse.json(clinic);
}
