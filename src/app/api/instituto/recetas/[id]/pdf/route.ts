import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { getEduRecetaPdfData } from "@/lib/edu/recetas";
import { buildEduRecetaPdf } from "@/lib/edu/receta-pdf";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/recetas/[id]/pdf — el documento imprimible.
 *
 * Exige "recetas.view", y 🔴 SOLO SALE EXPEDIDA O ANULADA: una PENDIENTE
 * o RECHAZADA contesta 409 con el porqué (getEduRecetaPdfData es el
 * gate). Si este endpoint imprimiera una pendiente, la firma del docente
 * sería decorativa — el alumno entregaría el papel antes de que nadie con
 * cédula lo leyera.
 *
 * `inline` y no `attachment`: se abre en una pestaña y de ahí se imprime
 * o se guarda — que es lo que hace una persona de pie con el paciente.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("recetas.view");
  if ("response" in g) return g.response;

  try {
    const data = await getEduRecetaPdfData(g.ctx, params.id, g.ctx.institution.timezone);
    const out = await buildEduRecetaPdf(data);
    return new NextResponse(out.buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${out.fileName}"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/recetas/[id]/pdf");
  }
}
