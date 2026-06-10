// GET /api/paciente/history — Implementa A7. Respuesta: PacienteHistorialResponse.
// · getPatientPortalContext() | 401. patientIds de ctx.links.
// · clinics: links → patient → clinic (como summary).
// · consultas: medicalRecord.findMany({ patientId in }, orderBy visitDate desc,
//   take 100, select SOLO { id, clinicId, visitDate, doctor { firstName,
//   lastName } }). REGLA AUDITADA (portal token): CERO campos SOAP — nada de
//   subjective/objective/assessment/plan/diagnoses/vitals/specialtyData.
//   Recuerda: consultas NO son SOAP — el paciente solo ve fecha y doctor.
// · tratamientos: treatmentPlan.findMany({ patientId in }, orderBy startDate
//   desc, select { id, clinicId, name, status, startDate, endDate,
//   totalSessions, sessions: { select: { completedAt } } }) → sessionsDone =
//   sessions con completedAt != null. NUNCA description ni notas.
// · odontograma: odontogramEntry.findMany({ patientId in, conditionId not
//   "__note__" }, select { patientId, toothNumber, updatedAt }) → agregar EN JS
//   por clínica (mapear patientId→clinicId con ctx.links): teethWithFindings
//   (dientes distintos), totalFindings, updatedAt máx. SOLO conteos, sin notas.
// · Promise.all máximo 7 — aquí son ~4 queries.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import type {
  PacienteClinica,
  PacienteConsulta,
  PacienteHistorialResponse,
  PacienteOdontoResumen,
  PacienteTratamiento,
} from "@/lib/patient-portal/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getPatientPortalContext();
  if (!ctx) return pacienteUnauthorized();

  // Multi-tenant estricto: SOLO los expedientes vinculados a la cuenta.
  const patientIds = ctx.links.map((l) => l.patientId);

  if (patientIds.length === 0) {
    const empty: PacienteHistorialResponse = {
      clinics: [],
      consultas: [],
      tratamientos: [],
      odontograma: [],
    };
    return NextResponse.json(empty);
  }

  const [links, records, plans, odontoEntries] = await Promise.all([
    // clinics: link → patient → clinic (excluye expedientes con soft-delete).
    prisma.patientAccountLink.findMany({
      where: { accountId: ctx.account.id, patient: { deletedAt: null } },
      select: {
        clinicId: true,
        patient: {
          select: {
            id: true,
            patientNumber: true,
            clinic: {
              select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                city: true,
                phone: true,
              },
            },
          },
        },
      },
    }),
    // REGLA AUDITADA (portal por token): select paciente-safe SOLO id, fecha y
    // nombre del doctor. CERO campos SOAP (subjective/objective/assessment/
    // plan/diagnoses/vitals/specialtyData/isPrivate). Las consultas NO son
    // SOAP: el paciente solo ve que hubo visita, cuándo y con quién.
    prisma.medicalRecord.findMany({
      where: { patientId: { in: patientIds } },
      orderBy: { visitDate: "desc" },
      take: 100,
      select: {
        id: true,
        clinicId: true,
        visitDate: true,
        doctor: { select: { firstName: true, lastName: true } },
      },
    }),
    // Tratamientos: NUNCA description ni notas de sesiones — solo progreso.
    prisma.treatmentPlan.findMany({
      where: { patientId: { in: patientIds } },
      orderBy: { startDate: "desc" },
      select: {
        id: true,
        clinicId: true,
        name: true,
        status: true,
        startDate: true,
        endDate: true,
        totalSessions: true,
        sessions: { select: { completedAt: true } },
      },
    }),
    // Odontograma: SOLO conteos agregados. Excluye notas por diente
    // ("__note__") y jamás expone notes ni conditionId detallado.
    prisma.odontogramEntry.findMany({
      where: { patientId: { in: patientIds }, NOT: { conditionId: "__note__" } },
      select: { patientId: true, toothNumber: true, updatedAt: true },
    }),
  ]);

  const clinics: PacienteClinica[] = links.map((l) => ({
    clinicId: l.patient.clinic.id,
    clinicName: l.patient.clinic.name,
    clinicSlug: l.patient.clinic.slug,
    logoUrl: l.patient.clinic.logoUrl,
    city: l.patient.clinic.city,
    phone: l.patient.clinic.phone,
    patientId: l.patient.id,
    patientNumber: l.patient.patientNumber,
  }));

  const consultas: PacienteConsulta[] = records.map((r) => ({
    id: r.id,
    clinicId: r.clinicId,
    visitDate: r.visitDate.toISOString(),
    doctorName: [r.doctor.firstName, r.doctor.lastName].filter(Boolean).join(" "),
  }));

  const tratamientos: PacienteTratamiento[] = plans.map((p) => ({
    id: p.id,
    clinicId: p.clinicId,
    name: p.name,
    status: p.status,
    startDate: p.startDate.toISOString(),
    endDate: p.endDate ? p.endDate.toISOString() : null,
    totalSessions: p.totalSessions,
    sessionsDone: p.sessions.filter((s) => s.completedAt).length,
  }));

  // Agregación EN JS por clínica vía mapa patientId→clinicId de la sesión.
  const clinicByPatient = new Map<string, string>();
  for (const l of ctx.links) clinicByPatient.set(l.patientId, l.clinicId);

  const aggByClinic = new Map<
    string,
    { teeth: Set<number>; total: number; updatedAt: Date | null }
  >();
  for (const e of odontoEntries) {
    const clinicId = clinicByPatient.get(e.patientId);
    if (!clinicId) continue;
    let agg = aggByClinic.get(clinicId);
    if (!agg) {
      agg = { teeth: new Set<number>(), total: 0, updatedAt: null };
      aggByClinic.set(clinicId, agg);
    }
    agg.teeth.add(e.toothNumber);
    agg.total += 1;
    if (!agg.updatedAt || e.updatedAt > agg.updatedAt) agg.updatedAt = e.updatedAt;
  }

  const odontograma: PacienteOdontoResumen[] = Array.from(aggByClinic, ([clinicId, agg]) => ({
    clinicId,
    teethWithFindings: agg.teeth.size,
    totalFindings: agg.total,
    updatedAt: agg.updatedAt ? agg.updatedAt.toISOString() : null,
  }));

  const res: PacienteHistorialResponse = { clinics, consultas, tratamientos, odontograma };
  return NextResponse.json(res);
}
