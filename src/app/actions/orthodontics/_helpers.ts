// Orthodontics — helpers internos. NUNCA reexportar desde el barrel.
// Tienen imports server-only (auth-context → supabase/server → next/headers)
// que romperían el bundle del cliente. SPEC §1.18.

import { prisma } from "@/lib/prisma";
import { anotarFilaDeModulo } from "@/lib/movimientos-paciente/modulos";
import type { AuthContext } from "@/lib/auth-context";
import { canSeePatient } from "@/lib/patient-visibility";
import { getAuthContext } from "@/lib/auth-context";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { hasPermission, type PermissionKey } from "@/lib/auth/permissions";
import { MENSAJE_SIN_ACCESO_ORTODONCIA, tieneAccesoOrtodoncia } from "@/lib/orthodontics/acceso-doctor";
import { fail, type ActionResult } from "./result";

/**
 * Auth + categoría DENTAL + módulo orthodontics activo. Una sola llamada
 * por server action; resto de la lógica usa el `ctx` retornado.
 */
export async function getOrthoActionContext(
  opts?: { write?: boolean },
): Promise<ActionResult<{ ctx: AuthContext }>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  if (ctx.clinicCategory !== "DENTAL") {
    return fail("La clínica no soporta el módulo de Ortodoncia");
  }

  // Revisión cruzada (Ola 1): esto usaba canAccessModule/evaluateAccess, el
  // atajo que abre TODOS los módulos de especialidad durante el trial de
  // CUALQUIER clínica dental — el mismo bug que A1 ya cerró en el sidebar,
  // el layout del dashboard, la pestaña del paciente y las páginas del
  // módulo. Afectaba a las ~48 server actions que dependen de este archivo.
  const active = await hasActiveOrthodonticsModule(ctx.clinicId);
  if (!active) {
    return fail("Módulo Ortodoncia no activo para esta clínica");
  }
  if (!tieneAccesoOrtodoncia({ role: ctx.role, permissionsOverride: ctx.permissionsOverride })) {
    return fail(MENSAJE_SIN_ACCESO_ORTODONCIA);
  }

  const requiredKey = opts?.write === false ? "medicalRecord.view" : "medicalRecord.edit";
  if (!hasPermission({ role: ctx.role as any, permissionsOverride: ctx.permissionsOverride }, requiredKey)) {
    return fail(`Sin permisos: ${requiredKey}`);
  }

  return { ok: true, data: { ctx } };
}

/**
 * Auth + categoría DENTAL + módulo orthodontics activo, para acciones de
 * DINERO del módulo (cobro de mensualidades, extras, promesas de pago).
 *
 * P1 (Ola 1, ws1-t3): separa la key de "dinero" (`billing.charge`) de la de
 * "clínico" (`medicalRecord.edit`, en `getOrthoActionContext` arriba) — así
 * recepción cobra sin ver el diagnóstico, y el doctor ve/registra sin poder
 * cobrar (salvo que la clínica le dé el permiso desde Equipo → Permisos).
 *
 * ÚNICA fuente de este gate (revisión cruzada): "Cobro" tenía su propio
 * `getCobroActionContext` en `cobro/_ctx.ts` haciendo EXACTAMENTE lo mismo
 * (carrera de 73s entre ambas partes) — ese archivo se quedó solo con
 * `loadCasoParaCobro`/`auditarCobro` y sus 8 actions migraron aquí, por lo
 * que el parámetro es la key EXACTA (no un booleano `write`: Cobro usa
 * cuatro keys distintas — `billing.view`, `billing.create`, `billing.edit`,
 * `billing.charge` — según la action). Las 4 actions legacy de dinero
 * (`recordInstallmentPayment`, `confirmCollect`, `createPaymentPlan`,
 * `recalculatePaymentStatus`) también migraron aquí desde
 * `getOrthoActionContext` (exigían `medicalRecord.edit` para cobrar).
 */
export async function getOrthoBillingActionContext(
  permiso: PermissionKey = "billing.charge",
): Promise<ActionResult<{ ctx: AuthContext }>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  if (ctx.clinicCategory !== "DENTAL") {
    return fail("La clínica no soporta el módulo de Ortodoncia");
  }

  const active = await hasActiveOrthodonticsModule(ctx.clinicId);
  if (!active) {
    return fail("Módulo Ortodoncia no activo para esta clínica");
  }
  if (!tieneAccesoOrtodoncia({ role: ctx.role, permissionsOverride: ctx.permissionsOverride })) {
    return fail(MENSAJE_SIN_ACCESO_ORTODONCIA);
  }

  if (!hasPermission({ role: ctx.role as any, permissionsOverride: ctx.permissionsOverride }, permiso)) {
    return fail(`Sin permisos: ${permiso}`);
  }

  return { ok: true, data: { ctx } };
}

/**
 * Auth + categoría DENTAL + módulo orthodontics activo, para la pantalla
 * "Configuración" del submenú (doctor tratante por defecto, catálogo de
 * tipos de cita, plantillas). Es AJUSTE DE LA CLÍNICA, no dinero ni
 * expediente: usa `settings.*` — el mismo permiso de `/dashboard/settings` —
 * para no colarle a recepción o al doctor un permiso que no tienen por
 * default y que no pidieron (P1/P2).
 */
export async function getOrthoConfigActionContext(
  opts?: { write?: boolean },
): Promise<ActionResult<{ ctx: AuthContext }>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  if (ctx.clinicCategory !== "DENTAL") {
    return fail("La clínica no soporta el módulo de Ortodoncia");
  }

  const active = await hasActiveOrthodonticsModule(ctx.clinicId);
  if (!active) {
    return fail("Módulo Ortodoncia no activo para esta clínica");
  }
  if (!tieneAccesoOrtodoncia({ role: ctx.role, permissionsOverride: ctx.permissionsOverride })) {
    return fail(MENSAJE_SIN_ACCESO_ORTODONCIA);
  }

  const requiredKey = opts?.write === false ? "settings.view" : "settings.edit";
  if (!hasPermission({ role: ctx.role as any, permissionsOverride: ctx.permissionsOverride }, requiredKey)) {
    return fail(`Sin permisos: ${requiredKey}`);
  }

  return { ok: true, data: { ctx } };
}

/**
 * Campos del plan de tratamiento que, SOLOS (sin ningún otro campo clínico
 * en el mismo payload), se pueden tocar con `billing.*` aunque falte
 * `medicalRecord.edit` — A11, hallazgo de la revisión cruzada: recepción
 * tiene `billing.*` pero no `medicalRecord.edit` por default, y asignar o
 * cambiar quién es el responsable del pago es justo su trabajo, no uno
 * clínico. Cualquier otro campo del plan (técnica, costo, status…) en el
 * MISMO payload sigue exigiendo `medicalRecord.edit` completo.
 */
const RESPONSIBLE_GUARDIAN_ONLY_FIELDS: ReadonlySet<string> = new Set([
  "treatmentPlanId",
  "diagnosisId",
  "patientId",
  "responsibleGuardianId",
  "newResponsibleGuardian",
]);

/**
 * Como `getOrthoActionContext`, pero para `createTreatmentPlan`/
 * `updateTreatmentPlan`: si el payload CRUDO (antes de validar con zod, para
 * no depender de qué defaults rellene el schema) solo trae campos de
 * `RESPONSIBLE_GUARDIAN_ONLY_FIELDS`, acepta también `billing.*` en vez de
 * exigir `medicalRecord.edit`. Con cualquier otro campo en el payload, se
 * comporta exactamente igual que `getOrthoActionContext` (solo clínico).
 */
export async function getOrthoPlanActionContext(
  rawInput: unknown,
  opts?: { write?: boolean },
): Promise<ActionResult<{ ctx: AuthContext }>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  if (ctx.clinicCategory !== "DENTAL") {
    return fail("La clínica no soporta el módulo de Ortodoncia");
  }

  const active = await hasActiveOrthodonticsModule(ctx.clinicId);
  if (!active) {
    return fail("Módulo Ortodoncia no activo para esta clínica");
  }
  if (!tieneAccesoOrtodoncia({ role: ctx.role, permissionsOverride: ctx.permissionsOverride })) {
    return fail(MENSAJE_SIN_ACCESO_ORTODONCIA);
  }

  const rawKeys =
    rawInput && typeof rawInput === "object" ? Object.keys(rawInput as Record<string, unknown>) : [];
  const onlyResponsibleGuardian =
    rawKeys.length > 0 && rawKeys.every((k) => RESPONSIBLE_GUARDIAN_ONLY_FIELDS.has(k));

  const perm = { role: ctx.role as any, permissionsOverride: ctx.permissionsOverride };
  const clinicalKey = opts?.write === false ? "medicalRecord.view" : "medicalRecord.edit";
  if (hasPermission(perm, clinicalKey)) return { ok: true, data: { ctx } };

  const billingKey = opts?.write === false ? "billing.view" : "billing.charge";
  if (onlyResponsibleGuardian && hasPermission(perm, billingKey)) {
    return { ok: true, data: { ctx } };
  }

  return fail(`Sin permisos: ${clinicalKey}`);
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
      visibleUserIds: true,
    },
  });
  if (!patient || patient.deletedAt) return fail("Paciente no encontrado");
  if (patient.clinicId !== args.ctx.clinicId) return fail("Sin acceso a este paciente");
  // Visibilidad por paciente: espeja loadPatientForImplant — un paciente
  // restringido no existe para quien no está en su visibleUserIds (mismo mensaje
  // que "no encontrado", sin confirmar existencia). Cierra el bypass de escritura
  // de las actions de ortodoncia sobre un paciente restringido.
  if (!canSeePatient(
    { userId: args.ctx.userId, role: args.ctx.role, clinicId: args.ctx.clinicId },
    patient.visibleUserIds,
  )) {
    return fail("Paciente no encontrado");
  }
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
  /** ws1-t12 — paciente al que pertenece el cambio (movimientos del paciente). */
  patientId?: string | null;
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

    await anotarFilaDeModulo({
      clinicId: args.ctx.clinicId,
      userId: args.ctx.userId,
      entityType: args.entityType,
      entityId: args.entityId,
      action: args.action,
      changes: changes as Record<string, unknown> | null,
      patientId: args.patientId,
    });
  } catch (e) {
    console.error("[ortho audit] failed:", e);
  }
}
