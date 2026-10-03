import { NextRequest, NextResponse } from "next/server";
import { correrCron } from "@/lib/cobro-automatico/servicio.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/cron/cobro-automatico — ws1-t6 (F1 de la auditoría de dinero).
//
// Corre a las 06:00 de la Ciudad de México (12:00 UTC), antes de que Mercado Pago
// cobre (los cargos se programan a las 10:00 de la clínica). Por cada
// suscripción que cobra o está pausada: se pone al día con MP y se reconcilia
// con su factura. Así se REANUDAN solas las pausas «del ciclo» (la mensualidad
// ya se había pagado a mano) y se pausa a tiempo un cargo cuya mensualidad se
// pagó por un camino que no avisó. Sin el SQL no hace nada. Idempotente.
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/cobro-automatico] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const r = await correrCron();
    console.log(`[cron/cobro-automatico] revisadas ${r.revisadas} · pausadas ${r.pausadas} · reanudadas ${r.reanudadas} · canceladas ${r.canceladas} · errores ${r.errores}`);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error("[cron/cobro-automatico] falló:", (e as Error).message);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
