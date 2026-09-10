import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { eduAudit, eduAuditRequestMeta } from "@/lib/edu/auditoria";
import { getEduQuotePdfData } from "@/lib/edu/presupuestos";
import { buildEduPresupuestoPdf } from "@/lib/edu/presupuesto-pdf";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/presupuestos/[id]/pdf — el papel que se lleva el
 * paciente.
 *
 * Mismo motor que la receta y el consentimiento (`@react-pdf/renderer`) y
 * misma forma de servirlo: `inline` y no `attachment`, porque lo normal
 * es abrirlo en una pestaña y de ahí imprimirlo o mandarlo.
 *
 * 🔴 UN BORRADOR NO SALE (409, con el porqué): `getEduQuotePdfData` es el
 * gate. Imprimir un presupuesto que todavía se está editando manda a la
 * calle un total que puede cambiar mañana.
 *
 * 🔴 Y SE REGISTRA COMO **EXPORT** en la bitácora. La NOM-024 pregunta
 * cuándo salió un dato de la escuela, y un PDF con el nombre del paciente
 * y sus importes es exactamente eso: un dato que sale.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("caja.view");
  if ("response" in g) return g.response;

  try {
    const data = await getEduQuotePdfData(g.ctx, params.id, g.ctx.institution.timezone);
    const out = await buildEduPresupuestoPdf(data);
    await eduAudit(g.ctx, {
      action: "export",
      entity: "quote",
      entityId: params.id,
      after: { formato: "pdf", folio: data.folio },
      ...eduAuditRequestMeta(request),
    });
    return new NextResponse(out.buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${out.fileName}"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/presupuestos/[id]/pdf");
  }
}
