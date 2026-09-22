import { NextRequest, NextResponse } from "next/server";
import { describirResumen, liberarAnticiposVencidos } from "@/lib/anticipos/servicio.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/cron/anticipos — WS1-T5, anticipo por WhatsApp.
//
// Este cron NO es lo que libera el hueco de una cita cuyo anticipo no se pagó:
// eso ya pasó solo, por dato, en el instante del vencimiento (ver
// src/lib/agenda/apartado.ts y el trigger de sql/anticipo-whatsapp.sql). Si este
// cron no corre, la agenda NO se queda apartada. Lo que hace es ordenar la casa:
// marcar el anticipo vencido, cancelar la cita con su motivo y avisarle al
// paciente por WhatsApp. Idempotente: dos corridas a la vez no avisan dos veces.
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/anticipos] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const resumen = await liberarAnticiposVencidos();
    console.log(`[cron/anticipos] ${describirResumen(resumen)}`);
    return NextResponse.json({ ok: true, ...resumen });
  } catch (e) {
    console.error("[cron/anticipos] falló:", (e as Error).message);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
