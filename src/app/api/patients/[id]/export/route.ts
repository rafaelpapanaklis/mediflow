import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { signMaybeUrls, signMaybeUrlsDeLaClinica } from "@/lib/storage";
import { logRead, extractAuditMeta } from "@/lib/audit";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { stripPatientSecrets } from "@/lib/patient-secrets";
import { rotuloDeEstado } from "@/lib/odontogram/estado-marca";
import { estadosParaMostrar } from "@/lib/odontogram/estado-db";

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
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) {
    return NextResponse.json({ error: "Solo administradores pueden exportar" }, { status: 403 });
  }

  // Visibilidad por paciente: 404 si el viewer no puede ver este paciente.
  const denied = await assertPatientVisible(params.id, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (denied) return denied;

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
    // SIN `ownPrivateRecordsOnly`, A PROPÓSITO (auditoría cloudflare nº10): esto es el derecho de
    // acceso/portabilidad del PACIENTE (ARCO, LFPDPPP art. 28) y la nota privada de un doctor también
    // es información del titular, así que se le entrega entera. Por eso la ruta es solo de admin y
    // queda en la bitácora. El CDA (`export-cda`), que es una exportación para el propio personal,
    // sí respeta las notas privadas.
    prisma.medicalRecord.findMany({
      where: { patientId: patient.id },
      include: { doctor: { select: { firstName: true, lastName: true } } },
      orderBy: { visitDate: "desc" },
    }),
    prisma.medicalRecordDiagnosis.findMany({
      where: { medicalRecord: { patientId: patient.id } },
    }),
    prisma.prescription.findMany({
      where: { patientId: patient.id, status: "ACTIVE" },
      include: { items: true },
      orderBy: { issuedAt: "desc" },
    }),
    prisma.patientFile.findMany({
      where: { patientId: patient.id, deletedAt: null },
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
    // el path de una foto de antes/después lo mandó el cliente: solo se firma si es de esta clínica (nº1)
    signMaybeUrlsDeLaClinica(beforeAfterPhotos.map((p) => p.url), ctx.clinicId, FILE_TTL),
  ]);
  const signedFiles = files.map((f, i) => ({ ...f, url: fileUrls[i] }));
  const signedConsents = consentForms.map((c, i) => ({
    ...c,
    signatureUrl: c.signatureUrl ? consentUrls[i] : null,
  }));
  const signedBeforeAfter = beforeAfterPhotos.map((p, i) => ({ ...p, url: beforeAfterUrls[i] }));

  // Rojo/azul del odontograma (ws1-t6, v2 M2): cada marca con su estado (null = sin estado: lo de
  // antes, o realizado sin marcar) y el rótulo legible.
  const estados = await estadosParaMostrar(prisma, patient.id);
  const odontogramaConEstado = odontogramEntries.map((e) => {
    const estado = estados.get(e.id) ?? null;
    return { ...e, estado, ...(rotuloDeEstado(estado) ? { estadoTexto: rotuloDeEstado(estado) } : {}) };
  });

  // Bitácora de LECTURA (antes se registraba como un "update" ficticio con
  // `_exported`): exportar no modifica al paciente. Solo ids (ver logRead).
  await logRead({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    kind: "export_arco",
    patientId: patient.id,
    ...extractAuditMeta(req),
  });

  return NextResponse.json({
    schemaVersion: "1.0",
    exportedAt: new Date().toISOString(),
    // P1-N1: el `findFirst` de arriba no lleva `select`, así que `portalToken`
    // —el bearer permanente de /portal/[token]— acababa dentro del archivo de
    // portabilidad ARCO que se le entrega al titular. Un dump que se guarda en
    // disco, se manda por correo y se archiva no es sitio para una credencial
    // viva: el paciente pide sus datos, no una llave.
    patient: stripPatientSecrets(patient),
    appointments,
    medicalRecords: records,
    diagnoses,
    prescriptions,
    files: signedFiles,
    invoices,
    odontogram: {
      entries: odontogramaConEstado,
      snapshots: odontogramSnapshots,
    },
    treatmentPlans,
    consentForms: signedConsents,
    beforeAfterPhotos: signedBeforeAfter,
    notice: "Las URLs de archivos están firmadas con expiración de 24 horas.",
  });
}
