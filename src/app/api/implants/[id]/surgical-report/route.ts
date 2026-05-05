// Implants — GET /api/implants/[id]/surgical-report
// Reporte quirúrgico A4 vertical. Pieza sensible legalmente. Spec §9.2.
//
// Reusa la server action exportSurgicalReportPdf que ya carga datos
// + registra audit log REPORT_SURGICAL_PDF.

import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { exportSurgicalReportPdf } from "@/app/actions/implants/exportSurgicalReportPdf";
import { isFailure } from "@/app/actions/implants/result";
import { SurgicalReportDocument } from "@/lib/implants/pdf-templates/surgical-report";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: Params) {
  const { id } = await ctx.params;
  const result = await exportSurgicalReportPdf({ implantId: id });
  if (isFailure(result)) {
    const status = result.error.includes("autenticado")
      ? 401
      : result.error.includes("Sin acceso") || result.error.includes("FORBIDDEN") || result.error.includes("Módulo")
        ? 403
        : result.error.includes("no encontrado")
          ? 404
          : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  const data = result.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = createElement(SurgicalReportDocument, {
    data: {
      patientName: `${data.patient.firstName} ${data.patient.lastName}`,
      patientId: data.patient.id,
      toothFdi: data.toothFdi,
      brand: data.brand,
      brandCustomName: data.brandCustomName,
      modelName: data.modelName,
      diameterMm: String(data.diameterMm),
      lengthMm: String(data.lengthMm),
      lotNumber: data.lotNumber,
      manufactureDate: data.manufactureDate,
      expiryDate: data.expiryDate,
      placedAt: data.placedAt,
      protocol: data.protocol,
      surgical: data.surgical,
      doctorName: `${data.doctor.firstName} ${data.doctor.lastName}`,
      doctorCedula: data.doctor.cedulaProfesional,
      clinicName: data.clinic.name,
      clinicPhone: data.clinic.phone,
      generatedAt: new Date(),
    },
  }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);

  const slug = `${data.patient.firstName}-${data.patient.lastName}-${data.toothFdi}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="reporte-quirurgico-${slug}.pdf"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
