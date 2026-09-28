import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { rateLimit } from "@/lib/rate-limit";
import { parseImportForm, runImport, importErrorResponse } from "@/lib/import/engine";
import { orthoCasesHandler } from "@/lib/import/ortho-casos/handler";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/ortho-cases — importa CASOS DE ORTODONCIA migrados
 * ("11_Pacientes_Ortodoncia" de Dentalink y equivalentes). Cada fila entra
 * como un MigratedOrthoCase de solo lectura: NUNCA crea el caso clínico vivo
 * (OrthodonticDiagnosis/OrthodonticTreatmentPlan exigen examen clínico que
 * Dentalink no trae) ni una Invoice nueva (el total es informativo; el saldo
 * ya debería venir del archivo de saldos, /api/import/balances). Solo corre
 * si la clínica tiene el módulo de Ortodoncia activo: si no, la vista previa
 * marca cada fila con el motivo y no se importa nada.
 *
 * Ruta NUEVA y aparte de src/app/api/import/balances/route.ts: usa el mismo
 * `runImport` del motor (engine.ts, sin tocarlo) pero con un handler propio
 * (src/lib/import/ortho-casos/handler.ts) — entities.ts NO se tocó
 * (ws1-t12 lo está cambiando en paralelo). Aún no está en la detección
 * automática de "varios archivos" del asistente: eso es el registro final,
 * pendiente de que esa tarea termine (ver REPORTE-ws1-t1.md).
 *
 * Multi-tenant: clinicId SIEMPRE de la sesión. Acceso: ADMIN/RECEPCIONISTA +
 * "medicalRecord.edit" (mismo permiso con el que se abre un caso de
 * ortodoncia real, ver src/app/actions/orthodontics/_helpers.ts).
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 6, 60_000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roleGate = requireRole(ctx, "ADMIN", "RECEPTIONIST");
  if (roleGate) return roleGate;
  const deniedPerm = denyIfMissingPermission(ctx, "medicalRecord.edit");
  if (deniedPerm) return deniedPerm;

  try {
    const form = await parseImportForm(req);
    const result = await runImport(orthoCasesHandler, {
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
