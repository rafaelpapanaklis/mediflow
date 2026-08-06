import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { rateLimit } from "@/lib/rate-limit";
import { parseImportForm, runImport, importErrorResponse } from "@/lib/import/engine";
import { patientsHandler } from "@/lib/import/entities";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/patients/import — importación masiva de PACIENTES (entity="patients").
 *
 * El motor (parseo seguro, mapeo, dedup, batch insert) vive en src/lib/import.
 * Acepta `columnMapping` opcional (JSON header→campo); si no llega, autodetecta
 * con HEADER_VARIANTS y lo devuelve como `suggestedMapping` en el dry-run.
 *
 * Compatibilidad: la respuesta conserva 100% lo que devolvía antes. El dry-run
 * solo AÑADE `entity`, `columns` y `suggestedMapping`; el commit solo añade
 * `entity` (campos nuevos que el modal viejo ignora).
 *
 * Multi-tenant: clinicId SIEMPRE de la sesión (getAuthContext), nunca del body.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 3, 60_000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Mismo gate que su espejo /api/import/appointments: solo ADMIN/RECEPTIONIST
  // (SUPER_ADMIN pasa por bypass). Antes cualquier sesión importaba en masa.
  const roleGate = requireRole(ctx, "ADMIN", "RECEPTIONIST");
  if (roleGate) return roleGate;
  // Y el permiso granular de crear pacientes (P1-3): importar ES crear.
  const deniedPerm = denyIfMissingPermission(ctx, "patients.create");
  if (deniedPerm) return deniedPerm;

  try {
    const form = await parseImportForm(req);
    const result = await runImport(patientsHandler, {
      file: form.file,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      dryRun: form.dryRun,
      skipDuplicates: form.skipDuplicates,
      columnMapping: form.columnMapping,
    });
    return NextResponse.json(result);
  } catch (e) {
    return importErrorResponse(e);
  }
}
