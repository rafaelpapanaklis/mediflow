import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { listEduOdontoEventos } from "@/lib/edu/odontograma-eventos";

export const dynamic = "force-dynamic";

/**
 * GET — EL LIBRO DE MOVIMIENTOS del odontograma (N-3).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUÉ CONTESTA, Y POR QUÉ NO LO CONTESTABA NADIE
 *
 * La Ola B cambió el DELETE del odontograma por una baja lógica, y la
 * auditoría encontró que se deshace sola: remarcar un hallazgo dado de
 * baja REVIVE la misma fila y pisa `deletedById`. En base quedaba un
 * hallazgo vivo y ninguna huella de quién lo había quitado.
 *
 * Aquí hay una fila POR ACTO, así que sobrevive a que la fila del hallazgo
 * se reviva mil veces. Con `?tooth=16&surface=O&condition=caries` sale el
 * historial de UN hallazgo concreto.
 *
 * 🔴 PERMISO `odontograma.view` + ALCANCE CLÍNICO: el mismo candado que el
 * odontograma del que habla. El historial de un hallazgo es el hallazgo.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("odontograma.view");
  if ("response" in g) return g.response;
  try {
    const p = new URL(request.url).searchParams;
    const rows = await listEduOdontoEventos(g.ctx, params.id, {
      tooth: p.get("tooth"),
      surface: p.get("surface"),
      condition: p.get("condition"),
    });
    return NextResponse.json({ rows });
  } catch (err) {
    return eduApiError(err, `GET /api/instituto/pacientes/${params.id}/odontograma/eventos`);
  }
}
