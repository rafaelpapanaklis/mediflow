import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { getVisiblePatientClinicIds, clinicScopeFilter } from "@/lib/branches";

/**
 * Resuelve el usuario de la clínica activa a partir de la sesión de Supabase.
 * Compartido por las rutas /api/odontogram/* (principal, note, sync, reset).
 */
export async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  if (activeClinicId) {
    const u = await prisma.user.findFirst({
      where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true },
    });
    if (u) return u;
  }
  return prisma.user.findFirst({
    where: { supabaseId: user.id, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Verifica que el paciente pertenezca a la clínica (aislamiento multi-tenant).
 *
 * MULTI-CLÍNICA · FASE 2: con `sharedRead: true` el gate acepta además a los
 * pacientes de las sedes VINCULADAS. Es OPT-IN y sólo lo pasa la LECTURA del
 * odontograma (GET /api/odontogram): escribir, sincronizar o resetear el
 * odontograma de un paciente prestado sigue prohibido, porque esas rutas
 * llaman sin la opción y siguen exigiendo la sede activa.
 */
export async function ensurePatientInClinic(
  patientId: string,
  clinicId: string,
  opts?: { sharedRead?: boolean },
): Promise<boolean> {
  const clinicFilter = opts?.sharedRead
    ? clinicScopeFilter(await getVisiblePatientClinicIds(clinicId))
    : clinicId;
  const p = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: clinicFilter },
    select: { id: true },
  });
  return p !== null;
}

/** Detecta el error específico de "tabla no existe" (Prisma P2021 / Postgres 42P01). */
export function isMissingTableError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; message?: string; meta?: { code?: string } };
  if (e.code === "P2021") return true;
  if (e.code === "42P01") return true;
  if (e.meta?.code === "42P01") return true;
  if (
    typeof e.message === "string" &&
    /relation .* does not exist|odontogram_entries.*does not exist/i.test(e.message)
  ) {
    return true;
  }
  return false;
}
