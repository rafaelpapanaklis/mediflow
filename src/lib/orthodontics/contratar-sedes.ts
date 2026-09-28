import "server-only";
import { prisma } from "@/lib/prisma";
import { getOwnedBranches } from "@/lib/branches";
import { activeOrthodonticsModuleClinicIds } from "./access";
import { combinarSedesHermanas, type SedeHermana } from "./contratar";

export type { SedeHermana };

/**
 * Contratar Ortodoncia por SEDE (ws1-t2, ronda 5) — decisión de Rafael: cada
 * sede es su propia `Clinic` y contrata el módulo por su cuenta; una no le
 * presta el módulo a otra. Esto le da a la página de contratar la lista de
 * OTRAS sedes del mismo dueño (mismo `supabaseId`, `role: "SUPER_ADMIN"` —
 * ver `getOwnedBranches`) que también son dentales, con si YA tienen el
 * módulo o no.
 *
 * Sin datos de pacientes: solo `clinicId`, nombre y un booleano. Si el
 * usuario no es dueño de ninguna otra sede (`getOwnedBranches` solo trae las
 * que son SUYAS como SUPER_ADMIN), la lista sale vacía y la página no pinta
 * nada extra — el caso de siempre, una sola sede.
 *
 * El shell con I/O de `combinarSedesHermanas` (puro, en `contratar.ts`, para
 * poder probarlo sin base).
 */
export async function sedesHermanasConOrtodoncia(
  supabaseId: string,
  clinicIdActual: string,
): Promise<SedeHermana[]> {
  const propias = await getOwnedBranches(supabaseId);
  const otras = propias.filter((s) => s.clinicId !== clinicIdActual);
  if (otras.length === 0) return [];

  const [clinicas, activas] = await Promise.all([
    prisma.clinic.findMany({
      where: { id: { in: otras.map((s) => s.clinicId) } },
      select: { id: true, category: true },
    }),
    activeOrthodonticsModuleClinicIds(otras.map((s) => s.clinicId)),
  ]);
  const categoriaPorId = new Map(clinicas.map((c) => [c.id, c.category]));

  return combinarSedesHermanas(propias, clinicIdActual, categoriaPorId, activas);
}
