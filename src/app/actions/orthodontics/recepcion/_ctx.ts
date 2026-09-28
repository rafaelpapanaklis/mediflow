// Ortodoncia — Recepción (ws1-t5, Ola 1). Contexto propio de ESTE bloque, NO
// `getOrthoActionContext` de `../_helpers.ts` (exclusivo de «Acceso y
// permisos», MAPA DE PARTES en REPORTE-ws1-t1.md): ese exige
// `medicalRecord.edit` para todo, dinero incluido — el hallazgo P1 que le
// toca arreglar a esa parte, no a esta. Este bloque es dinero (cobranza)
// desde el primer archivo, así que pide la key de `billing.*` que
// corresponda — mismo criterio que `../cobro/_ctx.ts` (Cobro), reimplementado
// aquí sin tocar ni reexportar ese archivo (no es mío).
//
// Usa `hasActiveOrthodonticsModule` (src/lib/orthodontics/access.ts, Ola 0),
// NO `canAccessModule`: ese último abre TODOS los módulos del marketplace
// durante el periodo de prueba de la clínica (hallazgo de Ola 0), y colaría
// la cobranza de ortodoncia en cualquier clínica dental en prueba que no la
// tenga contratada.

import type { AuthContext } from "@/lib/auth-context";
import { getAuthContext } from "@/lib/auth-context";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { hasPermission, type PermissionKey } from "@/lib/auth/permissions";
import { fail, type ActionResult } from "../result";

/** Auth + categoría DENTAL + módulo orthodontics REALMENTE activo + permiso de facturación. */
export async function getRecepcionActionContext(
  permiso: PermissionKey,
): Promise<ActionResult<{ ctx: AuthContext }>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  if (ctx.clinicCategory !== "DENTAL") return fail("La clínica no soporta el módulo de Ortodoncia");
  const activo = await hasActiveOrthodonticsModule(ctx.clinicId);
  if (!activo) return fail("Módulo Ortodoncia no activo para esta clínica");
  if (!hasPermission({ role: ctx.role, permissionsOverride: ctx.permissionsOverride }, permiso)) {
    return fail(`Sin permisos: ${permiso}`);
  }
  return { ok: true, data: { ctx } };
}

/** Códigos Prisma de "tabla/columna inexistente" — mismo criterio que cobranza-db.ts (Ola 0). */
export function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}
