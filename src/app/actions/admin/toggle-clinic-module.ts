"use server";

/**
 * Server action — toggle de módulos del marketplace por clínica desde el
 * panel /admin/clinics/[id]. Wrapper de Prisma + Stripe + Next sobre el core
 * puro en ./toggle-clinic-module-core.ts (ahí está QUÉ hace cada caso).
 *
 * Diseño aprobado (Caso C):
 *  - NO se agrega un campo paralelo `Clinic.modules`. Se usa la tabla
 *    `ClinicModule` existente (sistema marketplace de Sprint 1).
 *  - Activar = upsert con status='active', paymentMethod='admin',
 *    pricePaidMxn=0, currentPeriodEnd=2099-12-31. Si la clínica luego
 *    compra el módulo, el upsert real (con stripeSubscriptionId)
 *    reemplaza este "admin grant".
 *  - Desactivar una cortesía o un pago único = update a status='cancelled' +
 *    cancelledAt=now (NO delete — preservamos historia y FKs).
 *  - Desactivar uno pagado con tarjeta = baja en Stripe al fin del periodo
 *    (`cancel_at_period_end`); la fila la apaga el webhook cuando Stripe
 *    cierra (decisión del 28-sep-2026). Antes se apagaba la fila y Stripe
 *    seguía cobrando.
 *  - Auth = sesión de admin (cookie admin_token → AdminSession viva +
 *    AdminUser activo). Mismo patrón que /api/admin/clinics/[id]/route.ts.
 *  - Rastro = fila en la bitácora (audit_logs) anclada a un usuario de la
 *    clínica, con actorType "admin" y el admin real en `_admin` — mismo
 *    criterio que logAdminClinicMutation — más el evento estructurado en
 *    logs de siempre. La fila de la baja programada es además lo que le dice
 *    a /admin que esa baja está pedida (no hay columna para eso).
 *
 * Reportes financieros que sumen ingreso del marketplace deben filtrar
 * `paymentMethod != 'admin'` para excluir grants administrativos
 * (lo hace `computeMrrModulos`, @/lib/admin/modulos-core).
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/admin-auth";
import { logAudit } from "@/lib/audit";
import { getStripeSafe } from "@/lib/stripe";
import { suscripcionesConBajaProgramada } from "@/lib/admin/modulos-core";
import { notifyModuleActivated } from "@/lib/marketplace/module-activated-email";
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

function stripeOError() {
  const stripe = getStripeSafe();
  if (!stripe) throw new Error("Stripe no está configurado en este entorno");
  return stripe;
}

export async function toggleClinicModule(
  input: ToggleClinicModuleInput,
): Promise<ToggleClinicModuleResult> {
  // El core espera isAuthed síncrono; precomputamos la sesión (DB-backed) y le
  // pasamos un closure que devuelve el booleano ya resuelto.
  const sesion = await getAdminSession();
  const admin = sesion ? { id: sesion.user.id, email: sesion.user.email } : null;

  return toggleClinicModuleCore(input, {
    isAuthed: () => admin !== null,
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
        select: { id: true, status: true, paymentMethod: true, stripeSubscriptionId: true, currentPeriodEnd: true },
      });
      if (!cm) return null;
      let bajaProgramada = false;
      if (cm.stripeSubscriptionId) {
        try {
          const bitacora = await prisma.auditLog.findMany({
            where: { clinicId, entityType: "subscription", entityId: cm.stripeSubscriptionId },
            orderBy: { createdAt: "desc" },
            take: 50,
            select: { entityId: true, createdAt: true, changes: true },
          });
          bajaProgramada = suscripcionesConBajaProgramada(bitacora).has(cm.stripeSubscriptionId);
        } catch (e) {
          console.error("[admin] no se pudo leer la bitácora de la suscripción:", e);
        }
      }
      return { ...cm, bajaProgramada };
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
    programarBajaStripe: async (stripeSubscriptionId) => {
      await stripeOError().subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: true });
    },
    deshacerBajaStripe: async (stripeSubscriptionId) => {
      await stripeOError().subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: false });
    },
    cancelarStripeYa: async (stripeSubscriptionId) => {
      await stripeOError().subscriptions.cancel(stripeSubscriptionId);
    },
    avisarActivacion: async ({ clinicId, moduleKey, now }) => {
      await notifyModuleActivated({
        clinicId,
        moduleKey,
        origen: "cortesia",
        // Cada cortesía es una activación deliberada: su momento la identifica.
        referencia: `admin:${now.getTime()}`,
      });
    },
    log: async (entry: ToggleAuditEntry) => {
      console.log(JSON.stringify({ ...entry, adminId: admin?.id ?? null, adminEmail: admin?.email ?? null }));
      if (!admin) return;
      try {
        // AuditLog.userId es FK NOT NULL a User y el admin de plataforma no
        // tiene fila User: se ancla a un usuario de la clínica.
        const ancla = await prisma.user.findFirst({
          where: { clinicId: entry.clinicId },
          orderBy: { id: "asc" },
          select: { id: true },
        });
        if (!ancla) return;
        await logAudit({
          clinicId: entry.clinicId,
          userId: ancla.id,
          entityType: "subscription",
          // Con suscripción de Stripe, su id: es la llave con la que /admin
          // sabe después que la baja está pedida.
          entityId: entry.stripeSubscriptionId ?? `modulo:${entry.moduleKey}`,
          action: "update",
          changes: {
            status: { before: entry.previousStatus, after: entry.enabled ? "active" : entry.hasta ? entry.previousStatus : "cancelled" },
            _source: {
              before: null,
              after: {
                moduleKey: entry.moduleKey,
                action: entry.action,
                stripeSubscriptionId: entry.stripeSubscriptionId,
                hasta: entry.hasta,
                por: "admin",
              },
            },
            _admin: { before: null, after: { id: admin.id, email: admin.email } },
          },
          actorType: "admin",
          actorAdminId: admin.id,
        });
      } catch (e) {
        console.error("[admin] no se pudo registrar el cambio de módulo en la bitácora:", e);
      }
    },
    revalidate: (path: string) => {
      revalidatePath(path);
    },
    now: () => new Date(),
  });
}
