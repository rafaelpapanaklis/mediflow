// ═══════════════════════════════════════════════════════════════════════
// GET /api/realty/contracts/[id]/pdf → el contrato con su evidencia.
//
// Se sirve INLINE (no como descarga forzada) porque la mitad de las veces
// se abre para leerlo, no para guardarlo; el navegador ya trae su botón de
// descargar. `?descargar=1` fuerza el attachment cuando se pide de verdad.
//
// no-store: este PDF cambia en cuanto alguien firma. Una copia cacheada que
// enseñe "0 de 3 firmas" cuando ya firmaron todos es peor que no tenerlo.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { contractsApiError, gateContracts } from "../../_server";
import { buildContractPdf } from "../../_pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await gateContracts();
  if ("response" in gate) return gate.response;

  try {
    const pdf = await buildContractPdf(gate.ctx.accountId, params.id);
    if (!pdf) {
      return NextResponse.json({ error: "No encontramos ese contrato." }, { status: 404 });
    }
    const descargar = req.nextUrl.searchParams.get("descargar") === "1";
    return new NextResponse(new Uint8Array(pdf.buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${descargar ? "attachment" : "inline"}; filename="${pdf.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return contractsApiError(e, "pdf");
  }
}
