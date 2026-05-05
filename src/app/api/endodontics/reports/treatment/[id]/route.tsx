// Endodontics — endpoint PDF "Informe al doctor referente". Spec §11.1.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { exportTreatmentReportPdf } from "@/app/actions/endodontics/reports";
import { isFailure } from "@/app/actions/endodontics/result";
import { TreatmentReportPdf } from "@/lib/endodontics/pdf-templates/treatment-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const result = await exportTreatmentReportPdf(params.id);
  if (isFailure(result)) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const buffer = await renderToBuffer(<TreatmentReportPdf data={result.data} />);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="endo-treatment-${params.id}.pdf"`,
    },
  });
}
