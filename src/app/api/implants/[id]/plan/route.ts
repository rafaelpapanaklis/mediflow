// Implants — GET /api/implants/[id]/plan
// Plan implantológico A4 vertical para el paciente. Spec §9.1.
//
// Acepta también ?patientId= en lugar de [id] en el path: si el
// segmento [id] viene como "by-patient" o "_", se usa el query param
// patientId y se incluyen TODOS los implantes activos del paciente
// (útil para All-on-4 — Spec §7.2).

import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { exportImplantPlanPdf } from "@/app/actions/implants/exportImplantPlanPdf";
import { isFailure } from "@/app/actions/implants/result";
import { ImplantPlanDocument } from "@/lib/implants/pdf-templates/implant-plan";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: Params) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const patientIdQuery = url.searchParams.get("patientId");

  // Modo "by-patient" si el segmento es "_" o se pasa patientId.
  const usePatient = id === "_" || id === "by-patient" || !!patientIdQuery;
  const input = usePatient
    ? { patientId: patientIdQuery ?? id }
    : { implantId: id };

  const result = await exportImplantPlanPdf(input);
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
  const element = createElement(ImplantPlanDocument, {
    data: {
      patient: data.patient,
      doctor: data.doctor,
      clinic: { name: "MediFlow", phone: null }, // upstream no incluye clinic; usamos placeholder
      implants: data.implants.map((i) => ({
        toothFdi: i.toothFdi,
        brand: i.brand,
        modelName: i.modelName,
        diameterMm: String(i.diameterMm),
        lengthMm: String(i.lengthMm),
        lotNumber: i.lotNumber,
        placedAt: i.placedAt,
        currentStatus: i.currentStatus,
        protocol: i.protocol,
      })),
      generatedAt: new Date(),
    },
  }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);

  const slug = `${data.patient.firstName}-${data.patient.lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="plan-implantologico-${slug}.pdf"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
