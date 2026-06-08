import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";

/**
 * Resuelve el usuario de la clínica activa a partir de la sesión de Supabase.
 * Compartido por /api/odontogram y /api/odontogram/note.
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

/** Verifica que el paciente pertenezca a la clínica (aislamiento multi-tenant). */
export async function ensurePatientInClinic(
  patientId: string,
  clinicId: string,
): Promise<boolean> {
  const p = await prisma.patient.findFirst({
    where: { id: patientId, clinicId },
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
