import { NextResponse, type NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/analytics/patients-value
 *
 * Valor por paciente (LTV): total facturado (Invoice.total), total pagado
 * (Invoice.paid), saldo (Invoice.balance), nº de visitas (citas COMPLETED/
 * CHECKED_OUT), última visita y próxima cita. Devuelve el top de pacientes
 * por valor + totales de la clínica.
 *
 * Escala: la agregación se hace EN LA BASE (una sola query con CTEs + window
 * aggregates), sin traer filas capadas a JS. Los totales son sobre TODOS los
 * pacientes (se eliminó el viejo techo de 5000 que truncaba en silencio) y el
 * top sale con LIMIT. Resultado cacheado por clínica 5 min (unstable_cache con
 * clinicId en la key → sin fuga cross-clínica).
 *
 * Multi-tenant: clinicId SIEMPRE desde getCurrentUser y filtrado en cada CTE.
 * Admin only.
 */

const REVALIDATE_SECONDS = 300;

interface ValueRow {
  id: string;
  name: string;
  patientNumber: string;
  phone: string | null;
  invoiced: number;
  paid: number;
  balance: number;
  visits: number;
  lastVisit: string | null;
  nextAppointment: string | null;
}

interface ValueResp {
  totals: {
    invoiced: number;
    paid: number;
    balance: number;
    patients: number;
    payingPatients: number;
    avgLtv: number;
  };
  top: ValueRow[];
}

interface RawRow {
  id: string;
  firstName: string;
  lastName: string;
  patientNumber: string;
  phone: string | null;
  invoiced: number;
  paid: number;
  balance: number;
  visits: number;
  last_visit: Date | null;
  next_appt: Date | null;
  t_invoiced: number;
  t_paid: number;
  t_balance: number;
  t_patients: number;
  t_paying: number;
}

function getPatientsValue(clinicId: string): Promise<ValueResp> {
  return unstable_cache(
    async (): Promise<ValueResp> => {
      const now = new Date();
      // Agregamos invoices y appointments por separado (evita el producto
      // cartesiano que inflaría las sumas) y los unimos por paciente. Los
      // totales usan window aggregates sobre el set COMPLETO, evaluados antes
      // del LIMIT, así que no dependen del top ni del cap.
      const rows = await prisma.$queryRaw<RawRow[]>`
        WITH inv AS (
          SELECT "patientId",
                 COALESCE(SUM("total"), 0)   AS invoiced,
                 COALESCE(SUM("paid"), 0)    AS paid,
                 COALESCE(SUM("balance"), 0) AS balance
          FROM "invoices"
          WHERE "clinicId" = ${clinicId}
          GROUP BY "patientId"
        ),
        appt AS (
          SELECT "patientId",
                 CAST(COUNT(*) FILTER (WHERE "status" IN ('COMPLETED','CHECKED_OUT')) AS int) AS visits,
                 MAX("startsAt") FILTER (WHERE "status" IN ('COMPLETED','CHECKED_OUT')) AS last_visit,
                 MIN("startsAt") FILTER (WHERE "startsAt" >= ${now} AND "status" NOT IN ('CANCELLED','NO_SHOW')) AS next_appt
          FROM "appointments"
          WHERE "clinicId" = ${clinicId}
          GROUP BY "patientId"
        ),
        per_patient AS (
          SELECT p."id", p."firstName", p."lastName", p."patientNumber", p."phone",
                 COALESCE(inv.invoiced, 0) AS invoiced,
                 COALESCE(inv.paid, 0)     AS paid,
                 COALESCE(inv.balance, 0)  AS balance,
                 COALESCE(appt.visits, 0)  AS visits,
                 appt.last_visit,
                 appt.next_appt
          FROM "patients" p
          LEFT JOIN inv  ON inv."patientId"  = p."id"
          LEFT JOIN appt ON appt."patientId" = p."id"
          WHERE p."clinicId" = ${clinicId}
            AND p."deletedAt" IS NULL
            AND p."status" <> 'ARCHIVED'
        )
        SELECT pp.*,
               SUM(pp.invoiced) OVER ()                                 AS t_invoiced,
               SUM(pp.paid)     OVER ()                                 AS t_paid,
               SUM(pp.balance)  OVER ()                                 AS t_balance,
               CAST(COUNT(*) OVER () AS int)                            AS t_patients,
               CAST(COUNT(*) FILTER (WHERE pp.paid > 0) OVER () AS int) AS t_paying
        FROM per_patient pp
        ORDER BY pp.paid DESC, pp."id" ASC
        LIMIT 50
      `;

      const top: ValueRow[] = rows.map((r) => ({
        id: r.id,
        name: `${r.firstName} ${r.lastName}`.trim(),
        patientNumber: r.patientNumber,
        phone: r.phone,
        invoiced: Number(r.invoiced),
        paid: Number(r.paid),
        balance: Number(r.balance),
        visits: Number(r.visits),
        lastVisit: r.last_visit ? new Date(r.last_visit).toISOString() : null,
        nextAppointment: r.next_appt ? new Date(r.next_appt).toISOString() : null,
      }));

      const first = rows[0];
      const totalPaid = first ? Number(first.t_paid) : 0;
      const paying = first ? Number(first.t_paying) : 0;
      const totals = {
        invoiced: first ? Number(first.t_invoiced) : 0,
        paid: totalPaid,
        balance: first ? Number(first.t_balance) : 0,
        patients: first ? Number(first.t_patients) : 0,
        payingPatients: paying,
        avgLtv: paying > 0 ? Math.round(totalPaid / paying) : 0,
      };

      return { totals, top };
    },
    ["analytics-patients-value", clinicId],
    { revalidate: REVALIDATE_SECONDS, tags: [`analytics-${clinicId}`] },
  )();
}

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const data = await getPatientsValue(user.clinicId);
  return NextResponse.json(data);
}
