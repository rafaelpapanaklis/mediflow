// Cron: recall genérico (reactivación automática de pacientes). Corre 1x/día
// (vercel.json "0 14 * * *" = 8:00 MX). Para cada clínica con recall activo,
// encola WhatsAppReminder type RECALL (los envía /api/cron/whatsapp-queue) y
// manda los emails inline. Mismo patrón de auth que los demás crons.

import { NextRequest, NextResponse } from "next/server";
import { sweepAllRecalls } from "@/lib/recall/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/recall-sweep] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await sweepAllRecalls();
  console.log(
    "[cron/recall-sweep]",
    JSON.stringify({
      clinics: summary.clinics,
      due: summary.due,
      queuedWhatsapp: summary.queuedWhatsapp,
      sentEmail: summary.sentEmail,
      failedEmail: summary.failedEmail,
      skipped: summary.skipped,
    }),
  );
  return NextResponse.json(summary);
}
