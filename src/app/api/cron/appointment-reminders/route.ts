// Cron: encola recordatorios automáticos de citas (24h/2h antes, configurable
// por clínica). Corre cada 15 min (vercel.json). El envío real lo hace
// /api/cron/whatsapp-queue vía el queue-worker (WhatsApp y email).

import { NextRequest, NextResponse } from "next/server";
import { sweepAppointmentReminders } from "@/lib/reminders/enqueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/appointment-reminders] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await sweepAppointmentReminders();
  return NextResponse.json(summary);
}
