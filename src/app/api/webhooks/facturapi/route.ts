import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { firmaValida, secretosDeWebhook, idDelEvento } from "@/lib/invoices/facturapi-webhook";
import { leerCfdiPorFacturapiId } from "@/lib/invoices/cfdi-cancelacion-db";
import { sincronizarCfdi } from "@/lib/invoices/cfdi-cancelacion.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/webhooks/facturapi — eventos de Facturapi (ws1-t3, F-03).
//
// Se da de alta en el dashboard de Facturapi, organización por organización,
// con los eventos `invoice.cancellation_status_updated` e
// `invoice.status_updated`, y el secreto que entrega Facturapi va en
// FACTURAPI_WEBHOOK_SECRET (varios, separados por coma). Sin secreto
// configurado se contesta 503: no se procesa nada sin firma.
//
// El evento solo sirve de «ve a mirar»: se toma el id del CFDI, se busca en
// `cfdi_records` y se le PREGUNTA a Facturapi con la llave de la clínica
// (`sincronizarCfdi`). Nunca se escribe el estado que trae el cuerpo.
export async function POST(req: NextRequest) {
  const secretos = secretosDeWebhook();
  if (secretos.length === 0) {
    console.error("[webhook/facturapi] FACTURAPI_WEBHOOK_SECRET no configurado");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  const cuerpo = await req.text();
  if (!firmaValida(cuerpo, req.headers.get("facturapi-signature"), secretos)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let evento: unknown = null;
  try { evento = JSON.parse(cuerpo); } catch { return NextResponse.json({ ok: true, ignored: "json" }); }
  const facturapiId = idDelEvento(evento);
  if (!facturapiId) return NextResponse.json({ ok: true, ignored: "evento" });

  const cfdi = await leerCfdiPorFacturapiId(prisma, facturapiId).catch(() => null);
  // Un CFDI que no es nuestro (o de otra plataforma en la misma cuenta): 200,
  // para que Facturapi no lo reintente para siempre.
  if (!cfdi) return NextResponse.json({ ok: true, ignored: "desconocido" });

  try {
    const r = await sincronizarCfdi(cfdi);
    if (r.recienCancelado) {
      console.info("[webhook/facturapi] CFDI cancelado ante el SAT:", {
        clinicId: cfdi.clinicId, cfdiId: cfdi.id, facturaLiberada: r.facturaLiberada,
      });
    }
    return NextResponse.json({ ok: true, status: r.efecto?.status ?? null, cancellationStatus: r.efecto?.cancellationStatus ?? null });
  } catch (e: any) {
    // 500 → Facturapi reintenta más tarde. El cron también lo recoge.
    console.error("[webhook/facturapi] no se pudo sincronizar:", { cfdiId: cfdi.id, e: e?.message ?? e });
    return NextResponse.json({ error: "sync failed" }, { status: 500 });
  }
}
