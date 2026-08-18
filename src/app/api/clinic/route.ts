import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { isValidLatLng } from "@/lib/directory/distance";

// Contexto vía el helper CENTRAL (getAuthContext): misma resolución
// cookie→clínica que la copia local que había aquí, pero pasando por los
// gates de 2FA y de plan vencido que la copia se saltaba. ctx.user es la fila
// User con permissionsOverride normalizado.
async function getDbUser() {
  const ctx = await getAuthContext();
  return ctx?.user ?? null;
}

export async function PATCH(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // EQ-07: "Editar configuración" del modal (por default SA/ADMIN, los mismos
  // que dejaba pasar la comprobación de rol que había aquí), con override.
  // RECEPTIONIST/DOCTOR siguen sin poder cambiar timezone/name/address salvo
  // que el dueño se lo encienda a propósito.
  const denied = denyIfMissingPermission(dbUser, "settings.edit");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  // Validar timezone IANA — string invalido tira Intl.DateTimeFormat con
  // RangeError en cada render. Verificar antes de persistir.
  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || body.timezone.length === 0) {
      return NextResponse.json({ error: "Zona horaria invalida" }, { status: 400 });
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: body.timezone });
    } catch {
      return NextResponse.json({ error: "Zona horaria no soportada (formato IANA)" }, { status: 400 });
    }
  }

  // Build update object — only update fields that were sent
  const data: Record<string, any> = {};
  if (body.name        !== undefined) data.name        = body.name;
  if (body.city        !== undefined) data.city        = body.city        || null;
  if (body.address     !== undefined) data.address     = body.address     || null;
  if (body.mapsUrl     !== undefined) data.mapsUrl     = body.mapsUrl     || null;
  if (body.phone       !== undefined) data.phone       = body.phone       || null;
  if (body.email       !== undefined) data.email       = body.email       || null;
  if (body.description !== undefined) data.description = body.description || null;
  if (body.isPublic    !== undefined) {
    data.isPublic      = Boolean(body.isPublic);
    data.landingActive = Boolean(body.isPublic);
  }
  if (body.category    !== undefined) data.category    = body.category;
  // NOM-024: CLUES Sector Salud (11 chars). Trim y null si vacío.
  if (body.clues       !== undefined) {
    const clues = typeof body.clues === "string" ? body.clues.trim() : "";
    data.clues = clues.length === 0 ? null : clues.slice(0, 11);
  }
  if (body.timezone !== undefined && typeof body.timezone === "string" && body.timezone.length > 0) {
    data.timezone = body.timezone;
  }
  // Idioma del panel por clínica: solo "es" | "en".
  if (body.locale !== undefined) {
    data.locale = body.locale === "en" ? "en" : "es";
  }
  // CRM — toggles de automatización (gated, default OFF).
  if (body.birthdayMsgActive      !== undefined) data.birthdayMsgActive      = Boolean(body.birthdayMsgActive);
  if (body.postApptFollowupActive !== undefined) data.postApptFollowupActive = Boolean(body.postApptFollowupActive);
  if (body.noShowTaskActive       !== undefined) data.noShowTaskActive       = Boolean(body.noShowTaskActive);
  // Portal del paciente — cambios de cita (WS1-T5). Auto-aprobar (default
  // false) + ventana mínima en horas (clamp 0..720, fallback 24 si NaN).
  if (body.patientChangesAutoApprove !== undefined) {
    data.patientChangesAutoApprove = Boolean(body.patientChangesAutoApprove);
  }
  if (body.patientChangesMinHours !== undefined) {
    const hours = parseInt(body.patientChangesMinHours, 10);
    data.patientChangesMinHours = Number.isNaN(hours) ? 24 : Math.max(0, Math.min(720, hours));
  }
  // Pin del mapa del directorio (WS2-T3). Se guarda el par completo o se limpia;
  // nunca medio pin. Solo se toca si el cliente envía lat/lng (settings → Clínica).
  if (body.latitude !== undefined || body.longitude !== undefined) {
    if (isValidLatLng(body.latitude, body.longitude)) {
      data.latitude = body.latitude;
      data.longitude = body.longitude;
    } else {
      data.latitude = null;
      data.longitude = null;
    }
  }

  // M-25: esta ruta devolvía la fila ENTERA de Clinic al navegador — token de
  // WhatsApp, llave viva de Facturapi, tokens de Google, API key de Daily,
  // hash del password del modo En Vivo. Cualquiera con acceso al panel (y
  // cualquier extensión del navegador) los leía en la respuesta del guardado.
  //
  // El `select` es explícito, no un strip a posteriori: así una columna
  // secreta que se añada mañana NO sale por aquí por defecto. Son exactamente
  // los campos que esta ruta puede escribir, más los que la UI repinta.
  const updated = await prisma.clinic.update({
    where: { id: dbUser.clinicId },
    data,
    select: {
      id: true,
      name: true,
      city: true,
      address: true,
      mapsUrl: true,
      phone: true,
      email: true,
      description: true,
      isPublic: true,
      landingActive: true,
      category: true,
      clues: true,
      timezone: true,
      locale: true,
      slug: true,
      logoUrl: true,
      latitude: true,
      longitude: true,
      birthdayMsgActive: true,
      postApptFollowupActive: true,
      noShowTaskActive: true,
      patientChangesAutoApprove: true,
      patientChangesMinHours: true,
      // Ajustes de recordatorios: los guarda esta misma ruta desde la pantalla
      // de WhatsApp. Son configuración, no credenciales.
      waReminderMsg: true,
      waReminder24h: true,
      waReminder1h: true,
      waReminderActive: true,
      waConnected: true,
    },
  });

  revalidateAfter("clinic");
  return NextResponse.json(updated);
}
