import { prisma } from "@/lib/prisma";

/**
 * ws1-t4 v7 — ¿A cuáles de estas sedes tiene acceso quien MIRA?
 *
 * Acceso = ficha activa en una sede sin archivar: exactamente las sedes que esa persona
 * ve en su selector (`getUserClinics`). Todo lo que nombre sedes de OTRA persona (el
 * «También en» de Equipo, el aviso de la sede que paga…) se filtra con esto: el nombre
 * de una sede a la que no tienes acceso no te sale (puede tener «Clave de la sede»).
 * El dueño tiene ficha en todas sus sedes, así que las sigue viendo todas.
 *
 * `supabaseId` sale SIEMPRE de la sesión. Sin él, o sin candidatas, no se consulta nada
 * y no ve ninguna.
 */
export async function sedesQueVe(supabaseId: string | null | undefined, candidatas: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(candidatas.filter(Boolean)));
  if (!supabaseId || ids.length === 0) return new Set();
  const filas = await prisma.user.findMany({
    where: { supabaseId, clinicId: { in: ids }, isActive: true, clinic: { archivedAt: null } },
    select: { clinicId: true },
  });
  return new Set(filas.map((f) => f.clinicId));
}
