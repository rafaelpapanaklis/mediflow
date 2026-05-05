// Implants — helpers internos para server actions. Auth + tenant +
// module gating + audit + loaders. Spec §5.
//
// IMPORTANTE: este archivo NO va en el barrel index.ts. El barrel
// SOLO reexporta archivos cuyo primer línea sea 'use server' (regla
// aprendida en Periodoncia: reexportar _helpers arrastra
// supabase/server + next/headers al bundle del cliente y rompe el
// build de Next.js).
//
// Cada server action lo importa directamente:
//   import { getImplantActionContext, ... } from "./_helpers";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { AuthContext } from "@/lib/auth-context";
import { getAuthContext } from "@/lib/auth-context";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { IMPLANTS_MODULE_KEY } from "@/lib/implants/permissions";
import type { ImplantStatus } from "@prisma/client";
import { ok, fail, type ActionResult } from "./result";

/**
 * Resuelve el contexto autenticado y verifica:
 *   1. Usuario logueado (getAuthContext).
 *   2. Categoría DENTAL (los otros sectores no aplican).
 *   3. Clínica con módulo `implants` activo (canAccessModule).
 */
export async function getImplantActionContext(): Promise<
  ActionResult<{ ctx: AuthContext }>
> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  if (ctx.clinicCategory !== "DENTAL") {
    return fail("La clínica no soporta el módulo de Implantología");
  }

  const access = await canAccessModule(ctx.clinicId, IMPLANTS_MODULE_KEY);
  if (!access.hasAccess) {
    return fail("Módulo Implantología no activo para esta clínica");
  }

  return ok({ ctx });
}

/**
 * Carga un implante validando que pertenezca al tenant activo. Retorna
 * el snapshot mínimo necesario para `revalidatePath` y para audit
 * before/after.
 */
export async function loadImplantForCtx(args: {
  ctx: AuthContext;
  implantId: string;
}): Promise<
  ActionResult<{
    id: string;
    patientId: string;
    clinicId: string;
    toothFdi: number;
    currentStatus: ImplantStatus;
    brand: string;
    lotNumber: string;
    placedAt: Date;
  }>
> {
  const implant = await prisma.implant.findUnique({
    where: { id: args.implantId },
    select: {
      id: true,
      patientId: true,
      clinicId: true,
      toothFdi: true,
      currentStatus: true,
      brand: true,
      lotNumber: true,
      placedAt: true,
    },
  });
  if (!implant) return fail("Implante no encontrado");
  if (implant.clinicId !== args.ctx.clinicId) {
    return fail("Sin acceso a este implante");
  }
  return ok(implant);
}

/**
 * Verifica que el paciente exista y pertenezca al tenant. Defensivo
 * aunque RLS deny-all lo cubra a nivel DB.
 */
export async function loadPatientForImplant(args: {
  ctx: AuthContext;
  patientId: string;
}): Promise<ActionResult<{ id: string; clinicId: string }>> {
  const patient = await prisma.patient.findUnique({
    where: { id: args.patientId },
    select: { id: true, clinicId: true, deletedAt: true },
  });
  if (!patient || patient.deletedAt) return fail("Paciente no encontrado");
  if (patient.clinicId !== args.ctx.clinicId) {
    return fail("Sin acceso a este paciente");
  }
  return ok({ id: patient.id, clinicId: patient.clinicId });
}

/**
 * Inserta un registro de audit log. Construye un diff compacto si
 * before y after están presentes. Nunca lanza — un fallo de auditoría
 * NO debe romper la mutación clínica (se loguea para debugging).
 */
export async function auditImplant(args: {
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
      const diff: Record<string, { before: unknown; after: unknown }> = {};
      const allKeys = Array.from(
        new Set([...Object.keys(args.before), ...Object.keys(args.after)]),
      );
      for (const key of allKeys) {
        if (["createdAt", "updatedAt", "id"].includes(key)) continue;
        const b = args.before[key];
        const a = args.after[key];
        if (JSON.stringify(b) !== JSON.stringify(a)) {
          diff[key] = { before: b, after: a };
        }
      }
      changes = diff;
    } else if (args.after && !args.before) {
      changes = { _created: { before: null, after: args.after } };
    } else if (args.before && !args.after) {
      changes = { _deleted: { before: args.before, after: null } };
    }

    if (args.meta) {
      changes = { ...(changes ?? {}), _meta: args.meta };
    }

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
    console.error("[implant audit] failed:", e);
  }
}

/** Disparador de revalidación común tras una mutación de implante. */
export function revalidateImplantPaths(args: { patientId: string }): void {
  revalidatePath(`/dashboard/patients/${args.patientId}`);
  revalidatePath(`/dashboard/patients/${args.patientId}/implants`);
  revalidatePath(`/dashboard/specialties/implants`);
  revalidatePath(`/dashboard/specialties/implants/${args.patientId}`);
}
