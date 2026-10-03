import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cfdisPorRevisar } from "@/lib/invoices/cfdi-cancelacion-db";
import { sincronizarCfdi } from "@/lib/invoices/cfdi-cancelacion.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Por corrida: Facturapi se consulta de uno en uno, sin ráfagas. */
const LIMITE = 40;
/** Solo lo timbrado en los últimos 120 días (más lo que tenga cancelación en curso). */
const DIAS = 120;

/**
 * GET /api/cron/cfdi-estado — consulta en Facturapi el estado de los CFDI
 * (ws1-t3, F-03). Primero las cancelaciones en curso (pendientes de que el
 * receptor acepte, verificando o «inciertas»), después los vigentes que hace
 * más tiempo no se revisan: así también se entera de lo que alguien canceló
 * desde el dashboard de Facturapi aunque el webhook no esté dado de alta.
 * Solo LEE en Facturapi; nunca cancela ni timbra. Errores aislados por CFDI.
 */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/cfdi-estado] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const filas = await cfdisPorRevisar(prisma, { limite: LIMITE, dias: DIAS });
  let revisados = 0, cancelados = 0, liberadas = 0, errores = 0;
  for (const cfdi of filas) {
    try {
      const r = await sincronizarCfdi(cfdi);
      revisados += 1;
      if (r.recienCancelado) cancelados += 1;
      if (r.facturaLiberada) liberadas += 1;
    } catch (e: any) {
      errores += 1;
      console.error("[cron/cfdi-estado] no se pudo revisar:", { cfdiId: cfdi.id, e: e?.message ?? e });
    }
  }
  return NextResponse.json({ ok: true, revisados, cancelados, liberadas, errores });
}
