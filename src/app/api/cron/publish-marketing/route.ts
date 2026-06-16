import { NextRequest, NextResponse } from "next/server";
import { drainScheduledPosts } from "@/lib/marketing/publish-scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/publish-marketing   (Vercel Cron: */5 * * * *)
// Drena MarketingPost SCHEDULED ya vencidos y los publica vía publishToMeta (T4).
// Idempotente entre corridas solapadas: cada post se reclama con un CAS por fila
// (ver src/lib/marketing/publish-scheduler.ts). Mismo patrón de auth que los
// demás crons (Bearer ${CRON_SECRET}).
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/publish-marketing] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await drainScheduledPosts();
  return NextResponse.json(result);
}
