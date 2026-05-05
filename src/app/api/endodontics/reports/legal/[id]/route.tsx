// Endodontics — endpoint PDF "Informe legal NOM-024". Spec §11.2.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { exportLegalReportPdf } from "@/app/actions/endodontics/reports";
import { isFailure } from "@/app/actions/endodontics/result";
import { LegalReportPdf } from "@/lib/endodontics/pdf-templates/legal-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const result = await exportLegalReportPdf(params.id);
  if (isFailure(result)) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const buffer = await renderToBuffer(<LegalReportPdf data={result.data} />);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="endo-legal-${params.id}.pdf"`,
    },
  });
}
