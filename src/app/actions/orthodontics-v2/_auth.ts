// Auth + permission helpers compartidos por todos los server actions orto v2.
// No es "use server" porque exporta tipos y funciones puras consumidas por los
// archivos de actions.

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import {
  canExecute,
  mapRole,
  type OrthoActionKey,
} from "@/lib/orthodontics-v2/permissions";
import { fail, type Result, type OrthoRole } from "@/lib/orthodontics-v2/types";

export interface OrthoAuthContext {
  userId: string;
  clinicId: string;
  role: OrthoRole;
  aiAssistantEnabled: boolean;
}

export async function getOrthoAuthContext(): Promise<OrthoAuthContext | null> {
  try {
    const user = await getCurrentUser();
    return {
      userId: user.id,
      clinicId: user.clinicId,
      role: mapRole(user.role ?? "doctor"),
      aiAssistantEnabled: Boolean(
        (user as { aiAssistantEnabled?: boolean }).aiAssistantEnabled,
      ),
    };
  } catch {
    return null;
  }
}

/**
 * Verifica que el OrthoCase exista y pertenezca a la clínica del usuario.
 * Devuelve el caso o un fail() listo para retornar.
 */
export async function guardCase(
  ctx: OrthoAuthContext,
  caseId: string,
): Promise<Result<{ id: string; clinicId: string; patientId: string }>> {
  const c = await prisma.orthoCase.findUnique({
    where: { id: caseId },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!c) return fail("not_found", "Caso no encontrado");
  if (c.clinicId !== ctx.clinicId)
    return fail("forbidden", "El caso no pertenece a tu clínica");
  return { ok: true, data: c };
}

/**
 * Combina obtención de contexto + check de permiso. Si falla cualquiera de
 * los dos, devuelve un Result con error tipado.
 */
export async function requirePermission(
  action: OrthoActionKey,
): Promise<Result<OrthoAuthContext>> {
  const ctx = await getOrthoAuthContext();
  if (!ctx) return fail("unauthenticated", "No autenticado");
  if (!canExecute(ctx.role, action))
    return fail("forbidden", `Tu rol no permite: ${action}`);
  return { ok: true, data: ctx };
}
