// Cron: encola el aviso de la mensualidad POR VENCER (ws1-t3). Corre 1x/día
// (vercel.json "0 16 * * *" = 10:00 en México). Para cada clínica que lo tenga
// encendido, encola WhatsAppReminder type PAYMENT_DUE; el envío real lo hace
// /api/cron/whatsapp-queue vía el queue-worker. Mismo patrón de auth que los
// demás crons.
//
// Sin configuración guardada por la clínica, este cron no encola NADA: ver
// src/lib/whatsapp/cobranza/sweep.ts.

import { NextRequest, NextResponse } from "next/server";
import { sweepTodaLaCobranza } from "@/lib/whatsapp/cobranza/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/payment-reminders] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await sweepTodaLaCobranza();
  console.log(
    "[cron/payment-reminders]",
    JSON.stringify({
      clinics: summary.clinics,
      candidatas: summary.candidatas,
      encolados: summary.encolados,
      descartados: summary.descartados,
    }),
  );
  return NextResponse.json(summary);
}
