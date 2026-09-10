import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { getEduCampusScope } from "@/lib/edu/campus";
import { eduCampusForCharge, eduCampusLabel } from "@/lib/edu/campus-core";
import { closeEduCashSession, getEduCorte, openEduCashSession } from "@/lib/edu/caja";

export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 Ola C · H-09 · EL TURNO ES **POR SEDE**, y la sede la decide el
 * servidor con el selector de la barra superior — NUNCA el body.
 *
 * Un `campusId` que viniera del navegador podría abrir, mirar o cerrar el
 * turno de la otra sede, que es exactamente el descuadre que este
 * hallazgo viene a cerrar. Se resuelve con `eduCampusForCharge`, la misma
 * función que decide dónde se emite un cobro: un turno se abre en un
 * mostrador concreto, igual que un cobro, y "todas las sedes" no es un
 * mostrador.
 * ═══════════════════════════════════════════════════════════════════════
 */
async function donde(ctx: Parameters<typeof getEduCorte>[0]) {
  const sede = await getEduCampusScope(ctx as never);
  const elegida = eduCampusForCharge(sede);
  return {
    campusId: elegida.campusId,
    campusLabel: sede.active ? eduCampusLabel(sede.active) : null,
    bloqueo: elegida.reason,
  };
}

/**
 * GET /api/instituto/caja/corte — el estado del turno DE ESTA SEDE.
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
    const corte = await getEduCorte(
      g.ctx,
      g.ctx.institution.timezone,
      new Date(),
      await donde(g.ctx),
    );
    return NextResponse.json(corte);
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/caja/corte");
  }
}

/**
 * POST — abre el turno de ESTA sede, con su fondo de caja.
 *
 * 🔴 Con varias sedes y ninguna elegida se rebota con el motivo escrito
 * (409), no con un turno "de todas": el fondo del cajón es de un cajón.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("caja.corte");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const sede = await donde(g.ctx);
    if (sede.bloqueo) {
      return NextResponse.json({ error: sede.bloqueo }, { status: 409 });
    }
    const res = await openEduCashSession(g.ctx, body, new Date(), { campusId: sede.campusId });
    return NextResponse.json({ ok: true, ...res }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/caja/corte");
  }
}

/**
 * PATCH — cierra el turno de ESTA sede con lo que se contó en el cajón.
 *
 * El esperado, la diferencia y —desde la Ola C— el DESGLOSE POR MÉTODO se
 * CONGELAN aquí: si mañana alguien registra un pago con fecha vieja, el
 * corte que se imprimió y se firmó sigue diciendo lo mismo, y se puede
 * volver a imprimir igual dentro de un año.
 */
export async function PATCH(request: Request) {
  const g = await eduApiGuard("caja.corte");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);
    const sede = await donde(g.ctx);
    const res = await closeEduCashSession(g.ctx, body, new Date(), { campusId: sede.campusId });
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/caja/corte");
  }
}
