/**
 * Lógica pura del toggle de módulos por clínica. Sin Prisma, sin cookies,
 * sin revalidatePath — todo entra por dependencias inyectadas. Esto sigue
 * el mismo patrón que `evaluateAccess` (vive aparte de canAccessModule)
 * para que los tests unitarios no necesiten mocks de Next/Prisma.
 *
 * El wrapper que hace I/O real vive en ./toggle-clinic-module.ts.
 */
import { z } from "zod";

export const ADMIN_GRANT_PAYMENT_METHOD = "admin";
export const ADMIN_GRANT_BILLING_CYCLE  = "monthly";
export const ADMIN_GRANT_PERIOD_END     = new Date("2099-12-31T23:59:59.999Z");

export const toggleInputSchema = z.object({
  clinicId:  z.string().min(1, "clinicId requerido"),
  moduleKey: z.string().min(1, "moduleKey requerido"),
  enabled:   z.boolean(),
});

export type ToggleClinicModuleInput = z.infer<typeof toggleInputSchema>;

export interface ToggleClinicModuleResult {
  ok:             boolean;
  error?:         string;
  status?:        "active" | "cancelled";
  paymentMethod?: string;
}

export interface ExistingClinicModule {
  id:            string;
  status:        string;
  paymentMethod: string;
}

export interface ToggleAuditEntry {
  type:                  "admin.clinic.module.toggled";
  clinicId:              string;
  moduleKey:             string;
  enabled:               boolean;
  at:                    string;
  by:                    "admin";
  previousStatus:        string | null;
  previousPaymentMethod: string | null;
}

export interface UpsertActiveArgs {
  clinicId: string;
  moduleId: string;
  now:      Date;
}

export interface CancelArgs {
  clinicModuleId: string;
  now:            Date;
}

export interface ToggleDeps {
  isAuthed:                 () => boolean;
  findClinic:               (id: string) => Promise<{ id: string } | null>;
  findModule:               (key: string) => Promise<{ id: string; key: string; isActive: boolean } | null>;
  findExistingClinicModule: (clinicId: string, moduleId: string) => Promise<ExistingClinicModule | null>;
  upsertActive:             (args: UpsertActiveArgs) => Promise<void>;
  cancel:                   (args: CancelArgs) => Promise<void>;
  log:                      (entry: ToggleAuditEntry) => void;
  revalidate:               (path: string) => void;
  now:                      () => Date;
}

export async function toggleClinicModuleCore(
  rawInput: unknown,
  deps: ToggleDeps,
): Promise<ToggleClinicModuleResult> {
  if (!deps.isAuthed()) return { ok: false, error: "Unauthorized" };

  const parsed = toggleInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }
  const { clinicId, moduleKey, enabled } = parsed.data;

  const clinic = await deps.findClinic(clinicId);
  if (!clinic) return { ok: false, error: "Clínica no encontrada" };

  const mod = await deps.findModule(moduleKey);
  if (!mod || !mod.isActive) return { ok: false, error: "Módulo no disponible" };

  const previous = await deps.findExistingClinicModule(clinicId, mod.id);

  if (enabled) {
    await deps.upsertActive({ clinicId, moduleId: mod.id, now: deps.now() });
  } else {
    if (!previous) return { ok: false, error: "El módulo no está activo en esta clínica" };
    if (previous.status === "cancelled") {
      // Idempotente — ya estaba apagado, no logueamos ni revalidamos.
      return { ok: true, status: "cancelled" };
    }
    await deps.cancel({ clinicModuleId: previous.id, now: deps.now() });
  }

  deps.log({
    type:                  "admin.clinic.module.toggled",
    clinicId,
    moduleKey,
    enabled,
    at:                    deps.now().toISOString(),
    by:                    "admin",
    previousStatus:        previous?.status ?? null,
    previousPaymentMethod: previous?.paymentMethod ?? null,
  });

  deps.revalidate(`/admin/clinics/${clinicId}`);
  deps.revalidate("/dashboard");

  return {
    ok:            true,
    status:        enabled ? "active" : "cancelled",
    paymentMethod: enabled ? ADMIN_GRANT_PAYMENT_METHOD : undefined,
  };
}
