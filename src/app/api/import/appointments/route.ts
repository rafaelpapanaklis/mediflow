import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { rateLimit } from "@/lib/rate-limit";
import { parseImportForm, runImport, importErrorResponse } from "@/lib/import/engine";
import { appointmentsHandler } from "@/lib/import/entities";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/appointments — importa CITAS (entity="appointments").
 * Resuelve patientId (teléfono/correo/nombre) + doctorId (nombre → User de la
 * clínica), valida fecha/hora, calcula endsAt (default 30 min) y crea la cita con
 * status SCHEDULED. Dedup por (paciente + horario) en archivo y contra DB.
 *
 * Mismo contrato que /api/patients/import (FormData + dry-run/commit).
 *
 * Multi-tenant: clinicId SIEMPRE de la sesión (getAuthContext), nunca del body.
 * TODO(revisar): ¿restringir a ADMIN/RECEPTIONIST? hoy basta sesión válida.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 3, 60_000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const form = await parseImportForm(req);
    const result = await runImport(appointmentsHandler, {
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
