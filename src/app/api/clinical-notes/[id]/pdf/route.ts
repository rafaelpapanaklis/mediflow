import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ClinicalNoteDocument,
  type ClinicalNoteDxRow,
} from "@/lib/pdf/clinical-note-document";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/**
 * GET /api/clinical-notes/[id]/pdf
 *
 * Genera un PDF de la nota SOAP para descarga directa. Reutiliza el
 * patrón de payroll-pdf (renderToBuffer + Content-Disposition: attachment).
 *
 * Multi-tenant: clinicId desde getCurrentUser(); validamos que el
 * MedicalRecord pertenezca a la clínica del usuario.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN", "DOCTOR"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const record = await prisma.medicalRecord.findFirst({
    where: { id: params.id, clinicId: user.clinicId },
    select: {
      id: true,
      visitDate: true,
      subjective: true,
      objective: true,
      assessment: true,
      plan: true,
      specialtyData: true,
      doctor: { select: { firstName: true, lastName: true } },
      patient: {
        select: {
          firstName: true, lastName: true, dob: true, gender: true,
        },
      },
      clinic: { select: { name: true } },
      diagnoses_v2: {
        select: { cie10: { select: { code: true, description: true } } },
        orderBy: { isPrimary: "desc" },
      },
    },
  });

  if (!record) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const sd = (record.specialtyData ?? {}) as {
    status?: "DRAFT" | "SIGNED";
    signedAt?: string;
    procedures?: Array<string | { name?: string }>;
    icd10?: Array<{ code?: string; label?: string }>;
  };

  const status: "DRAFT" | "SIGNED" = sd.status === "SIGNED" ? "SIGNED" : "DRAFT";

  // Diagnósticos: preferir tabla normalizada (compliance Fase B); si no
  // hay, fallback al snapshot legacy en specialtyData.icd10.
  const diagnoses: ClinicalNoteDxRow[] =
    record.diagnoses_v2.length > 0
      ? record.diagnoses_v2.map((d) => ({
          code: d.cie10.code,
          description: d.cie10.description,
        }))
      : (sd.icd10 ?? [])
          .filter((d): d is { code: string; label?: string } => typeof d?.code === "string")
          .map((d) => ({ code: d.code, description: d.label ?? "" }));

  const procedures: string[] = (sd.procedures ?? [])
    .map((p) => (typeof p === "string" ? p : p?.name ?? ""))
    .filter((s) => s.length > 0);

  const patientName = `${record.patient.firstName} ${record.patient.lastName}`;
  const doctorName = record.doctor
    ? `Dr/a. ${record.doctor.firstName} ${record.doctor.lastName}`
    : null;

  const element = createElement(ClinicalNoteDocument, {
    clinicName: record.clinic.name,
    patientName,
    patientDob: record.patient.dob ? record.patient.dob.toISOString() : null,
    patientGender: record.patient.gender ?? null,
    doctorName,
    visitDate: record.visitDate.toISOString(),
    generatedAt: new Date().toISOString(),
    status,
    signedAt: sd.signedAt ?? null,
    subjective: record.subjective,
    objective: record.objective,
    assessment: record.assessment,
    plan: record.plan,
    diagnoses,
    procedures,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);

  const dateSlug = record.visitDate.toISOString().slice(0, 10);
  const fileName = `nota-clinica-${dateSlug}-${record.id.slice(0, 8)}.pdf`;

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
