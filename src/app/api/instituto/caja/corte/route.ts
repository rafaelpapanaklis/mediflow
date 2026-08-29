import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { closeEduCashSession, getEduCorte, openEduCashSession } from "@/lib/edu/caja";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/caja/corte — el estado del turno.
 *
 * 🔴 La ventana es del TURNO, no del día natural: va de `openedAt` a ahora.
 * Si nadie corta en tres días, son tres días — y la respuesta trae
 * `spanDays` para que la pantalla lo diga en vez de titular "hoy" unos
 * datos que no son de hoy.
 */
export async function GET() {
  const g = await eduApiGuard("caja.view");
  if ("response" in g) return g.response;

  try {
    const corte = await getEduCorte(g.ctx, g.ctx.institution.timezone);
    return NextResponse.json(corte);
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/caja/corte");
  }
}

/** POST — abre el turno con su fondo de caja. */
export async function POST(request: Request) {
  const g = await eduApiGuard("caja.corte");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const res = await openEduCashSession(g.ctx, body);
    return NextResponse.json({ ok: true, id: res.id }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/caja/corte");
  }
}

/**
 * PATCH — cierra el turno con lo que se contó en el cajón.
 *
 * El esperado y la diferencia se CONGELAN aquí: si mañana alguien registra
 * un pago con fecha vieja, el corte que se imprimió y se firmó sigue
 * diciendo lo mismo.
 */
export async function PATCH(request: Request) {
  const g = await eduApiGuard("caja.corte");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const res = await closeEduCashSession(g.ctx, body);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/caja/corte");
  }
}
