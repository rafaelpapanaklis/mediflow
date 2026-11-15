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
 * Autoriza al cron. EL MISMO criterio que los crons del dental
 * (src/app/api/cron/whatsapp-queue): `Authorization: Bearer ${CRON_SECRET}`,
 * que es lo que Vercel Cron manda solo cuando la variable existe. Sin
 * CRON_SECRET configurado se responde 503 — un endpoint que dispara envíos
 * de pago no puede quedar abierto.
 *
 * 🔴 Antes bastaba con que la petición trajera la cabecera `x-vercel-cron`.
 * Esa cabecera la puede escribir cualquiera desde su casa: con un
 * `curl -H "x-vercel-cron: 1"` se disparaba el despacho de TODAS las
 * barberías sin credencial alguna.
 */
export function cronAuthorized(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[barber/whatsapp/dispatch] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron no configurado" }, { status: 503 });
  }
  if (req.headers.get("authorization") === `Bearer ${secret}`) return null;
  return NextResponse.json({ error: "No autorizado" }, { status: 401 });
}
