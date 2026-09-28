import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { rateLimit } from "@/lib/rate-limit";
import { parseImportForm, runImport, importErrorResponse } from "@/lib/import/engine";
import { doctorsHandler } from "@/lib/import/doctores/handler";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/doctors — importa DOCTORES/PROFESIONALES migrados
 * ("10_Usuarios_Profesionales" de Dentalink y equivalentes). Cada fila crea
 * o empareja un usuario DOCTOR real (cuenta de Supabase Auth con contraseña
 * temporal), SIN mandar invitación ni correo — ver
 * src/lib/import/doctores/handler.ts. Con esto, las citas y los bloqueos que
 * se importen después ya tienen un doctorId real al que ligarse.
 *
 * Multi-tenant: clinicId SIEMPRE de la sesión. Acceso: ADMIN + "team.edit"
 * (mismo candado que dar de alta un miembro de equipo, src/app/api/team/route.ts).
 * Solo ADMIN (no RECEPTIONIST): crear cuentas de acceso es una decisión de
 * administración, igual que en /api/team.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 6, 60_000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roleGate = requireRole(ctx, "ADMIN");
  if (roleGate) return roleGate;
  const deniedPerm = denyIfMissingPermission(ctx, "team.edit");
  if (deniedPerm) return deniedPerm;

  try {
    const form = await parseImportForm(req);
    const result = await runImport(doctorsHandler, {
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
