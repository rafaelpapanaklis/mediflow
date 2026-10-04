import { NextRequest, NextResponse } from "next/server";
import { cerrarCajasAMedianoche } from "@/lib/dinero/cierre-automatico.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/cron/caja-cierre — ws1-t5 (F7): cierre automático de caja a
// medianoche, SOLO en las clínicas que lo encendieron (apagado de fábrica).
// Cada 15 min: una caja abierta antes de la última medianoche de su clínica se
// cierra con un «corte automático sin conteo». Idempotente.
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/caja-cierre] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const resumen = await cerrarCajasAMedianoche();
    if (resumen.cerradas > 0 || resumen.errores > 0) console.log("[cron/caja-cierre]", resumen);
    return NextResponse.json({ ok: true, ...resumen });
  } catch (e) {
    console.error("[cron/caja-cierre] falló:", (e as Error).message);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
