import { NextResponse, type NextRequest } from "next/server";
import { clinicaDelAviso, sincronizarCalendarioEntrante } from "@/lib/google/entrante.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST ← Google: «algo cambió en el calendario» (canal de events.watch, WS1-T9).
//
// Google no manda el cambio, solo el aviso: aquí se verifica que el canal es
// el VIGENTE de una clínica y que su token secreto coincide (cabecera
// X-Goog-Channel-Token, comparada en tiempo constante) y se dispara la
// sincronización incremental, que es la que lee los cambios con syncToken.
//
// Se contesta 200 siempre y rápido —también a un canal desconocido o a un
// token que no casa—: un 4xx/5xx hace que Google reintente con espera
// creciente, y no hay nada que reintentar. Lo desconocido simplemente no hace nada.
export async function POST(req: NextRequest) {
  const estadoRecurso = req.headers.get("x-goog-resource-state");
  const clinicId = await clinicaDelAviso({
    channelId: req.headers.get("x-goog-channel-id"),
    token: req.headers.get("x-goog-channel-token"),
    resourceId: req.headers.get("x-goog-resource-id"),
  }).catch(() => null);

  // «sync» es el primer aviso al crear el canal: no trae cambios.
  if (clinicId && estadoRecurso !== "sync") {
    const tarea = sincronizarCalendarioEntrante(clinicId, { presupuestoMs: 45_000 });
    mantenerVivo(tarea);
    // Se espera un momento (lo normal es que acabe), sin pasar de lo que Google tolera.
    await Promise.race([tarea, new Promise((r) => setTimeout(r, 5_000))]);
  }
  return new NextResponse(null, { status: 200 });
}

/** Mantiene viva la función de Vercel hasta que termine `tarea` (como `waitUntil`). */
function mantenerVivo(tarea: Promise<unknown>): void {
  try {
    const ctx = (globalThis as any)[Symbol.for("@vercel/request-context")]?.get?.();
    ctx?.waitUntil?.(tarea);
  } catch { /* fuera de Vercel el proceso sigue vivo solo */ }
}
