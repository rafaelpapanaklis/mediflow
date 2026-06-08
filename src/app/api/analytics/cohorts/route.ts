import { NextResponse, type NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/analytics/cohorts
 *
 * Retención por cohorte: agrupa pacientes por mes de alta (createdAt) y calcula
 * el % que sigue activo (con cita no cancelada) a 1/3/6/12 meses. Un milestone
 * solo cuenta si la cohorte ya tiene esa antigüedad (eligible).
 *
 * Escala: el bucketing por mes y el conteo de eligible/retained por milestone
 * se hacen EN LA BASE con GROUP BY + FILTER (se eliminó el techo de 10000 que
 * truncaba en silencio; ya no se traen pacientes con sus citas a JS). "Mes" =
 * 30 días exactos (igual que el código original). createdAt es timestamp sin
 * tz, así que to_char/EXTRACT dan componentes UTC (idéntico a getUTCMonth y
 * getTime en Vercel UTC). Cacheado por clínica 5 min (clinicId en la key).
 *
 * Multi-tenant: clinicId SIEMPRE desde getCurrentUser y filtrado en cada CTE.
 * Admin only.
 */

const REVALIDATE_SECONDS = 300;
const MS_MONTH = 30 * 24 * 60 * 60 * 1000;
const MILESTONES = [1, 3, 6, 12];

interface CohortRetention {
  month: number;
  eligible: number;
  retained: number;
  pct: number | null;
}
interface CohortRow {
  month: string;
  signups: number;
  retention: CohortRetention[];
}
interface CohortResp {
  cohorts: CohortRow[];
  milestones: number[];
}

interface RawCohort {
  cohort: string;
  signups: number;
  eligible_1: number;
  retained_1: number;
  eligible_3: number;
  retained_3: number;
  eligible_6: number;
  retained_6: number;
  eligible_12: number;
  retained_12: number;
}

function getCohorts(clinicId: string): Promise<CohortResp> {
  return unstable_cache(
    async (): Promise<CohortResp> => {
      // last_activity_ms = última cita no cancelada (epoch ms absoluto). Las
      // ventanas de milestone se evalúan contra created_ms + m*30d, todo en
      // epoch ms para ser tz-safe e idéntico a la versión JS.
      const rows = await prisma.$queryRaw<RawCohort[]>`
        WITH la AS (
          SELECT "patientId",
                 MAX(EXTRACT(EPOCH FROM "startsAt") * 1000) AS last_activity_ms
          FROM "appointments"
          WHERE "clinicId" = ${clinicId} AND "status" <> 'CANCELLED'
          GROUP BY "patientId"
        ),
        pa AS (
          SELECT
            to_char(p."createdAt", 'YYYY-MM')                                              AS cohort,
            (EXTRACT(EPOCH FROM p."createdAt") * 1000)                                     AS created_ms,
            (EXTRACT(EPOCH FROM now()) * 1000) - (EXTRACT(EPOCH FROM p."createdAt") * 1000) AS age_ms,
            COALESCE(la.last_activity_ms, 0)                                               AS last_activity_ms
          FROM "patients" p
          LEFT JOIN la ON la."patientId" = p."id"
          WHERE p."clinicId" = ${clinicId} AND p."deletedAt" IS NULL
        )
        SELECT
          cohort,
          CAST(COUNT(*) AS int) AS signups,
          CAST(COUNT(*) FILTER (WHERE age_ms >= ${MS_MONTH}) AS int) AS eligible_1,
          CAST(COUNT(*) FILTER (WHERE age_ms >= ${MS_MONTH} AND last_activity_ms >= created_ms + ${MS_MONTH}) AS int) AS retained_1,
          CAST(COUNT(*) FILTER (WHERE age_ms >= ${3 * MS_MONTH}) AS int) AS eligible_3,
          CAST(COUNT(*) FILTER (WHERE age_ms >= ${3 * MS_MONTH} AND last_activity_ms >= created_ms + ${3 * MS_MONTH}) AS int) AS retained_3,
          CAST(COUNT(*) FILTER (WHERE age_ms >= ${6 * MS_MONTH}) AS int) AS eligible_6,
          CAST(COUNT(*) FILTER (WHERE age_ms >= ${6 * MS_MONTH} AND last_activity_ms >= created_ms + ${6 * MS_MONTH}) AS int) AS retained_6,
          CAST(COUNT(*) FILTER (WHERE age_ms >= ${12 * MS_MONTH}) AS int) AS eligible_12,
          CAST(COUNT(*) FILTER (WHERE age_ms >= ${12 * MS_MONTH} AND last_activity_ms >= created_ms + ${12 * MS_MONTH}) AS int) AS retained_12
        FROM pa
        GROUP BY cohort
        ORDER BY cohort ASC
      `;

      const mk = (m: number, eligible: number, retained: number): CohortRetention => {
        const e = Number(eligible);
        const r = Number(retained);
        return { month: m, eligible: e, retained: r, pct: e > 0 ? Math.round((r / e) * 100) : null };
      };

      const cohorts: CohortRow[] = rows
        .map((row) => ({
          month: row.cohort,
          signups: Number(row.signups),
          retention: [
            mk(1, row.eligible_1, row.retained_1),
            mk(3, row.eligible_3, row.retained_3),
            mk(6, row.eligible_6, row.retained_6),
            mk(12, row.eligible_12, row.retained_12),
          ],
        }))
        .slice(-12);

      return { cohorts, milestones: MILESTONES };
    },
    ["analytics-cohorts", clinicId],
    { revalidate: REVALIDATE_SECONDS, tags: [`analytics-${clinicId}`] },
  )();
}

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const data = await getCohorts(user.clinicId);
  return NextResponse.json(data);
}
