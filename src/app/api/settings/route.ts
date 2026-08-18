import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { encryptField, isEnvelope } from "@/lib/crypto/envelope";
import { stripClinicSecrets } from "@/lib/clinic-secrets";
import { sanitizeReminderSettings, sanitizeRecallSettings } from "@/lib/reminders/config";

/**
 * ISO-01 — esta ruta reescribe la IDENTIDAD de la clínica.
 *
 * El handler entero se guardaba con `if (!ctx) return 401` y nada más, así que
 * cualquier usuario con sesión —una recepcionista, un doctor, un usuario de
 * solo lectura— podía mandar un fetch y:
 *
 *   · cambiarle el nombre a la clínica,
 *   · meter un `rfcEmisor` falso, que es el que después sale en los CFDI,
 *   · apagar `isPublic` y sacar la mini-web del directorio,
 *   · poner SUS credenciales de Twilio y desviarse el WhatsApp entrante.
 *
 * Y todo eso sin pasar por la pantalla de Ajustes, que ya le daba 403 — porque
 * el botón de Ajustes pega a `/api/clinic`, no aquí. Su gemela escribe LOS
 * MISMOS campos (name/city/address/phone/email/description/isPublic) y sí
 * cortaba por rol; esta se quedó sin la puerta.
 *
 * El gate es el de `/api/clinic` letra por letra —rol de administrador— y no
 * un permiso del catálogo, a propósito: `settings.edit` hoy no lo lee NADIE
 * (EQ-07), así que empezar a exigirlo aquí dejaría fuera a cualquier
 * administrador cuyo `permissionsOverride` no lo incluya, y ese override
 * REEMPLAZA los defaults del rol. Eso se decide con los números en la mano,
 * no de paso en este arreglo.
 */
export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }

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
  // La fila completa incluye credenciales (Live Secret Key de Facturapi, tokens
  // de WhatsApp/Twilio/Google…) y esta ruta la puede llamar CUALQUIER usuario
  // autenticado de la clínica: se filtran antes de responder.
  return NextResponse.json(stripClinicSecrets(clinic));
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
  });

  return NextResponse.json(stripClinicSecrets(clinic));
}
