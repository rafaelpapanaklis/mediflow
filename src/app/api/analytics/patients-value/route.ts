import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/patients-value
 *
 * Valor por paciente (LTV): total facturado (Invoice.total), total pagado
 * (Invoice.paid), saldo (Invoice.balance), nº de visitas (citas COMPLETED/
 * CHECKED_OUT), última visita y próxima cita. Devuelve el top de pacientes
 * por valor + totales de la clínica.
 *
 * Multi-tenant: clinicId SIEMPRE desde getCurrentUser. Admin/owner only.
 */
export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const clinicId = user.clinicId;
  const now = new Date();

  const patients = await prisma.patient.findMany({
    where: { clinicId, deletedAt: null, status: { not: "ARCHIVED" } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      patientNumber: true,
      phone: true,
      invoices: { select: { total: true, paid: true, balance: true } },
      appointments: { select: { startsAt: true, status: true } },
    },
    take: 5000,
  });

  const rows = patients.map((p) => {
    let invoiced = 0, paid = 0, balance = 0;
    for (const inv of p.invoices) {
      invoiced += inv.total ?? 0;
      paid += inv.paid ?? 0;
      balance += inv.balance ?? 0;
    }
    let visits = 0;
    let lastVisit: number | null = null;
    let nextAppt: number | null = null;
    for (const a of p.appointments) {
      const ts = new Date(a.startsAt).getTime();
      if (a.status === "COMPLETED" || a.status === "CHECKED_OUT") {
        visits++;
        if (lastVisit === null || ts > lastVisit) lastVisit = ts;
      }
      if (ts >= now.getTime() && a.status !== "CANCELLED" && a.status !== "NO_SHOW") {
        if (nextAppt === null || ts < nextAppt) nextAppt = ts;
      }
    }
    return {
      id: p.id,
      name: `${p.firstName} ${p.lastName}`.trim(),
      patientNumber: p.patientNumber,
      phone: p.phone,
      invoiced,
      paid,
      balance,
      visits,
      lastVisit: lastVisit ? new Date(lastVisit).toISOString() : null,
      nextAppointment: nextAppt ? new Date(nextAppt).toISOString() : null,
    };
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.invoiced += r.invoiced;
      acc.paid += r.paid;
      acc.balance += r.balance;
      return acc;
    },
    { invoiced: 0, paid: 0, balance: 0 },
  );
  const payingPatients = rows.filter((r) => r.paid > 0).length;
  const avgLtv = payingPatients > 0 ? Math.round(totals.paid / payingPatients) : 0;

  const top = [...rows].sort((a, b) => b.paid - a.paid).slice(0, 50);

  return NextResponse.json({
    totals: { ...totals, patients: rows.length, payingPatients, avgLtv },
    top,
  });
}
