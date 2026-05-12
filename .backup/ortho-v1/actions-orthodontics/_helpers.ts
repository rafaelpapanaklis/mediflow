// Orthodontics — helpers internos. NUNCA reexportar desde el barrel.
// Tienen imports server-only (auth-context → supabase/server → next/headers)
// que romperían el bundle del cliente. SPEC §1.18.

import { prisma } from "@/lib/prisma";
import type { AuthContext } from "@/lib/auth-context";
import { getAuthContext } from "@/lib/auth-context";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { ORTHODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { fail, type ActionResult } from "./result";

/**
 * Auth + categoría DENTAL + módulo orthodontics activo. Una sola llamada
 * por server action; resto de la lógica usa el `ctx` retornado.
 */
export async function getOrthoActionContext(): Promise<
  ActionResult<{ ctx: AuthContext }>
> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  if (ctx.clinicCategory !== "DENTAL") {
    return fail("La clínica no soporta el módulo de Ortodoncia");
  }

  const access = await canAccessModule(ctx.clinicId, ORTHODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    return fail("Módulo Ortodoncia no activo para esta clínica");
  }

  return { ok: true, data: { ctx } };
}

/**
 * Verifica que un paciente exista, no esté borrado y pertenezca al clinicId
 * activo. Defensivo aunque RLS lo cubra.
 */
export async function loadPatientForOrtho(args: {
  ctx: AuthContext;
  patientId: string;
}): Promise<
  ActionResult<{ id: string; clinicId: string; firstName: string; lastName: string; dob: Date | null }>
> {
  const patient = await prisma.patient.findUnique({
    where: { id: args.patientId },
    select: {
      id: true,
      clinicId: true,
      deletedAt: true,
      firstName: true,
      lastName: true,
      dob: true,
    },
  });
  if (!patient || patient.deletedAt) return fail("Paciente no encontrado");
  if (patient.clinicId !== args.ctx.clinicId) return fail("Sin acceso a este paciente");
  return {
    ok: true,
    data: {
      id: patient.id,
      clinicId: patient.clinicId,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dob: patient.dob,
    },
  };
}

/**
 * Inserta un registro de audit log ortodóntico. Nunca lanza — falla en
 * silencio (con log) para no romper la action principal.
 */
export async function auditOrtho(args: {
  ctx: AuthContext;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    let changes: Record<string, unknown> | null = null;
    if (args.before && args.after) {
      changes = {};
      const allKeys = Array.from(
        new Set([...Object.keys(args.before), ...Object.keys(args.after)]),
      );
      for (const key of allKeys) {
        if (["createdAt", "updatedAt", "id"].includes(key)) continue;
        const b = args.before[key];
        const a = args.after[key];
        if (JSON.stringify(b) !== JSON.stringify(a)) {
          changes[key] = { before: b, after: a };
        }
      }
    } else if (args.after && !args.before) {
      changes = { _created: { before: null, after: args.after } };
    } else if (args.before && !args.after) {
      changes = { _deleted: { before: args.before, after: null } };
    }
    if (args.meta) changes = { ...(changes ?? {}), _meta: args.meta };

    await prisma.auditLog.create({
      data: {
        clinicId: args.ctx.clinicId,
        userId: args.ctx.userId,
        entityType: args.entityType,
        entityId: args.entityId,
        action: args.action,
        changes: (changes as object | null) ?? null,
      },
    });
  } catch (e) {
    console.error("[ortho audit] failed:", e);
  }
}
