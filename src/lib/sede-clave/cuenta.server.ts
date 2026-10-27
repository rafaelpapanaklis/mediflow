// ws1-t4 v4 · ¿La cuenta de esta sede tiene varias sedes?
//
// Decisión de Rafael (27-oct-2026): la tarjeta «Clave de la sede» solo sale en
// cuentas cuyo dueño tiene 2 o más sedes. Con una sola sede la clave no protege
// de nadie y solo deja al equipo tecleándola cada 72 h.
import { prisma } from "@/lib/prisma";
import { estadoDeClave, tablaExiste } from "./estado.server";

/**
 * Sí si algún dueño (SUPER_ADMIN activo) de esta sede es dueño de 2 o más sedes
 * sin archivar. `clinicId` sale SIEMPRE de la sesión. Dos consultas, en serie.
 */
export async function cuentaConVariasSedes(clinicId: string): Promise<boolean> {
  if (!clinicId) return false;
  const duenos = await prisma.user.findMany({
    where: { clinicId, role: "SUPER_ADMIN", isActive: true },
    select: { supabaseId: true },
  });
  const ids = Array.from(new Set(duenos.map((d) => d.supabaseId).filter(Boolean)));
  if (ids.length === 0) return false;
  const sedes = await prisma.clinic.count({
    where: { archivedAt: null, users: { some: { supabaseId: { in: ids }, role: "SUPER_ADMIN", isActive: true } } },
  });
  return sedes >= 2;
}

/**
 * v5 (Rafael, 27-oct): ¿Equipo → Permisos enseña «Crear y cambiar la clave de la
 * sede»? Lo mismo que la tarjeta: con el SQL pegado, y si la cuenta tiene 2+
 * sedes o esta sede ya tiene la clave puesta. Ante un fallo de la base no se
 * enseña: el modal conserva igual lo que la persona ya tuviera guardado.
 */
export async function permisoDeClaveVisible(clinicId: string): Promise<boolean> {
  if (!clinicId) return false;
  try {
    if (!(await tablaExiste())) return false;
    if (await cuentaConVariasSedes(clinicId)) return true;
    return (await estadoDeClave(clinicId)).activa;
  } catch {
    return false;
  }
}
