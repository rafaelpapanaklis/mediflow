// Cron — procesa ClinicalReminder próximos a vencer (lookahead 7d) y
// los encola en WhatsAppReminder con la plantilla del módulo origen.
//
// Vercel Cron lo invoca diariamente a las 12:00 UTC (06:00 MX).
// Authorization: Bearer ${CRON_SECRET}.

import { NextResponse, type NextRequest } from "next/server";
import { processClinicalReminders } from "@/lib/clinical-shared/reminders/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/clinical-reminders] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await processClinicalReminders({ batchSize: 200 });
  return NextResponse.json(summary);
}
