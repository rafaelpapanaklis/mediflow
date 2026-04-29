import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/auth/permissions";
import { buildCdaXml } from "@/lib/hl7/cda";
import { logAudit, extractAuditMeta } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Params { params: { id: string } }

/**
 * GET /api/patients/[id]/export-cda
 *
 * Exporta el expediente clínico del paciente en HL7 CDA Release 2.
 * Solo DOCTOR/ADMIN/SUPER_ADMIN pueden generar el export.
 *
 * Multi-tenant: validamos que patient.clinicId === user.clinicId.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!hasPermission(user.role as "DOCTOR" | "ADMIN" | "SUPER_ADMIN" | "RECEPTIONIST" | "READONLY", "medicalRecord.read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const patient = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: user.clinicId },
    select: {
      id: true, firstName: true, lastName: true, dob: true, gender: true,
      curp: true, passportNo: true, address: true,
      familyHistory: true, personalNonPathologicalHistory: true,
      chronicConditions: true, allergies: true, currentMedications: true,
    },
  });
  if (!patient) return NextResponse.json({ error: "patient_not_found" }, { status: 404 });

  const [clinic, records, prescriptions] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: user.clinicId },
      select: { id: true, name: true, clues: true, address: true, phone: true },
    }),
    prisma.medicalRecord.findMany({
      where: { patientId: patient.id, clinicId: user.clinicId },
      orderBy: { visitDate: "desc" },
      include: {
        diagnoses_v2: { include: { cie10: true } },
      },
    }),
    prisma.prescription.findMany({
      where: { patientId: patient.id, clinicId: user.clinicId },
      orderBy: { issuedAt: "desc" },
      include: { items: { include: { cums: true } } },
    }),
  ]);

  if (!clinic) return NextResponse.json({ error: "clinic_not_found" }, { status: 404 });

  const xml = buildCdaXml({
    documentId: `cda-${patient.id}-${Date.now()}`,
    effectiveTime: new Date(),
    clinic: clinic,
    patient: {
      id: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dob: patient.dob,
      gender: patient.gender,
      curp: patient.curp,
      passportNo: patient.passportNo,
      address: patient.address,
      familyHistory: patient.familyHistory,
      personalNonPathologicalHistory: patient.personalNonPathologicalHistory,
      chronicConditions: patient.chronicConditions,
      allergies: patient.allergies,
      currentMedications: patient.currentMedications,
    },
    doctor: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      cedulaProfesional: user.cedulaProfesional,
      especialidad: user.especialidad,
    },
    records: records.map((r) => ({
      id: r.id,
      visitDate: r.visitDate,
      subjective: r.subjective,
      objective: r.objective,
      assessment: r.assessment,
      plan: r.plan,
      diagnoses: r.diagnoses_v2.map((dx) => ({
        code: dx.cie10Code,
        description: dx.cie10.description,
      })),
    })),
    prescriptions: prescriptions.map((rx) => ({
      id: rx.id,
      issuedAt: rx.issuedAt,
      items: rx.items.map((it) => ({
        cumsKey: it.cumsKey,
        descripcion: it.cums.descripcion,
        dosage: it.dosage,
      })),
    })),
  });

  // Audit log de export — read sensible.
  const { ipAddress, userAgent } = extractAuditMeta(req);
  await logAudit({
    clinicId: user.clinicId,
    userId: user.id,
    entityType: "patient",
    entityId: patient.id,
    action: "view",
    changes: { exportCda: { before: null, after: { recordCount: records.length, prescriptionCount: prescriptions.length } } },
    ipAddress, userAgent,
  });

  const filename = `expediente-${patient.firstName}-${patient.lastName}-${new Date().toISOString().slice(0, 10)}.xml`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
