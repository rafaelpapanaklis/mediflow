import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { signMaybeUrls } from "@/lib/storage";
import { logMutation } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/patients/[id]/export — Portabilidad LFPDPPP.
 *
 * Devuelve un JSON completo con toda la información del paciente para
 * cumplir con el derecho de portabilidad (LFPDPPP art. 28). Usado también
 * por el flujo ARCO de tipo ACCESS.
 *
 * Permisos: SUPER_ADMIN, ADMIN del clinicId del paciente. Doctores no
 * (porque podrían exfiltrar PII de pacientes que no les corresponde).
 *
 * Las URLs de archivos se devuelven firmadas con TTL de 24h para que el
 * paciente pueda descargarlos durante un día sin re-llamar al endpoint.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) {
    return NextResponse.json({ error: "Solo administradores pueden exportar" }, { status: 403 });
  }

  const patient = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  // TTL 24h para que el paciente pueda descargar los archivos durante el
  // resto del día sin tener que volver a invocar este endpoint.
  const FILE_TTL = 24 * 60 * 60;

  const [
    appointments,
    records,
    diagnoses,
    prescriptions,
    files,
    invoices,
    odontogramEntries,
    odontogramSnapshots,
    treatmentPlans,
    consentForms,
    beforeAfterPhotos,
  ] = await Promise.all([
    prisma.appointment.findMany({
      where: { patientId: patient.id },
      orderBy: { startsAt: "desc" },
    }),
    prisma.medicalRecord.findMany({
      where: { patientId: patient.id },
      include: { doctor: { select: { firstName: true, lastName: true } } },
      orderBy: { visitDate: "desc" },
    }),
    prisma.medicalRecordDiagnosis.findMany({
      where: { medicalRecord: { patientId: patient.id } },
    }),
    prisma.prescription.findMany({
      where: { patientId: patient.id },
      include: { items: true },
      orderBy: { issuedAt: "desc" },
    }),
    prisma.patientFile.findMany({
      where: { patientId: patient.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.invoice.findMany({
      where: { patientId: patient.id },
      include: { payments: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.odontogramEntry.findMany({ where: { patientId: patient.id } }),
    prisma.odontogramSnapshot.findMany({ where: { patientId: patient.id } }),
    prisma.treatmentPlan.findMany({
      where: { patientId: patient.id },
      include: { sessions: true },
    }),
    prisma.consentForm.findMany({ where: { patientId: patient.id } }),
    prisma.beforeAfterPhoto.findMany({ where: { patientId: patient.id } }),
  ]);

  // Firma cada URL de archivo (path interno → signed URL 24h) en batch con
  // createSignedUrls: 3 round-trips en vez de N×. Promise.all de 3 (regla <7);
  // el orden del resultado coincide con el del input.
  const [fileUrls, consentUrls, beforeAfterUrls] = await Promise.all([
    signMaybeUrls(files.map((f) => f.url), FILE_TTL),
    signMaybeUrls(consentForms.map((c) => c.signatureUrl), FILE_TTL),
    signMaybeUrls(beforeAfterPhotos.map((p) => p.url), FILE_TTL),
  ]);
  const signedFiles = files.map((f, i) => ({ ...f, url: fileUrls[i] }));
  const signedConsents = consentForms.map((c, i) => ({
    ...c,
    signatureUrl: c.signatureUrl ? consentUrls[i] : null,
  }));
  const signedBeforeAfter = beforeAfterPhotos.map((p, i) => ({ ...p, url: beforeAfterUrls[i] }));

  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "patient",
    entityId: patient.id,
    action: "update",
    before: { _exported: false },
    after: { _exported: true, exportedAt: new Date().toISOString() },
  });

  return NextResponse.json({
    schemaVersion: "1.0",
    exportedAt: new Date().toISOString(),
    patient,
    appointments,
    medicalRecords: records,
    diagnoses,
    prescriptions,
    files: signedFiles,
    invoices,
    odontogram: {
      entries: odontogramEntries,
      snapshots: odontogramSnapshots,
    },
    treatmentPlans,
    consentForms: signedConsents,
    beforeAfterPhotos: signedBeforeAfter,
    notice: "Las URLs de archivos están firmadas con expiración de 24 horas.",
  });
}
