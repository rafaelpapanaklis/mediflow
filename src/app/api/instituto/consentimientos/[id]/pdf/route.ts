import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { getEduConsentPdfData } from "@/lib/edu/consentimientos";
import { buildEduConsentPdf } from "@/lib/edu/consentimiento-pdf";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/consentimientos/[id]/pdf — la carta firmada, imprimible.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EXIGE `consentimientos.view`: LA MISMA LLAVE QUE ABRE LA PESTAÑA, y no
 * una nueva. El permiso de CAJA sobre esta pestaña está justificado por
 * escrito en que «la carta se imprime y se entrega en el mostrador»
 * (permissions.ts); pedir aquí otra llave habría dejado a caja viendo la
 * carta y sin poder imprimirla, que es exactamente el agujero que H-12
 * describe. Y una key nueva no le llega a quien ya tiene
 * `permissionsOverride` guardado sin un backfill en SQL.
 *
 * 🔴 Y EL ALCANCE ES EL SEGUNDO CANDADO. `getEduConsentPdfData` busca la
 * carta cruzando el paciente con `eduPatientScopeWhere`: la de otro alumno
 * —o la de otra escuela— contesta 404, igual que una que no existe. Un 403
 * confirmaría que ese documento existe.
 *
 * 🔴 EL GATE: solo sale FIRMADA o REVOCADA (409 con el porqué en los demás
 * casos). Una carta pendiente todavía es la LIGA; un PDF de algo sin firmar
 * es un papel que parece un consentimiento y no lo es.
 *
 * `inline` y no `attachment`, igual que la receta: se abre en una pestaña y
 * de ahí se imprime o se guarda — que es lo que hace recepción de pie con
 * el paciente delante.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const g = await eduApiGuard("consentimientos.view");
  if ("response" in g) return g.response;

  try {
    const data = await getEduConsentPdfData(g.ctx, params.id, g.ctx.institution.timezone);
    const out = await buildEduConsentPdf(data);
    return new NextResponse(out.buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${out.fileName}"`,
        // Una carta de consentimiento con datos del paciente no se cachea
        // en ningún proxy: es la misma cabecera que la receta.
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/consentimientos/[id]/pdf");
  }
}
