// Lo común de las rutas de /api/patient-documents: sesión, permiso y la
// visibilidad por paciente. `clinicId` y `userId` salen SIEMPRE de la sesión.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, type AuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import type { PermissionKey } from "@/lib/auth/permissions";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { rateLimit } from "@/lib/rate-limit";
import type { NotaFallo } from "./service";

// Leer una nota es leer el expediente; escribirla o firmarla es editarlo. No se
// inventa un permiso: son los mismos dos que ya gatean la nota de siempre.
export const VER: PermissionKey = "medicalRecord.view";
export const ESCRIBIR: PermissionKey = "medicalRecord.edit";

export async function entrar(
  req: NextRequest,
  permiso: PermissionKey,
  limite: number,
): Promise<{ ctx: AuthContext } | { res: Response }> {
  const limited = rateLimit(req, limite);
  if (limited) return { res: limited };
  const ctx = await getAuthContext();
  if (!ctx) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const denied = denyIfMissingPermission(ctx, permiso);
  if (denied) return { res: denied };
  return { ctx };
}

/** 404 si el paciente está restringido para quien pregunta. `null` = adelante. */
export function pacienteOculto(ctx: AuthContext, patientId: string): Promise<Response | null> {
  return assertPatientVisible(patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
}

export function respuestaDeFallo(f: NotaFallo): Response {
  return NextResponse.json({ error: f.error, code: f.code }, { status: f.status });
}

export async function leerJson(req: NextRequest): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}
