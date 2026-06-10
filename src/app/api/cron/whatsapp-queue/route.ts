// Cron — procesa la cola de WhatsAppReminder pendiente. A2 cross-módulos.
//
// Vercel Cron lo invoca cada 15 minutos con
// Authorization: Bearer ${CRON_SECRET}. El batchSize está limitado para
// no exceder el rate limit de WhatsApp Cloud API (≈80 msg/s nominal,
// conservador a 50 por tick).

import { NextResponse, type NextRequest } from "next/server";
import { processWhatsAppQueue } from "@/lib/whatsapp/queue-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/whatsapp-queue] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await processWhatsAppQueue({ batchSize: 50 });
  return NextResponse.json(summary);
}

// ─── Nota de schedule ────────────────────────────────────────────────
// Vercel Pro está activo y este cron ya corre cada 15 minutos
// (`"*/15 * * * *"` en vercel.json): procesamiento near-real-time de la
// cola, incluyendo los recordatorios automáticos de citas (APPT_AUTO,
// canales whatsapp/email) que encola /api/cron/appointment-reminders.
