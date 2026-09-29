// Ortodoncia — CONVENIO DE PAGO en PDF (ws1-t4). El mismo archivo sirve para
// verlo/imprimirlo (inline) y para descargarlo (`?descargar=1`).
//
// `[id]` es el id del CASO (lo que manda «Imprimir convenio» del cobro) o el
// de un OrthoPaymentPlan viejo (la ficha vieja): ver exportFinancialAgreementPdf.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { exportFinancialAgreementPdf } from "@/app/actions/orthodontics/exportFinancialAgreementPdf";
import { isFailure } from "@/app/actions/orthodontics/result";
import { FinancialAgreementPdf } from "@/lib/orthodontics/pdf-templates/financial-agreement";
import { nombreDeArchivoPdf } from "@/lib/orthodontics/pdf/nombre-de-archivo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const result = await exportFinancialAgreementPdf({ id: params.id });
  if (isFailure(result)) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const buffer = await renderToBuffer(<FinancialAgreementPdf data={result.data} />);
  const descargar = new URL(req.url).searchParams.get("descargar") === "1";
  const archivo = nombreDeArchivoPdf("convenio-de-pago", result.data.membrete.paciente.nombre, result.data.folio);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${descargar ? "attachment" : "inline"}; filename="${archivo}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
