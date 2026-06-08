import { NextResponse, type NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/analytics/churn-risk
 *
 * Pacientes EN RIESGO de abandono, con su motivo:
 *  - Sin cita en > clinic.recallMonths meses (y sin próxima cita), o
 *  - >= 2 inasistencias (NO_SHOW) en los últimos 6 meses, o
 *  - Saldo pendiente alto.
 *
 * Escala: la agregación por paciente (última visita, próxima cita, NO_SHOWs,
 * saldo) y el filtro "en riesgo" se hacen EN LA BASE; a JS solo llegan los
 * pacientes en riesgo (se eliminó el techo de 5000 + las citas/invoices
 * anidadas). Las cadenas de "motivo" (es-MX) se arman en JS para conservar el
 * texto idéntico. Cacheado por clínica 5 min (clinicId en la key).
 *
 * Multi-tenant: clinicId SIEMPRE desde getCurrentUser y filtrado en cada CTE.
 * Admin only.
 */

const REVALIDATE_SECONDS = 300;
// Saldo a partir del cual se considera "alto" para señal de churn (MXN).
const HIGH_BALANCE = 1000;

interface ChurnRow {
  id: string;
  name: string;
  phone: string | null;
  lastVisit: string | null;
  balance: number;
  noShows: number;
  reasons: string[];
}
interface ChurnResp {
  recallMonths: number;
  count: number;
  patients: ChurnRow[];
}

interface RawChurn {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  createdAt: Date;
  last_visit: Date | null;
  has_upcoming: boolean;
  recent_no_shows: number;
  balance: number;
}

function getChurnRisk(clinicId: string): Promise<ChurnResp> {
  return unstable_cache(
    async (): Promise<ChurnResp> => {
      const clinicRows = await prisma.$queryRaw<Array<{ recallMonths: number }>>`
        SELECT "recallMonths" FROM "clinics" WHERE "id" = ${clinicId} LIMIT 1
      `;
      const recallMonths = clinicRows[0]?.recallMonths ?? 6;

      const now = new Date();
      const recallCutoff = new Date(now);
      recallCutoff.setMonth(recallCutoff.getMonth() - recallMonths);
      const recallCutoffMs = recallCutoff.getTime();
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      // El filtro "en riesgo" replica exactamente reasons.length > 0 con
      // comparaciones en epoch ms (tz-safe). Solo vuelven los en riesgo.
      const rows = await prisma.$queryRaw<RawChurn[]>`
        WITH appt AS (
          SELECT "patientId",
            MAX("startsAt") FILTER (WHERE "status" <> 'CANCELLED') AS last_visit,
            bool_or("startsAt" >= ${now} AND "status" NOT IN ('CANCELLED','NO_SHOW')) AS has_upcoming,
            CAST(COUNT(*) FILTER (WHERE "status" = 'NO_SHOW' AND "startsAt" >= ${sixMonthsAgo}) AS int) AS recent_no_shows
          FROM "appointments"
          WHERE "clinicId" = ${clinicId}
          GROUP BY "patientId"
        ),
        inv AS (
          SELECT "patientId", COALESCE(SUM("balance"), 0) AS balance
          FROM "invoices"
          WHERE "clinicId" = ${clinicId} AND "balance" > 0
          GROUP BY "patientId"
        )
        SELECT p."id", p."firstName", p."lastName", p."phone", p."createdAt",
               a.last_visit,
               COALESCE(a.has_upcoming, false)   AS has_upcoming,
               COALESCE(a.recent_no_shows, 0)    AS recent_no_shows,
               COALESCE(i.balance, 0)            AS balance
        FROM "patients" p
        LEFT JOIN appt a ON a."patientId" = p."id"
        LEFT JOIN inv  i ON i."patientId" = p."id"
        WHERE p."clinicId" = ${clinicId}
          AND p."deletedAt" IS NULL
          AND p."status" = 'ACTIVE'
          AND (
            ( COALESCE(a.has_upcoming, false) = false AND (
                (a.last_visit IS NOT NULL AND (EXTRACT(EPOCH FROM a.last_visit) * 1000) < ${recallCutoffMs}) OR
                (a.last_visit IS NULL AND (EXTRACT(EPOCH FROM p."createdAt") * 1000) < ${recallCutoffMs})
            ))
            OR COALESCE(a.recent_no_shows, 0) >= 2
            OR COALESCE(i.balance, 0) >= ${HIGH_BALANCE}
          )
      `;

      const atRisk: ChurnRow[] = rows
        .map((r) => {
          const lastVisitMs = r.last_visit ? new Date(r.last_visit).getTime() : null;
          const balance = Number(r.balance);
          const recentNoShows = Number(r.recent_no_shows);
          const reasons: string[] = [];
          if (!r.has_upcoming) {
            if (lastVisitMs !== null && lastVisitMs < recallCutoffMs) {
              reasons.push(`Sin visitas en más de ${recallMonths} meses`);
            } else if (lastVisitMs === null && new Date(r.createdAt) < recallCutoff) {
              reasons.push("Registrado hace tiempo y sin citas");
            }
          }
          if (recentNoShows >= 2) reasons.push(`${recentNoShows} inasistencias recientes`);
          if (balance >= HIGH_BALANCE) {
            reasons.push(`Saldo pendiente de $${Math.round(balance).toLocaleString("es-MX")}`);
          }

          return {
            id: r.id,
            name: `${r.firstName} ${r.lastName}`.trim(),
            phone: r.phone,
            lastVisit: r.last_visit ? new Date(r.last_visit).toISOString() : null,
            balance,
            noShows: recentNoShows,
            reasons,
          };
        })
        .filter((p) => p.reasons.length > 0)
        .sort((a, b) => b.reasons.length - a.reasons.length || b.balance - a.balance);

      return { recallMonths, count: atRisk.length, patients: atRisk.slice(0, 100) };
    },
    ["analytics-churn-risk", clinicId],
    { revalidate: REVALIDATE_SECONDS, tags: [`analytics-${clinicId}`] },
  )();
}

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const data = await getChurnRisk(user.clinicId);
  return NextResponse.json(data);
}
