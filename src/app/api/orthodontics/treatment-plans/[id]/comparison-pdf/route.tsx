// Orthodontics — endpoint PDF "Antes/Durante/Después" multi-página.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { exportComparisonPdf } from "@/app/actions/orthodontics/exportComparisonPdf";
import { isFailure } from "@/app/actions/orthodontics/result";
import { ComparisonPdf } from "@/lib/orthodontics/pdf-templates/comparison-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const result = await exportComparisonPdf({ treatmentPlanId: params.id });
  if (isFailure(result)) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const buffer = await renderToBuffer(<ComparisonPdf data={result.data} />);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="ortodoncia-progreso-${params.id}.pdf"`,
    },
  });
}
