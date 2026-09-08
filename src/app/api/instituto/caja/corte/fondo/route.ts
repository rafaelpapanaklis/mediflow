import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { setEduCashSessionOpening } from "@/lib/edu/caja";

export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * PATCH /api/instituto/caja/corte/fondo — 🔴 H-51 (la parte sana):
 * CORREGIR EL FONDO DE UN TURNO **ABIERTO**.
 *
 * «Fondo de apertura con "1000" en vez de "100": todo el turno espera $900
 * de más». Hasta hoy la única salida era cerrar el turno con un descuadre
 * falso y dejarlo escrito para siempre en un corte firmado.
 *
 * Ruta propia y no un verbo más en `/corte` porque ese PATCH ya significa
 * CERRAR el turno, y dos operaciones sobre dinero compartiendo verbo es
 * cómo un cliente que manda el cuerpo equivocado cierra una caja sin
 * querer.
 *
 * Permiso: `caja.corte` — el mismo que abre y cierra. Sin key nueva: quien
 * teclea el fondo es quien lo corrige.
 *
 * ⛔ NO toca un turno cerrado: `closedAt: null` va en el `where` del
 * `updateMany` (ver `setEduCashSessionOpening`). Un corte ya firmado no se
 * reescribe desde una pantalla.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function PATCH(request: Request) {
  const g = await eduApiGuard("caja.corte");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const res = await setEduCashSessionOpening(g.ctx, body);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/caja/corte/fondo");
  }
}
