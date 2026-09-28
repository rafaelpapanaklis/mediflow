import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { rateLimit } from "@/lib/rate-limit";
import { parseImportForm, runImport, importErrorResponse } from "@/lib/import/engine";
import { procedureCatalogHandler } from "@/lib/import/aranceles/handler";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/procedure-catalog — importa ARANCELES Y PRECIOS (Dentalink
 * "12_Aranceles_Precios" y equivalentes) al catálogo de procedimientos de la
 * clínica (`procedure_catalog`, la MISMA tabla que ya leen facturas,
 * presupuestos y el odontograma — no una tabla "migrada" aparte, porque este
 * dato sí es el que la clínica va a usar en vivo).
 *
 * Mismo candado que crear/editar un procedimiento a mano en /api/procedures
 * (POST): solo "procedures.edit" — sin `requireRole`, porque esa ruta
 * tampoco lo exige (ese permiso ya es ADMIN-only por default en
 * ROLE_DEFAULT_PERMISSIONS, ver src/lib/auth/permissions.ts).
 *
 * Ruta NUEVA: usa el mismo `runImport` del motor (engine.ts, sin tocarlo) con
 * un handler propio (src/lib/import/aranceles/handler.ts) — entities.ts NO se
 * tocó (ws1-t12 lo está cambiando en paralelo). Aún no está en la detección
 * automática de "varios archivos" del asistente: eso es el registro final,
 * pendiente de que esa tarea termine.
 *
 * Multi-tenant: clinicId SIEMPRE de la sesión.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 6, 60_000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const deniedPerm = denyIfMissingPermission(ctx, "procedures.edit");
  if (deniedPerm) return deniedPerm;

  try {
    const form = await parseImportForm(req);
    const result = await runImport(procedureCatalogHandler, {
      file: form.file,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      role: ctx.role,
      dryRun: form.dryRun,
      skipDuplicates: form.skipDuplicates,
      columnMapping: form.columnMapping,
      origin: form.origin,
      valueMapping: form.valueMapping,
      sheet: form.sheet,
    });
    return NextResponse.json(result);
  } catch (e) {
    return importErrorResponse(e);
  }
}
