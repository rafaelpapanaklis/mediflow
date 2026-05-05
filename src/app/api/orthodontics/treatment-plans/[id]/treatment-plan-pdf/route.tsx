// Orthodontics — endpoint PDF "Plan de tratamiento al paciente". SPEC §9.1.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { exportTreatmentPlanPdf } from "@/app/actions/orthodontics/exportTreatmentPlanPdf";
import { isFailure } from "@/app/actions/orthodontics/result";
import { TreatmentPlanPdf } from "@/lib/orthodontics/pdf-templates/treatment-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const result = await exportTreatmentPlanPdf({ treatmentPlanId: params.id });
  if (isFailure(result)) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const buffer = await renderToBuffer(<TreatmentPlanPdf data={result.data} />);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="plan-tratamiento-${params.id}.pdf"`,
    },
  });
}
