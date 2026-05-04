// Periodontics — endpoint que renderiza el PDF "Informe periodontal del
// paciente" on-demand. SPEC §9.1.

import { NextRequest, NextResponse } from "next/server";
import { differenceInYears } from "date-fns";
import { renderToStream } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { PERIODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { computePerioMetrics } from "@/lib/periodontics/periodontogram-math";
import type { Site, ToothLevel } from "@/lib/periodontics/schemas";
import { PerioReportPDF } from "@/lib/periodontics/pdf-templates/perio-report";

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
    select: { id: true, firstName: true, lastName: true, dob: true },
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
    select: { name: true },
  });

  const sites = ((lastRecord?.sites as unknown as Site[] | null) ?? []) as Site[];
  const teeth = ((lastRecord?.toothLevel as unknown as ToothLevel[] | null) ?? []) as ToothLevel[];
  const metrics = computePerioMetrics(sites, teeth);

  const doc = PerioReportPDF({
    patient: {
      name: `${patient.firstName} ${patient.lastName}`.trim(),
      age: differenceInYears(new Date(), patient.dob),
    },
    doctor: {
      name: `${doctor?.firstName ?? ""} ${doctor?.lastName ?? ""}`.trim() || "Doctor",
      licenseNumber: doctor?.cedulaProfesional ?? "—",
    },
    clinicName: clinic?.name ?? "Clínica",
    classification: lastRecord?.classification
      ? {
          stage: lastRecord.classification.stage,
          grade: lastRecord.classification.grade,
          extension: lastRecord.classification.extension,
        }
      : null,
    metrics,
    recommendations: buildRecommendations(metrics),
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
      "Content-Disposition": `inline; filename="informe-periodontal-${patient.id}.pdf"`,
    },
  });
}

function buildRecommendations(m: ReturnType<typeof computePerioMetrics>): string[] {
  const out: string[] = [];
  if (m.plaquePct > 25) {
    out.push("Refuerza tu técnica de cepillado: técnica de Bass modificada, 3 veces al día.");
  }
  if (m.bopPct > 10) {
    out.push("Usa hilo dental o cepillos interproximales todos los días — el sangrado es señal de inflamación.");
  }
  if (m.sites4to5 > 0) {
    out.push(
      "Tienes sitios moderados (4-5 mm) que requieren raspado profesional para evitar progresión.",
    );
  }
  if (m.sites6plus > 0) {
    out.push(
      "Sitios profundos (≥6 mm) detectados. Vamos a tratarlos en sesiones específicas; podrías necesitar evaluación quirúrgica.",
    );
  }
  if (out.length === 0) {
    out.push("Mantén tu rutina actual: cepillado 3 veces al día y hilo dental diario.");
    out.push("Acude a tus mantenimientos según indicación de tu periodoncista.");
  }
  return out;
}
