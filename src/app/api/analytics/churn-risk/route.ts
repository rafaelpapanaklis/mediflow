import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Saldo a partir del cual se considera "alto" para señal de churn (MXN).
const HIGH_BALANCE = 1000;

/**
 * GET /api/analytics/churn-risk
 *
 * Pacientes EN RIESGO de abandono, con su motivo:
 *  - Sin cita en > clinic.recallMonths meses (y sin próxima cita), o
 *  - >= 2 inasistencias (NO_SHOW) en los últimos 6 meses, o
 *  - Saldo pendiente alto.
 *
 * Multi-tenant: clinicId SIEMPRE desde getCurrentUser. Admin/owner only.
 */
export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const clinicId = user.clinicId;

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { recallMonths: true },
  });
  const recallMonths = clinic?.recallMonths ?? 6;

  const now = new Date();
  const recallCutoff = new Date(now);
  recallCutoff.setMonth(recallCutoff.getMonth() - recallMonths);
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const patients = await prisma.patient.findMany({
    where: { clinicId, deletedAt: null, status: "ACTIVE" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      createdAt: true,
      appointments: { select: { startsAt: true, status: true } },
      invoices: { where: { balance: { gt: 0 } }, select: { balance: true } },
    },
    take: 5000,
  });

  const atRisk = patients
    .map((p) => {
      let lastVisit: number | null = null;
      let hasUpcoming = false;
      let recentNoShows = 0;
      for (const a of p.appointments) {
        const ts = new Date(a.startsAt).getTime();
        if (a.status !== "CANCELLED" && ts > (lastVisit ?? 0)) lastVisit = ts;
        if (ts >= now.getTime() && a.status !== "CANCELLED" && a.status !== "NO_SHOW") hasUpcoming = true;
        if (a.status === "NO_SHOW" && ts >= sixMonthsAgo.getTime()) recentNoShows++;
      }
      const balance = p.invoices.reduce((s, i) => s + (i.balance ?? 0), 0);

      const reasons: string[] = [];
      if (!hasUpcoming) {
        if (lastVisit !== null && lastVisit < recallCutoff.getTime()) {
          reasons.push(`Sin visitas en más de ${recallMonths} meses`);
        } else if (lastVisit === null && new Date(p.createdAt) < recallCutoff) {
          reasons.push("Registrado hace tiempo y sin citas");
        }
      }
      if (recentNoShows >= 2) reasons.push(`${recentNoShows} inasistencias recientes`);
      if (balance >= HIGH_BALANCE) {
        reasons.push(`Saldo pendiente de $${Math.round(balance).toLocaleString("es-MX")}`);
      }

      return {
        id: p.id,
        name: `${p.firstName} ${p.lastName}`.trim(),
        phone: p.phone,
        lastVisit: lastVisit ? new Date(lastVisit).toISOString() : null,
        balance,
        noShows: recentNoShows,
        reasons,
      };
    })
    .filter((p) => p.reasons.length > 0)
    .sort((a, b) => b.reasons.length - a.reasons.length || b.balance - a.balance);

  return NextResponse.json({
    recallMonths,
    count: atRisk.length,
    patients: atRisk.slice(0, 100),
  });
}
