// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — puerta común de las APIs de WhatsApp.
//
// Reutiliza openAgendaGate (src/app/api/barber/appointments/_server.ts):
// sesión → sede accesible → feature del plan → permiso del rol, en ese
// orden y con el barbershopId SIEMPRE saliendo de la sesión. No se inventa
// otro check: punto único, igual que el resto del vertical.
//
// DOS FEATURES DISTINTAS, A PROPÓSITO:
//   · whatsappReminders → la tienen TODOS los planes. Es lo que habilita
//     conectar el número y mandar recordatorios: sin eso, el Básico no
//     podría ni conectar su WhatsApp y los recordatorios que sí incluye su
//     plan nunca saldrían.
//   · whatsappInbox     → Avanzado y Profesional. Es la bandeja: leer
//     hilos, responder a mano y ver multimedia.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { openAgendaGate, jsonError, readJson, asString } from "../appointments/_server";
import type { BarberPermissionKey } from "@/lib/barber-auth";

export { jsonError, readJson, asString };

/** Feature mínima para conectar el número y mandar recordatorios. */
export const WA_REMINDERS_FEATURE = "whatsappReminders" as const;
/** Feature de la bandeja de entrada. */
export const WA_INBOX_FEATURE = "whatsappInbox" as const;

export async function openWaGate(opts: {
  permission: BarberPermissionKey;
  feature?: string | null;
  branchId?: string | null;
}) {
  return openAgendaGate({
    permission: opts.permission,
    feature: opts.feature === undefined ? WA_REMINDERS_FEATURE : opts.feature,
    branchId: opts.branchId ?? null,
  });
}

/**
 * Autoriza al cron. Mismo criterio que los crons del dental: cabecera de
 * Vercel o CRON_SECRET. En producción SIN secreto configurado se rechaza —
 * un endpoint que dispara envíos de pago no puede quedar abierto.
 */
export function cronAuthorized(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) return null;
  // Vercel firma sus invocaciones de cron con esta cabecera.
  if (req.headers.get("x-vercel-cron")) return null;
  return NextResponse.json({ error: "No autorizado" }, { status: 401 });
}
