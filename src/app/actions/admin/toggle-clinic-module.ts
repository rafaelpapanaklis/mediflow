"use server";

/**
 * Server action — toggle de módulos del marketplace por clínica desde el
 * panel /admin/clinics/[id]. Wrapper de Prisma + Next sobre el core puro
 * en ./toggle-clinic-module-core.ts.
 *
 * Diseño aprobado (Caso C):
 *  - NO se agrega un campo paralelo `Clinic.modules`. Se usa la tabla
 *    `ClinicModule` existente (sistema marketplace de Sprint 1).
 *  - Activar = upsert con status='active', paymentMethod='admin',
 *    pricePaidMxn=0, currentPeriodEnd=2099-12-31. Si la clínica luego
 *    compra el módulo, el upsert real (con stripeSubscriptionId)
 *    reemplaza este "admin grant".
 *  - Desactivar = update a status='cancelled' + cancelledAt=now (NO
 *    delete — preservamos historia y FKs como stripeSubscriptionId).
 *  - Auth = isAdminAuthed() (admin_token cookie + ADMIN_SECRET_TOKEN
 *    env). Mismo patrón que /api/admin/clinics/[id]/route.ts.
 *  - Audit = console.log JSON estructurado a Vercel Logs (los SUPER_ADMIN
 *    no tienen User row, mismo patrón que DELETE /api/admin/clinics/[id]).
 *
 * Reportes financieros que sumen ingreso del marketplace deben filtrar
 * `paymentMethod != 'admin'` para excluir grants administrativos.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  ADMIN_GRANT_BILLING_CYCLE,
  ADMIN_GRANT_PAYMENT_METHOD,
  ADMIN_GRANT_PERIOD_END,
  toggleClinicModuleCore,
  type ToggleAuditEntry,
  type ToggleClinicModuleInput,
  type ToggleClinicModuleResult,
} from "./toggle-clinic-module-core";

export type { ToggleClinicModuleInput, ToggleClinicModuleResult };

function isAdminAuthed(): boolean {
  const token = cookies().get("admin_token")?.value;
  const expected = process.env.ADMIN_SECRET_TOKEN;
  return !!token && !!expected && token === expected;
}

export async function toggleClinicModule(
  input: ToggleClinicModuleInput,
): Promise<ToggleClinicModuleResult> {
  return toggleClinicModuleCore(input, {
    isAuthed: isAdminAuthed,
    findClinic: (id) =>
      prisma.clinic.findUnique({ where: { id }, select: { id: true } }),
    findModule: (key) =>
      prisma.module.findUnique({
        where:  { key },
        select: { id: true, key: true, isActive: true },
      }),
    findExistingClinicModule: async (clinicId, moduleId) => {
      const cm = await prisma.clinicModule.findUnique({
        where:  { clinicId_moduleId: { clinicId, moduleId } },
        select: { id: true, status: true, paymentMethod: true },
      });
      return cm ?? null;
    },
    upsertActive: async ({ clinicId, moduleId, now }) => {
      await prisma.clinicModule.upsert({
        where: { clinicId_moduleId: { clinicId, moduleId } },
        create: {
          clinicId,
          moduleId,
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
    },
    cancel: async ({ clinicModuleId, now }) => {
      await prisma.clinicModule.update({
        where: { id: clinicModuleId },
        data:  { status: "cancelled", cancelledAt: now },
      });
    },
    log: (entry: ToggleAuditEntry) => {
      console.log(JSON.stringify(entry));
    },
    revalidate: (path: string) => {
      revalidatePath(path);
    },
    now: () => new Date(),
  });
}
