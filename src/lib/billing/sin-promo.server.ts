import "server-only";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { isPlanId, type PlanId } from "@/lib/billing/plans";

// La marca del enlace de contratación (lib/billing/contratar.ts), del lado del servidor
// y SIN SQL nuevo: una fila de la bitácora de la clínica (audit_logs), escrita al darse de
// alta por /contratar/<plan>. Dice el plan del enlace y que va sin la promo del primer mes.
// Se ve en Movimientos y nunca se borra. La leen la pantalla de pago y el checkout, que en
// la PRIMERA contratación cobran ese plan, mensual, con tarjeta y a precio de lista + IVA.

export const CAMBIO_SIN_PROMO = "promoPrimerMes";
export const CAMBIO_PLAN_DEL_ENLACE = "planDelEnlace";

export async function marcarEnlaceDeContratacion(a: {
  clinicId: string;
  userId: string;
  plan: PlanId;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  await logAudit({
    clinicId: a.clinicId,
    userId: a.userId,
    entityType: "clinic",
    entityId: a.clinicId,
    action: "update",
    changes: {
      [CAMBIO_SIN_PROMO]: { before: "sí", after: "no" },
      [CAMBIO_PLAN_DEL_ENLACE]: { before: null, after: a.plan },
    },
    texto: "Alta por enlace de contratación: ese plan, mensual con tarjeta, a precio de lista desde el primer mes (sin la promo)",
    ipAddress: a.ipAddress,
    userAgent: a.userAgent,
  });
}

/**
 * El enlace por el que llegó la clínica, o null si no llegó por uno. Si la consulta falla,
 * null (se comporta como siempre: no se cae el pago de todas las altas por esta lectura).
 */
export async function enlaceDeContratacion(clinicId: string | null | undefined): Promise<{ plan: PlanId } | null> {
  if (!clinicId) return null;
  try {
    const fila = await prisma.auditLog.findFirst({
      where: {
        clinicId,
        entityType: "clinic",
        entityId: clinicId,
        action: "update",
        changes: { path: [CAMBIO_SIN_PROMO, "after"], equals: "no" },
      },
      orderBy: { createdAt: "asc" },
      select: { changes: true },
    });
    if (!fila) return null;
    const plan = (fila.changes as any)?.[CAMBIO_PLAN_DEL_ENLACE]?.after;
    return isPlanId(plan) ? { plan } : null;
  } catch (e) {
    console.error("[enlace-contratacion] no se pudo leer la marca:", e);
    return null;
  }
}
