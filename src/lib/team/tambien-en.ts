import { prisma } from "@/lib/prisma";
import { sedesDelDueno } from "@/lib/storage-owner";
import { sedesQueVe } from "@/lib/sedes-que-ve";

/**
 * A3 — «también en: Sede A» para la lista de Equipo: nombres de las OTRAS sedes vivas del mismo
 * dueño donde cada miembro tiene ficha activa. `clinicId` sale de la sesión. Clave = supabaseId.
 *
 * ws1-t4 v7: solo las sedes a las que `quienMira` (el supabaseId de la SESIÓN) tiene acceso. Un
 * admin con ficha en dos de las tres sedes no lee el nombre de la tercera en la tarjeta del dueño;
 * el dueño, que está en todas, las sigue viendo todas.
 */
export async function sedesDeMiembros(
  clinicId: string,
  supabaseIds: string[],
  quienMira: string | null | undefined,
): Promise<Map<string, string[]>> {
  const mapa = new Map<string, string[]>();
  if (!clinicId || !quienMira || supabaseIds.length === 0) return mapa;
  const otras = (await sedesDelDueno(clinicId)).filter((c) => c !== clinicId);
  if (otras.length === 0) return mapa;
  const visibles = await sedesQueVe(quienMira, otras);
  const nombrables = otras.filter((c) => visibles.has(c));
  if (nombrables.length === 0) return mapa;
  const filas = await prisma.user.findMany({
    where: { supabaseId: { in: supabaseIds }, clinicId: { in: nombrables }, isActive: true },
    select: { supabaseId: true, clinic: { select: { name: true } } },
  });
  for (const f of filas) mapa.set(f.supabaseId, [...(mapa.get(f.supabaseId) ?? []), f.clinic.name]);
  return mapa;
}
