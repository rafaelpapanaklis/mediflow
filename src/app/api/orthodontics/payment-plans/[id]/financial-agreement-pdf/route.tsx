// Orthodontics — endpoint PDF "Acuerdo financiero" firmable. SPEC §9.2.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { exportFinancialAgreementPdf } from "@/app/actions/orthodontics/exportFinancialAgreementPdf";
import { isFailure } from "@/app/actions/orthodontics/result";
import { FinancialAgreementPdf } from "@/lib/orthodontics/pdf-templates/financial-agreement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const result = await exportFinancialAgreementPdf({ paymentPlanId: params.id });
  if (isFailure(result)) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const buffer = await renderToBuffer(<FinancialAgreementPdf data={result.data} />);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="acuerdo-financiero-${params.id}.pdf"`,
    },
  });
}
