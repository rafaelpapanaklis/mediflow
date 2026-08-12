// Cron — respaldo del webhook de plantillas de WhatsApp.
//
// Meta avisa por `message_template_status_update` cuando aprueba o rechaza una
// plantilla, pero ese aviso se puede perder (webhook caído, campo sin suscribir
// en la app, reintentos agotados). Si se pierde, la plantilla se queda "en
// revisión" para siempre y con ella los recordatorios de esa clínica apagados,
// sin que nadie se entere.
//
// Por eso este barrido: para las clínicas con alguna plantilla en revisión
// desde hace más de 24 h, pregunta a Meta el estado REAL y actualiza
// `waTemplates`. Idempotente: si nada cambió, no escribe.
//
// Vercel Cron lo invoca con Authorization: Bearer ${CRON_SECRET}.

import { NextResponse, type NextRequest } from "next/server";
import {
  clinicsWithStalePendingTemplates,
  syncClinicTemplates,
} from "@/lib/whatsapp/provision-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Horas que una plantilla puede llevar "en revisión" antes de ir a preguntar. */
const STALE_HOURS = 24;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/whatsapp-templates] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clinicIds = await clinicsWithStalePendingTemplates(STALE_HOURS);
  const summary = { clinics: clinicIds.length, updated: 0, changed: 0, failed: 0 };

  for (const clinicId of clinicIds) {
    // Secuencial a propósito: son pocas clínicas por corrida y cada una habla
    // con Meta con su propio token; en paralelo solo se ganaría rate limit.
    const res = await syncClinicTemplates(clinicId).catch((e) => {
      console.error(`[cron/whatsapp-templates] clínica ${clinicId}:`, e);
      return null;
    });
    if (!res || !res.ok) {
      summary.failed++;
      continue;
    }
    if (res.changed > 0) {
      summary.updated++;
      summary.changed += res.changed;
    }
  }

  return NextResponse.json(summary);
}
