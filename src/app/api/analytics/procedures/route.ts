import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/procedures?from=&to=
 *
 * Devuelve tabla por procedure type (Appointment.type) con:
 *  - count: veces realizada
 *  - avgConsultMin: promedio de consultEndAt - consultStartAt (del Timeline)
 *  - benchmark: heurística inicial de tiempo "esperado" por tipo
 *  - variance: avg - benchmark
 *  - fastestDoctor / slowestDoctor: doctor con menor/mayor tiempo promedio
 *
 * Solo cuenta citas con timeline completo (consultStartAt + consultEndAt).
 * Si <30 citas con timeline, devuelve insufficientData=true.
 */

// Benchmarks heurísticos iniciales por tipo común. Se sobrescriben con
// datos reales de la industria cuando la clínica acumule >100 citas.
const BENCHMARKS_MIN: Record<string, number> = {
  "Limpieza dental":         25,
  "Consulta general":        20,
  "Primera vez":             45,
  "Revisión / Control":      15,
  "Extracción":              30,
  "Endodoncia":              60,
  "Ortodoncia":              30,
  "Implante":                90,
  "Cirugía":                 60,
  "Nutrición":               40,
  "Psicología":              50,
  "Seguimiento":             20,
};

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam
    ? new Date(fromParam)
    : new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);

  // Trae appts con timeline join. Solo las que tienen ambos timestamps.
  const appts = await prisma.appointment.findMany({
    where: {
      clinicId,
      startsAt: { gte: from, lte: to },
      timeline: {
        consultStartAt: { not: null },
        consultEndAt: { not: null },
      },
    },
    select: {
      type: true,
      doctorId: true,
      timeline: { select: { totalConsultMin: true } },
      doctor: { select: { firstName: true, lastName: true } },
    },
  });

  if (appts.length < 5) {
    return NextResponse.json({
      insufficientData: true,
      sampleSize: appts.length,
      procedures: [],
    });
  }

  // Agrupa por type con stats.
  const byType = new Map<string, {
    count: number;
    totalMin: number;
    perDoctor: Map<string, { name: string; total: number; count: number }>;
  }>();
  for (const a of appts) {
    const min = a.timeline?.totalConsultMin ?? 0;
    if (min <= 0) continue;
    const entry = byType.get(a.type) ?? { count: 0, totalMin: 0, perDoctor: new Map() };
    entry.count += 1;
    entry.totalMin += min;
    const doctorKey = a.doctorId;
    const docName = `${a.doctor.firstName} ${a.doctor.lastName}`;
    const docEntry = entry.perDoctor.get(doctorKey) ?? { name: docName, total: 0, count: 0 };
    docEntry.total += min;
    docEntry.count += 1;
    entry.perDoctor.set(doctorKey, docEntry);
    byType.set(a.type, entry);
  }

  const procedures = Array.from(byType.entries())
    .map(([type, entry]) => {
      const avgConsultMin = Math.round(entry.totalMin / entry.count);
      const benchmark = BENCHMARKS_MIN[type] ?? null;
      const variance = benchmark != null ? avgConsultMin - benchmark : null;

      const doctorAverages = Array.from(entry.perDoctor.values()).map((d) => ({
        name: d.name,
        avgMin: Math.round(d.total / d.count),
        count: d.count,
      }));
      const sorted = [...doctorAverages].sort((a, b) => a.avgMin - b.avgMin);
      const fastest = sorted[0] ?? null;
      const slowest = sorted[sorted.length - 1] ?? null;

      return {
        type,
        count: entry.count,
        avgConsultMin,
        benchmark,
        variance,
        fastest,
        slowest: fastest && slowest && fastest.name === slowest.name ? null : slowest,
      };
    })
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    insufficientData: false,
    sampleSize: appts.length,
    procedures,
  });
}
