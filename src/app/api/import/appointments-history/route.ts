import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { rateLimit } from "@/lib/rate-limit";
import { parseImportForm, runImport, importErrorResponse } from "@/lib/import/engine";
import { appointmentHistoryHandler } from "@/lib/import/citas-historial/handler";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/appointments-history — importa el HISTORIAL DE CITAS
 * PASADAS migrado ("05b_Citas_Estados_Historico" de Dentalink y
 * equivalentes: atendida/no asistió/cancelada). Cada fila entra como un
 * MigratedVisit de solo lectura: NUNCA crea una fila en `Appointment`, así
 * que no dispara recordatorios ni cobros — ver
 * src/lib/import/citas-historial/handler.ts.
 *
 * Ruta NUEVA y aparte de /api/import/appointments (citas VIVAS): mismo
 * `runImport` del motor, handler propio.
 *
 * Multi-tenant: clinicId SIEMPRE de la sesión. Acceso: ADMIN/RECEPCIONISTA +
 * "agenda.create" (mismo candado que /api/import/appointments: crea
 * historial de agenda del paciente).
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 6, 60_000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roleGate = requireRole(ctx, "ADMIN", "RECEPTIONIST");
  if (roleGate) return roleGate;
  const deniedPerm = denyIfMissingPermission(ctx, "agenda.create");
  if (deniedPerm) return deniedPerm;

  try {
    const form = await parseImportForm(req);
    const result = await runImport(appointmentHistoryHandler, {
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
