import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
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
 * Acceso: solo ADMIN/RECEPCIONISTA (SUPER_ADMIN incluido) y, además, la misma
 * llave que crear una cita a mano: "agenda.create". Importar citas ES crearlas:
 * quien tiene ese permiso quitado en Equipo → Permisos no puede saltárselo por aquí.
 *
 * Las citas PASADAS no se importan, y ninguna cita importada dispara un
 * recordatorio atrasado (ver entities.ts).
 */
export async function POST(req: NextRequest) {
  // 6/min por IP y ruta: el asistente hace vista previa + (si el usuario
  // corrige el mapeo) otra vista previa + importar, por entidad. Con 3 un solo
  // ajuste de columnas dejaba el «Importar» en 429.
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
    const result = await runImport(appointmentsHandler, {
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
