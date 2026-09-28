import "server-only";
import { prisma } from "@/lib/prisma";
import { ORTHODONTICS_MODULE_KEY } from "@/lib/specialties/keys";

/**
 * ¿Esta clínica tiene el módulo de Ortodoncia REALMENTE contratado (una fila
 * `ClinicModule` activa), SIN el atajo de periodo de prueba que usa el resto
 * del marketplace (`evaluateAccess`, src/lib/marketplace/access-control-core.ts:59-61
 * — en trial abre TODOS los módulos, contratados o no)?
 *
 * Se usa a propósito en vez de `canAccessModule` para el MENÚ y la pestaña
 * nueva de Ortodoncia mientras el núcleo (Ola 0) no está completo: Rafael
 * pidió verlo en su propia clínica de prueba («Rafael Clínica»
 * cmn6soeaw0000t17xgljxc2iq, que YA tiene una fila `ClinicModule` real,
 * `payment_method: "admin"`, vigente hasta 2099) sin que aparezca en el
 * resto de clínicas dentales solo por estar en trial — que es justo lo que
 * pasaría hoy con `canAccessModule`/`evaluateAccess`.
 *
 * Arreglar el atajo de trial en general (para TODO el marketplace, no solo
 * ortodoncia) es trabajo de la parte «Acceso y permisos» (A1, Ola 1) — este
 * archivo no toca `access-control-core.ts` ni `access-control.ts`.
 */
export async function hasActiveOrthodonticsModule(
  clinicId: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!clinicId) return false;
  const cm = await prisma.clinicModule.findFirst({
    where: {
      clinicId,
      status: "active",
      currentPeriodEnd: { gt: now },
      module: { key: ORTHODONTICS_MODULE_KEY },
    },
    select: { id: true },
  });
  return cm !== null;
}

/**
 * Igual criterio que `hasActiveOrthodonticsModule`, pero para VARIAS sedes a
 * la vez — la página de contratar (ws1-t2, ronda 5) lo usa para enseñarle al
 * dueño cuáles de sus OTRAS sedes ya tienen el módulo, sin pagar una consulta
 * por sede. Devuelve el subconjunto de `clinicIds` con el módulo activo Y
 * vigente.
 */
export async function activeOrthodonticsModuleClinicIds(
  clinicIds: string[],
  now: Date = new Date(),
): Promise<Set<string>> {
  const ids = Array.from(new Set(clinicIds.filter((id): id is string => !!id)));
  if (ids.length === 0) return new Set();
  const rows = await prisma.clinicModule.findMany({
    where: {
      clinicId: { in: ids },
      status: "active",
      currentPeriodEnd: { gt: now },
      module: { key: ORTHODONTICS_MODULE_KEY },
    },
    select: { clinicId: true },
  });
  return new Set(rows.map((r) => r.clinicId));
}
