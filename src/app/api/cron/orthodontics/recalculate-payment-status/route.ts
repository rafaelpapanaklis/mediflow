// Orthodontics — cron diario de mensualidades. SPEC §8.1 + §8.7 (histórico).
//
// Revisión cruzada (REPORTE-ws1-t1.md, «## Revisión cruzada», menor —
// "profundiza el bloque marcado QUITAR, no es un riesgo activo hoy porque el
// envío de WhatsApp sigue apagado"): este cron seguía recalculando
// `OrthoPaymentPlan.paidAmount/pendingAmount/status` y marcando
// `OrthoInstallment` como OVERDUE — el modelo LEGACY que la decisión 1 de la
// arquitectura (Ola 0, REPORTE-ws1-t8.md) dice que se oculta, nunca se lee ni
// se escribe: el dinero real vive en la factura del tratamiento
// (`orthodonticTreatmentPlan.invoiceId`) y se calcula EN VIVO con
// `cobranzaDelCaso` (cobranza-caso.ts) — nada se guarda ni se recalcula por
// cron en ese modelo nuevo, a propósito (ver cabecero de cobranza-caso.ts:
// "el dinero ya tiene una sola verdad: las filas de payments").
//
// Por eso este cron NO se "migra" a cobranza-caso.ts (no hay nada que
// recalcular ni guardar ahí) — se apaga: deja de tocar `OrthoInstallment`/
// `OrthoPaymentPlan` por completo. Sigue respondiendo 200 (vercel.json todavía
// lo llama a diario) para no romper el cron job, pero no hace nada — ni lee
// ni escribe tablas legacy, ni encola WhatsApp.
//
// El botón manual "Enviar recordatorio" de Alertas (L1,
// src/app/actions/orthodontics/whatsapp/sendMensualidadReminder.ts) ya cubre
// el aviso de mensualidad sobre la factura REAL, sin depender de este cron.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    console.error("[ortho cron] CRON_SECRET no configurado");
    return NextResponse.json({ ok: false, error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    apagado: true,
    motivo:
      "OrthoPaymentPlan/OrthoInstallment son legacy (decisión 1, Ola 0): el dinero real vive en la factura del tratamiento y se calcula en vivo con cobranzaDelCaso, sin cron. Este endpoint ya no lee ni escribe esas tablas.",
    timestamp: new Date().toISOString(),
  });
}
