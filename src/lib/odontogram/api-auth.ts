import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { getVisiblePatientClinicIds, clinicScopeFilter } from "@/lib/branches";
import { patientVisibilityFilter, type VisibilityViewer } from "@/lib/patient-visibility";

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
 * Verifica que el paciente pertenezca a la clínica (aislamiento multi-tenant)
 * Y que el viewer pueda VERLO (Patient.visibleUserIds — Ola 3).
 *
 * Antes este helper hacía el findFirst "pelado" por clinicId que prohíbe la
 * regla dura de patient-visibility.ts:34-47: un doctor excluido de la lista no
 * veía al paciente en ningún listado pero, con el id, podía REEMPLAZARLE el
 * odontograma completo vía /sync (y PUT/DELETE/note). El viewer es parámetro
 * OBLIGATORIO a propósito: ningún caller nuevo puede olvidarlo sin que truene
 * el build. Semántica del filtro (patientVisibilityFilter): lista vacía = lo
 * ve todo el equipo; ADMIN/SUPER_ADMIN pasan siempre.
 *
 * MULTI-CLÍNICA · FASE 2: con `sharedRead: true` el gate acepta además a los
 * pacientes de las sedes VINCULADAS. Es OPT-IN y sólo lo pasa la LECTURA del
 * odontograma (GET /api/odontogram): escribir, sincronizar o resetear el
 * odontograma de un paciente prestado sigue prohibido, porque esas rutas
 * llaman sin la opción y siguen exigiendo la sede activa. Con sharing
 * encendido, un paciente prestado RESTRINGIDO queda fail-closed (la lista
 * guarda userIds de su sede origen y aquí se compara el userId de la sede
 * activa) — mismo resultado 404 que ya imponía el assertPatientVisible del
 * GET, así que este cambio no altera el comportamiento cross-sede.
 */
export async function ensurePatientInClinic(
  patientId: string,
  viewer: VisibilityViewer,
  opts?: { sharedRead?: boolean },
): Promise<boolean> {
  const clinicFilter = opts?.sharedRead
    ? clinicScopeFilter(await getVisiblePatientClinicIds(viewer.clinicId))
    : viewer.clinicId;
  const visibility = patientVisibilityFilter(viewer); // null = admin, ve todo
  const p = await prisma.patient.findFirst({
    where: {
      id: patientId,
      clinicId: clinicFilter,
      ...(visibility ? { AND: [visibility] } : {}),
    },
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
