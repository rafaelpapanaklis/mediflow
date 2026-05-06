// Implants — GET /api/implants/[id]/full-report
// Reporte completo del expediente. Multi-página A4: portada + paciente +
// ficha técnica + planificación + cirugía + cicatrización + segunda fase +
// prótesis + controles + complicaciones + fotos por fase.

import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { exportImplantFullReport } from "@/app/actions/implants/exportImplantFullReport";
import { isFailure } from "@/app/actions/implants/result";
import { ImplantFullReportDocument } from "@/lib/implants/pdf-templates/full-report";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: Params) {
  const { id } = await ctx.params;
  const result = await exportImplantFullReport({ implantId: id });
  if (isFailure(result)) {
    const status = result.error.includes("autenticado")
      ? 401
      : result.error.includes("Sin acceso") ||
          result.error.includes("FORBIDDEN") ||
          result.error.includes("Módulo")
        ? 403
        : result.error.includes("no encontrado")
          ? 404
          : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  const data = result.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = createElement(ImplantFullReportDocument, { data }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);

  const slug =
    `${data.patient.firstName}-${data.patient.lastName}-${data.implant.toothFdi}`
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-");

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="implante-reporte-completo-${slug}.pdf"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
