import "server-only";
import { prisma } from "@/lib/prisma";
import { makeItem } from "../helpers";
import type { BugItem } from "../types";

/**
 * 1.3 RLS coverage — tablas en schema public sin row level security.
 */
export async function scanRLSCoverage(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  try {
    const rows = await prisma.$queryRaw<Array<{ tablename: string; rowsecurity: boolean }>>`
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename NOT LIKE 'pg_%'
        AND tablename NOT LIKE '_prisma_%'
      ORDER BY tablename
    `;
    for (const r of rows) {
      if (!r.rowsecurity) {
        items.push(
          makeItem({
            category: "rls",
            severity: "critical",
            file: `db:public.${r.tablename}`,
            line: null,
            title: `Tabla ${r.tablename} sin RLS`,
            description:
              "Sin RLS, cualquier conexión que llegue a Postgres con un rol que tenga SELECT/UPDATE puede leer/mutar todas las filas de todas las clínicas.",
            suggestion:
              `Aplicá: ALTER TABLE "${r.tablename}" ENABLE ROW LEVEL SECURITY; y crea una policy con WHERE clinicId = current_setting('mf.clinic_id', true)::text. Si el acceso es solo desde el server con service role, agregá una policy RESTRICTIVE para anon+authenticated.`,
            code_snippet: null,
          }),
        );
      }
    }

    // Para tablas con RLS habilitada pero sin policies = HIGH.
    const policies = await prisma.$queryRaw<Array<{ tablename: string; cnt: bigint }>>`
      SELECT t.tablename, COUNT(p.policyname)::bigint AS cnt
      FROM pg_tables t
      LEFT JOIN pg_policies p ON p.schemaname = t.schemaname AND p.tablename = t.tablename
      WHERE t.schemaname = 'public'
        AND t.rowsecurity = true
        AND t.tablename NOT LIKE 'pg_%'
      GROUP BY t.tablename
    `;
    for (const r of policies) {
      const count = Number(r.cnt);
      if (count === 0) {
        items.push(
          makeItem({
            category: "rls",
            severity: "high",
            file: `db:public.${r.tablename}`,
            line: null,
            title: `Tabla ${r.tablename} con RLS pero sin policies`,
            description:
              "Con RLS habilitada y 0 policies, anon/authenticated NO pueden leer ni escribir. Solo service role bypassa. Está bien si la tabla nunca se accede via API directa, pero si el frontend la consulta vía Supabase client, los reads van a fallar silente.",
            suggestion:
              "Agregá una policy explícita (FOR SELECT/INSERT/UPDATE/DELETE TO authenticated USING ...) o documentá que el acceso es 100% server-side con service role.",
            code_snippet: null,
          }),
        );
      }
    }
  } catch (e) {
    items.push(
      makeItem({
        category: "rls",
        severity: "low",
        file: "scanner:db",
        line: null,
        title: "No se pudo consultar RLS",
        description: `Error al ejecutar SELECT pg_tables: ${(e as Error).message}`,
        suggestion: "Verificá que el rol DB tenga permiso de SELECT en pg_tables y pg_policies (suele ser default).",
        code_snippet: null,
      }),
    );
  }
  return items;
}

/**
 * 1.4 FKs huérfanas — registros que referencian un id inexistente.
 */
export async function scanOrphanFKs(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const checks: Array<{ name: string; sql: string; severity: "critical" | "high" }> = [
    {
      name: "patients sin clinic",
      sql: `SELECT COUNT(*)::int AS n FROM "patients" p LEFT JOIN "clinics" c ON c.id = p."clinicId" WHERE c.id IS NULL`,
      severity: "critical",
    },
    {
      name: "appointments sin patient",
      sql: `SELECT COUNT(*)::int AS n FROM "appointments" a LEFT JOIN "patients" p ON p.id = a."patientId" WHERE p.id IS NULL`,
      severity: "high",
    },
    {
      name: "appointments sin doctor (User)",
      sql: `SELECT COUNT(*)::int AS n FROM "appointments" a LEFT JOIN "User" u ON u.id = a."doctorId" WHERE u.id IS NULL`,
      severity: "high",
    },
    {
      name: "invoices sin patient",
      sql: `SELECT COUNT(*)::int AS n FROM "invoices" i LEFT JOIN "patients" p ON p.id = i."patientId" WHERE p.id IS NULL`,
      severity: "high",
    },
    {
      name: "medical_records sin patient",
      sql: `SELECT COUNT(*)::int AS n FROM "medical_records" m LEFT JOIN "patients" p ON p.id = m."patientId" WHERE p.id IS NULL`,
      severity: "high",
    },
    {
      name: "clinics sin usuarios",
      sql: `SELECT COUNT(*)::int AS n FROM "clinics" c WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."clinicId" = c.id)`,
      severity: "high",
    },
  ];
  for (const c of checks) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(c.sql);
      const n = rows[0]?.n ?? 0;
      if (n > 0) {
        items.push(
          makeItem({
            category: "fk-orphans",
            severity: c.severity,
            file: "db:integrity",
            line: null,
            title: `${c.name}: ${n} registros huérfanos`,
            description:
              "FKs huérfanas indican un onDelete CASCADE faltante o un cleanup incompleto. Pueden causar 500s en queries que asumen el FK existe.",
            suggestion:
              "Identificá la causa (delete manual, migración mala, seed) y arreglá los registros (delete o reasignar). Asegurate de que las relaciones tengan onDelete: Cascade donde corresponde.",
            code_snippet: null,
          }),
        );
      }
    } catch {
      // Tabla puede no existir en preview, skip.
    }
  }
  return items;
}
