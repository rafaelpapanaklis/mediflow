import { prisma } from "@/lib/prisma";
import { sedesDelDueno } from "@/lib/storage-owner";

/**
 * A3 — «también en: Sede A» para la lista de Equipo: nombres de las OTRAS sedes vivas del mismo
 * dueño donde cada miembro tiene ficha activa. `clinicId` sale de la sesión. Clave = supabaseId.
 */
export async function sedesDeMiembros(clinicId: string, supabaseIds: string[]): Promise<Map<string, string[]>> {
  const mapa = new Map<string, string[]>();
  if (!clinicId || supabaseIds.length === 0) return mapa;
  const otras = (await sedesDelDueno(clinicId)).filter((c) => c !== clinicId);
  if (otras.length === 0) return mapa;
  const filas = await prisma.user.findMany({
    where: { supabaseId: { in: supabaseIds }, clinicId: { in: otras }, isActive: true },
    select: { supabaseId: true, clinic: { select: { name: true } } },
  });
  for (const f of filas) mapa.set(f.supabaseId, [...(mapa.get(f.supabaseId) ?? []), f.clinic.name]);
  return mapa;
}
