import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { rateLimit } from "@/lib/rate-limit";
import { parseImportForm, runImport, importErrorResponse } from "@/lib/import/engine";
import { blockedHoursHandler } from "@/lib/import/bloqueos-horario/handler";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/blocked-hours — importa BLOQUEOS DE AGENDA migrados
 * ("13_Horas_Bloqueadas" de Dentalink y equivalentes) sobre el modelo
 * `AgendaBlock` que ya existe (sql/agenda-bloqueos.sql). Cada fila pasa por
 * el mismo servicio que un bloqueo hecho a mano (crearBloqueo,
 * src/lib/agenda-bloqueos/service.ts): si choca con una cita ya agendada, NO
 * se crea — ver src/lib/import/bloqueos-horario/handler.ts.
 *
 * Multi-tenant: clinicId SIEMPRE de la sesión. Acceso: ADMIN + "agenda.bloqueos"
 * (mismo candado que Configuración → Horarios y bloqueos; deliberadamente
 * fuera del rol RECEPTIONIST, ver src/lib/auth/permissions.ts).
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 6, 60_000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roleGate = requireRole(ctx, "ADMIN");
  if (roleGate) return roleGate;
  const deniedPerm = denyIfMissingPermission(ctx, "agenda.bloqueos");
  if (deniedPerm) return deniedPerm;

  try {
    const form = await parseImportForm(req);
    const result = await runImport(blockedHoursHandler, {
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
