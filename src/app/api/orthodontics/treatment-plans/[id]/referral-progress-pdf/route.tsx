// Orthodontics — Ola 1 (ws1-t6), A13: endpoint PDF "Carta de avance" al
// doctor que refirió al paciente. `?stage=inicio|termino`.

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { exportReferralProgressLetterPdf } from "@/app/actions/orthodontics/exportReferralProgressLetterPdf";
import { isFailure } from "@/app/actions/orthodontics/result";
import { ReferralProgressLetterPdf } from "@/lib/orthodontics/pdf-templates/referral-progress-letter";
import { nombreDeArchivoPdf } from "@/lib/orthodontics/pdf/nombre-de-archivo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const stage = new URL(req.url).searchParams.get("stage");
  const parsedStage = stage === "inicio" || stage === "termino" ? stage : null;
  if (!parsedStage) {
    return NextResponse.json({ ok: false, error: "stage debe ser 'inicio' o 'termino'" }, { status: 400 });
  }

  const result = await exportReferralProgressLetterPdf({ treatmentPlanId: params.id, stage: parsedStage });
  if (isFailure(result)) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const buffer = await renderToBuffer(<ReferralProgressLetterPdf data={result.data} />);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nombreDeArchivoPdf(`carta-de-avance-${parsedStage}`, result.data.membrete.paciente.nombre)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
