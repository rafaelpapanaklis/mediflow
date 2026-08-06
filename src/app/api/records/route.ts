import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth-context";
import { logAudit, logMutation, extractAuditMeta } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { getVisiblePatientClinicIds, sharedRecordScope } from "@/lib/branches";

const recordSchema = z.object({
  patientId:     z.string().min(1),
  subjective:    z.string().optional().nullable(),
  objective:     z.string().optional().nullable(),
  assessment:    z.string().optional().nullable(),
  plan:          z.string().optional().nullable(),
  diagnoses:     z.any().optional().nullable(),
  vitals:        z.any().optional().nullable(),
  specialtyData: z.any().optional().nullable(),
  isPrivate:     z.boolean().optional(),
});

// Contexto de sesión vía el helper CENTRAL (getAuthContext): misma resolución
// cookie→clínica que la copia local que había aquí, pero además aplica el gate
// de plan vencido. Devuelve la fila User (con permissionsOverride normalizado)
// para no tocar el resto del handler.
async function getDbUser() {
  const ctx = await getAuthContext();
  return ctx ? (ctx.user as { id: string; role: any; clinicId: string; permissionsOverride: string[] }) : null;
}

export async function GET(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // NOM-024 + P1-7: mismo permiso granular que su gemela /api/clinical
  // ("Ver expediente clínico" — respeta permissionsOverride, no solo el rol).
  const denied = denyIfMissingPermission(dbUser, "medicalRecord.view");
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patientId");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "200"), 1), 500);
  const skip  = Math.max(parseInt(searchParams.get("skip") ?? "0"), 0);
  // Visibilidad por paciente. Filtro de RELACIÓN (no un assert) porque `patientId`
  // es opcional: sin él, esto devolvía los records de TODA la clínica, restringidos
  // incluidos.
  const visibility = relatedPatientVisibilityAnd({
    userId: dbUser.id,
    role: dbUser.role,
    clinicId: dbUser.clinicId,
  });
  // MULTI-CLÍNICA · FASE 2 — el expediente se LEE también desde una sede vinculada,
  // pero SÓLO consultándolo POR PACIENTE. Sin `patientId` el volcado (hasta 500) se
  // queda estrictamente en la sede activa: ampliarlo exfiltraría la base clínica de
  // la vecina, sin gate por paciente ni bitácora.
  //
  // sharedRecordScope (scope de sede/s) + patientId + visibilidad van TODOS en UN
  // solo AND: dos claves `AND` en el mismo objeto se pisan, y el OR de `isPrivate`
  // del findMany ya ocupa `where.OR`.
  const visibleClinicIds = patientId
    ? await getVisiblePatientClinicIds(dbUser.clinicId)
    : [dbUser.clinicId];
  const recordAnd: any[] = [
    ...(patientId
      ? [sharedRecordScope(dbUser.clinicId, visibleClinicIds), { patientId }]
      : []),
    ...visibility,
  ];
  const where: any = patientId ? {} : { clinicId: dbUser.clinicId };
  const records = await prisma.medicalRecord.findMany({
    where: {
      ...where,
      OR: [{ isPrivate: false }, { isPrivate: true, doctorId: dbUser.id }],
      ...(recordAnd.length ? { AND: recordAnd } : {}),
    },
    include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { visitDate: "desc" },
    take: limit,
    skip,
  });

  // NOM-024 — bitácora de lectura del expediente. Una entrada por request,
  // referenciando el patientId. No loggeamos cada record individual para
  // evitar inflar la tabla; el contexto (qué records se devolvieron) se
  // puede derivar reproduciendo el query con el mismo timestamp.
  if (patientId) {
    const { ipAddress, userAgent } = extractAuditMeta(req);
    await logAudit({
      clinicId:   dbUser.clinicId,
      userId:     dbUser.id,
      entityType: "record",
      entityId:   patientId,
      action:     "view",
      changes:    { count: { before: null, after: records.length } },
      ipAddress, userAgent,
    });
  }

  return NextResponse.json(records);
}

export async function POST(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // P1-7: misma key que el POST de /api/clinical ("Editar notas SOAP / firmar").
  const denied = denyIfMissingPermission(dbUser, "medicalRecord.edit");
  if (denied) return denied;

  const body = await req.json();
  const parsed = recordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }

  // Verify patient belongs to this clinic
  const patient = await prisma.patient.findFirst({
    where: { id: parsed.data.patientId, clinicId: dbUser.clinicId },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const record = await prisma.medicalRecord.create({
    data: {
      clinicId:      dbUser.clinicId,
      doctorId:      dbUser.id,
      patientId:     parsed.data.patientId,
      subjective:    parsed.data.subjective ?? null,
      objective:     parsed.data.objective ?? null,
      assessment:    parsed.data.assessment ?? null,
      plan:          parsed.data.plan ?? null,
      diagnoses:     parsed.data.diagnoses ?? undefined,
      vitals:        parsed.data.vitals ?? undefined,
      specialtyData: parsed.data.specialtyData ?? undefined,
      isPrivate:     parsed.data.isPrivate ?? false,
    },
  });

  await logMutation({
    req,
    clinicId: dbUser.clinicId,
    userId: dbUser.id,
    entityType: "record",
    entityId: record.id,
    action: "create",
    after: { patientId: record.patientId, doctorId: record.doctorId, isPrivate: record.isPrivate },
  });

  return NextResponse.json(record, { status: 201 });
}
