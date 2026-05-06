"use server";

/**
 * Server action — toggle de módulos del marketplace por clínica desde el
 * panel /admin/clinics/[id]. Diseño aprobado (Caso C):
 *
 *  - NO se agrega un campo paralelo `Clinic.modules`. Se usa la tabla
 *    `ClinicModule` existente (sistema marketplace de Sprint 1).
 *  - Activar = upsert con status='active', paymentMethod='admin',
 *    pricePaidMxn=0, currentPeriodEnd=2099-12-31. Esto convive con Stripe:
 *    si la clínica luego compra el módulo, el upsert real (con
 *    stripeSubscriptionId) reemplaza este "admin grant".
 *  - Desactivar = update a status='cancelled' + cancelledAt=now (NO
 *    delete — preservamos historia y FKs como stripeSubscriptionId).
 *  - Auth admin = isAdminAuthed() (admin_token cookie + ADMIN_SECRET_TOKEN
 *    env). Mismo patrón que /api/admin/clinics/[id]/route.ts.
 *  - Audit = console.log JSON estructurado a Vercel Logs (precedente del
 *    DELETE de /api/admin/clinics/[id], los SUPER_ADMIN no tienen User row
 *    así que no podemos usar prisma.auditLog).
 *
 * Reportes financieros que sumen ingreso del marketplace deben filtrar
 * `paymentMethod != 'admin'` para excluir grants administrativos.
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const ADMIN_GRANT_PAYMENT_METHOD = "admin";
const ADMIN_GRANT_BILLING_CYCLE = "monthly";
// "Forever" para grants admin: el chequeo `currentPeriodEnd > now` en
// canAccessModule no debe expirar por sí solo. 2099-12-31 da margen y
// queda visualmente identificable en DB.
const ADMIN_GRANT_PERIOD_END = new Date("2099-12-31T23:59:59.999Z");

function isAdminAuthed(): boolean {
  const token = cookies().get("admin_token")?.value;
  const expected = process.env.ADMIN_SECRET_TOKEN;
  return !!token && !!expected && token === expected;
}

const inputSchema = z.object({
  clinicId:  z.string().min(1, "clinicId requerido"),
  moduleKey: z.string().min(1, "moduleKey requerido"),
  enabled:   z.boolean(),
});

export type ToggleClinicModuleInput = z.infer<typeof inputSchema>;

export interface ToggleClinicModuleResult {
  ok:             boolean;
  error?:         string;
  /** Estado resultante en ClinicModule.status. */
  status?:        "active" | "cancelled";
  /** paymentMethod tras la operación — útil para badge "admin" en UI. */
  paymentMethod?: string;
}

export async function toggleClinicModule(
  input: ToggleClinicModuleInput,
): Promise<ToggleClinicModuleResult> {
  if (!isAdminAuthed()) {
    return { ok: false, error: "Unauthorized" };
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok:    false,
      error: parsed.error.errors[0]?.message ?? "Datos inválidos",
    };
  }
  const { clinicId, moduleKey, enabled } = parsed.data;

  const clinic = await prisma.clinic.findUnique({
    where:  { id: clinicId },
    select: { id: true },
  });
  if (!clinic) return { ok: false, error: "Clínica no encontrada" };

  const mod = await prisma.module.findUnique({
    where:  { key: moduleKey },
    select: { id: true, key: true, isActive: true },
  });
  if (!mod || !mod.isActive) {
    return { ok: false, error: "Módulo no disponible" };
  }

  const previous = await prisma.clinicModule.findUnique({
    where: {
      clinicId_moduleId: { clinicId, moduleId: mod.id },
    },
    select: { id: true, status: true, paymentMethod: true },
  });

  if (enabled) {
    const now = new Date();
    await prisma.clinicModule.upsert({
      where: {
        clinicId_moduleId: { clinicId, moduleId: mod.id },
      },
      create: {
        clinicId,
        moduleId:           mod.id,
        status:             "active",
        billingCycle:       ADMIN_GRANT_BILLING_CYCLE,
        activatedAt:        now,
        currentPeriodStart: now,
        currentPeriodEnd:   ADMIN_GRANT_PERIOD_END,
        paymentMethod:      ADMIN_GRANT_PAYMENT_METHOD,
        pricePaidMxn:       0,
      },
      update: {
        status:           "active",
        cancelledAt:      null,
        currentPeriodEnd: ADMIN_GRANT_PERIOD_END,
        paymentMethod:    ADMIN_GRANT_PAYMENT_METHOD,
        pricePaidMxn:     0,
      },
    });
  } else {
    if (!previous) {
      return { ok: false, error: "El módulo no está activo en esta clínica" };
    }
    if (previous.status === "cancelled") {
      // Idempotente — ya estaba apagado.
      return { ok: true, status: "cancelled" };
    }
    await prisma.clinicModule.update({
      where: { id: previous.id },
      data:  { status: "cancelled", cancelledAt: new Date() },
    });
  }

  console.log(JSON.stringify({
    type:               "admin.clinic.module.toggled",
    clinicId,
    moduleKey,
    enabled,
    at:                 new Date().toISOString(),
    by:                 "admin",
    previousStatus:     previous?.status ?? null,
    previousPaymentMethod: previous?.paymentMethod ?? null,
  }));

  revalidatePath(`/admin/clinics/${clinicId}`);
  revalidatePath("/dashboard");

  return {
    ok:            true,
    status:        enabled ? "active" : "cancelled",
    paymentMethod: enabled ? ADMIN_GRANT_PAYMENT_METHOD : undefined,
  };
}
