// GET /api/paciente/summary — Implementa A5. Respuesta: PacienteSummaryResponse.
// · getPatientPortalContext() | 401.
// · patientIds = ctx.links.map(l => l.patientId). Si 0 links → respuesta vacía
//   válida (clinics: [], upcoming: [], pendingByClinic: [], pendingTotal: 0).
// · clinics: patientAccountLink → include patient { select id, patientNumber,
//   clinic { id, name, slug, logoUrl, city, phone } } → mapear a PacienteClinica.
// · upcoming: appointment.findMany({ patientId in, startsAt >= now,
//   status notIn [CANCELLED, NO_SHOW] }, orderBy startsAt asc, take 5,
//   select paciente-safe: id, clinicId, type, status, startsAt, endsAt,
//   doctor { firstName, lastName } → doctorName).
// · pendingByClinic: invoice.groupBy o findMany({ patientId in, status in
//   [PENDING, PARTIAL, OVERDUE] }, select clinicId, balance) y sumar en JS.
// · Máximo 3-4 queries; NUNCA exponer campos fuera del contrato (types.ts).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import type {
  PacienteCita,
  PacienteClinica,
  PacienteSummaryResponse,
} from "@/lib/patient-portal/types";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET() {
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    // ctx.links es la fuente de verdad multi-tenant (cuenta ↔ expedientes).
    const patientIds = ctx.links.map((l) => l.patientId);

    if (patientIds.length === 0) {
      const empty: PacienteSummaryResponse = {
        me: ctx.account,
        clinics: [],
        upcoming: [],
        pendingByClinic: [],
        pendingTotal: 0,
      };
      return NextResponse.json(empty);
    }

    const now = new Date();
    const [links, appointments, invoices] = await Promise.all([
      // Clínicas vinculadas (solo pacientes no borrados).
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
      // Próximas 5 citas — select paciente-safe (sin notes, price ni tokens tele).
      prisma.appointment.findMany({
        where: {
          patientId: { in: patientIds },
          startsAt: { gte: now },
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
        },
        orderBy: { startsAt: "asc" },
        take: 5,
        select: {
          id: true,
          clinicId: true,
          type: true,
          status: true,
          startsAt: true,
          endsAt: true,
          doctor: { select: { firstName: true, lastName: true } },
        },
      }),
      // Saldo pendiente: solo clinicId + balance (sin items ni notes).
      prisma.invoice.findMany({
        where: {
          patientId: { in: patientIds },
          status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
        },
        select: { clinicId: true, balance: true },
      }),
    ]);

    const clinics: PacienteClinica[] = links.map((l) => ({
      clinicId: l.clinicId,
      clinicName: l.patient.clinic.name,
      clinicSlug: l.patient.clinic.slug,
      logoUrl: l.patient.clinic.logoUrl,
      city: l.patient.clinic.city,
      phone: l.patient.clinic.phone,
      patientId: l.patient.id,
      patientNumber: l.patient.patientNumber,
    }));

    const upcoming: PacienteCita[] = appointments.map((a) => ({
      id: a.id,
      clinicId: a.clinicId,
      type: a.type,
      status: a.status,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      doctorName: `${a.doctor.firstName} ${a.doctor.lastName}`,
    }));

    // Suma de balances por clínica en JS (redondeo a 2 decimales).
    const pendingMap = new Map<string, number>();
    for (const inv of invoices) {
      pendingMap.set(inv.clinicId, (pendingMap.get(inv.clinicId) || 0) + inv.balance);
    }
    const pendingByClinic = Array.from(pendingMap.entries()).map(([clinicId, amount]) => ({
      clinicId,
      amount: round2(amount),
    }));
    const pendingTotal = round2(
      invoices.reduce((sum, inv) => sum + inv.balance, 0)
    );

    const response: PacienteSummaryResponse = {
      me: ctx.account,
      clinics,
      upcoming,
      pendingByClinic,
      pendingTotal,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("[paciente/summary] error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
