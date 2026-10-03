// Implants — cron diario que encola los ClinicalReminder de implantes en la cola de WhatsApp.
//
// Ejecutado por Vercel Cron (vercel.json, 12:15 UTC ≈ 06:15 MX) — autenticado vía CRON_SECRET. Encola los
// recordatorios de implantes (set v2) que vencen entre hace 7 días y dentro de 24 h, en clínicas con
// recordatorios y WhatsApp encendidos; el envío lo hace el worker de la cola (api/cron/whatsapp-queue).
// La lógica, con su reclamo atómico y su ventana, vive en src/lib/clinical-shared/reminders/implants-worker.ts.

import { NextRequest, NextResponse } from "next/server";
import { processImplantReminders } from "@/lib/clinical-shared/reminders/implants-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await processImplantReminders());
}
