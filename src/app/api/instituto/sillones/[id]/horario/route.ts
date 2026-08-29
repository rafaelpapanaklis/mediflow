import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { replaceEduChairSchedule } from "@/lib/edu/sillones";

export const dynamic = "force-dynamic";

/**
 * PUT /api/instituto/sillones/[id]/horario — reemplaza el horario COMPLETO.
 *
 * Es un PUT y no un POST por fila a propósito: capturar un horario es
 * "estos son mis días y mis horas", y una pantalla que borra y agrega fila
 * por fila deja estados intermedios raros (un sillón sin horario durante
 * medio segundo, que en ese instante acepta cualquier hora).
 *
 * 🔴 Mandar `slots: []` BORRA el horario, y eso significa SIEMPRE ABIERTO,
 * no cerrado. Está dicho así en la pantalla porque es lo contrario de lo
 * que la gente supone.
 */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("sillones.manage");
  if ("response" in g) return g.response;

  try {
    const res = await replaceEduChairSchedule(g.ctx, params.id, await eduReadJson(request));
    return NextResponse.json({ ok: true, id: res.id, slots: res.slots });
  } catch (err) {
    return eduApiError(err, "PUT /api/instituto/sillones/[id]/horario");
  }
}
