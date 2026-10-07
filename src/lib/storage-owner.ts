import { prisma } from "@/lib/prisma";
import { medirAlmacenamiento } from "@/lib/storage-usage";
import { sumarDesgloses, type DesgloseAlmacenamiento } from "@/lib/storage-usage-core";

/**
 * El almacenamiento del plan es POR CLIENTE (dueño), COMPARTIDO entre todas sus sedes (decisión de
 * Rafael, 7-oct-2026): el tope se compara contra la suma del uso de todas las sedes del dueño.
 * «Dueño» = el mismo criterio de `countOwnedClinics`/`getBranchQuota`: el SUPER_ADMIN activo (por
 * `supabaseId`) y las clínicas donde es SUPER_ADMIN activo. Con varios SUPER_ADMIN manda el más
 * antiguo (igual que /admin). Sin dueño localizable, la clínica sola (como antes).
 */
export function sedesDeLosDuenos(
  clinicId: string,
  filas: Array<{ supabaseId: string; clinicId: string }>,
): string[] {
  const dueno = filas.find((f) => f.clinicId === clinicId)?.supabaseId;
  if (!dueno) return [clinicId];
  return Array.from(new Set([clinicId, ...filas.filter((f) => f.supabaseId === dueno).map((f) => f.clinicId)]));
}

/** Ids de todas las sedes del dueño de `clinicId` (incluida ella). `clinicId` sale de la sesión. */
export async function sedesDelDueno(clinicId: string): Promise<string[]> {
  if (!clinicId) throw new Error("sedesDelDueno: falta clinicId");
  const propio = await prisma.user.findFirst({
    where: { clinicId, role: "SUPER_ADMIN", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { supabaseId: true },
  });
  if (!propio) return [clinicId];
  const filas = await prisma.user.findMany({
    where: { supabaseId: propio.supabaseId, role: "SUPER_ADMIN", isActive: true, clinic: { archivedAt: null } },
    select: { supabaseId: true, clinicId: true },
  });
  return sedesDeLosDuenos(clinicId, [{ supabaseId: propio.supabaseId, clinicId }, ...filas]);
}

/** Uso total del dueño (suma de todas sus sedes) y cuántas sedes entran. */
export async function medirAlmacenamientoDelDueno(
  clinicId: string,
): Promise<{ desglose: DesgloseAlmacenamiento; sedes: number; avisos: string[] }> {
  const ids = await sedesDelDueno(clinicId);
  const { porClinica, avisos } = await medirAlmacenamiento(ids);
  return { desglose: sumarDesgloses(ids.map((i) => porClinica.get(i)).filter((d): d is DesgloseAlmacenamiento => !!d)), sedes: ids.length, avisos };
}
