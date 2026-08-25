import { NextResponse, type NextRequest } from "next/server";
import { processPortalQueue, processPortalQueueForAccount } from "@/lib/realty/portals";
import { requirePortalsAccess, serverError } from "@/app/api/realty/portals/_server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// ═══════════════════════════════════════════════════════════════════════
// LA COLA — /api/realty/portals/cola
//
// Dos formas de dispararla, a propósito:
//   GET  con Authorization: Bearer $CRON_SECRET  → TODAS las cuentas (cron)
//   POST con sesión de inmobiliaria              → SOLO su cuenta ("Revisar
//                                                  ahora" en la pantalla)
//
// Nunca es síncrona con la pantalla del asesor: los portales se caen y nadie
// se puede quedar mirando una rueda girando. El botón encola una pasada y la
// pantalla se refresca con lo que haya.
//
// ⚠️ EL CRON TODAVÍA NO ESTÁ DADO DE ALTA. `vercel.json` es un archivo
// compartido y está fuera del vertical de inmuebles, igual que le pasó al
// dispatch de barber. Mientras no se agregue la entrada, la reconciliación
// corre cuando alguien abre la pantalla o pulsa el botón — que para el feed
// no es grave, porque la despublicación real la hace el propio feed: un
// inmueble VENDIDO deja de cumplir la condición y sale en la siguiente
// lectura del portal, sin que la cola tenga que enterarse.
// Ver ORQUESTA.md → PENDIENTE.
// ═══════════════════════════════════════════════════════════════════════

/** Cron. Fail-closed: sin CRON_SECRET configurado, 503 y no corre nada. */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[api/realty/portals/cola] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await processPortalQueue({ limit: 200 });
    return NextResponse.json(summary);
  } catch (err) {
    return serverError("GET cola", err);
  }
}

/** Botón "Revisar ahora" del panel: solo la cuenta de quien lo pulsa. */
export async function POST() {
  const guard = await requirePortalsAccess();
  if (guard instanceof NextResponse) return guard;

  try {
    const summary = await processPortalQueueForAccount(guard.accountId);
    return NextResponse.json(summary);
  } catch (err) {
    return serverError("POST cola", err);
  }
}
