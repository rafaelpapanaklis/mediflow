// Periodontics — endpoint que renderiza el PDF "Reporte legal al médico
// tratante" on-demand. SPEC §9.2.

import { NextRequest, NextResponse } from "next/server";
import { differenceInYears } from "date-fns";
import { renderToStream } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { PERIODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { computePerioMetrics } from "@/lib/periodontics/periodontogram-math";
import type { Site, ToothLevel } from "@/lib/periodontics/schemas";
import { ReferrerReportPDF } from "@/lib/periodontics/pdf-templates/referrer-report";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { patientId: string } },
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (ctx.clinicCategory !== "DENTAL") {
    return NextResponse.json({ error: "Categoría no válida" }, { status: 403 });
  }
  const access = await canAccessModule(ctx.clinicId, PERIODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    return NextResponse.json({ error: "Módulo no activo" }, { status: 403 });
  }

  const patient = await prisma.patient.findFirst({
    where: { id: params.patientId, clinicId: ctx.clinicId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      dob: true,
      chronicConditions: true,
      notes: true,
    },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  if (!patient.dob) {
    return NextResponse.json({ error: "Paciente sin fecha de nacimiento" }, { status: 400 });
  }

  const lastRecord = await prisma.periodontalRecord.findFirst({
    where: { patientId: patient.id, clinicId: ctx.clinicId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { classification: true },
  });

  const doctor = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { firstName: true, lastName: true, cedulaProfesional: true },
  });

  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { name: true, phone: true, address: true },
  });

  const sites = ((lastRecord?.sites as unknown as Site[] | null) ?? []) as Site[];
  const teeth = ((lastRecord?.toothLevel as unknown as ToothLevel[] | null) ?? []) as ToothLevel[];
  const metrics = computePerioMetrics(sites, teeth);

  const conditions: string[] = [];
  for (const c of patient.chronicConditions ?? []) conditions.push(c);
  if (patient.notes) conditions.push(patient.notes);
  const systemicCondition = conditions.length > 0 ? conditions.join("; ") : null;

  const doc = ReferrerReportPDF({
    patient: {
      name: `${patient.firstName} ${patient.lastName}`.trim(),
      age: differenceInYears(new Date(), patient.dob),
      systemicCondition,
    },
    doctor: {
      name: `${doctor?.firstName ?? ""} ${doctor?.lastName ?? ""}`.trim() || "Doctor",
      licenseNumber: doctor?.cedulaProfesional ?? "—",
      specialty: "Periodoncia",
    },
    clinic: {
      name: clinic?.name ?? "Clínica",
      phone: clinic?.phone ?? undefined,
      address: clinic?.address ?? undefined,
    },
    classification: lastRecord?.classification
      ? {
          stage: lastRecord.classification.stage,
          grade: lastRecord.classification.grade,
          extension: lastRecord.classification.extension,
        }
      : null,
    metrics,
  });

  const stream = await renderToStream(doc);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  const pdfBytes = Buffer.concat(chunks);

  return new NextResponse(new Uint8Array(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="referrer-perio-${patient.id}.pdf"`,
    },
  });
}
