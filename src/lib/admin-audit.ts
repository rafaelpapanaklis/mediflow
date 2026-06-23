import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  logAudit,
  diffObjects,
  extractAuditMeta,
  type AuditEntityType,
} from "@/lib/audit";

/**
 * WS2 · Cobertura de auditoría en rutas /admin.
 *
 * Atribución del admin de PLATAFORMA (AdminUser, cookie admin_token). Dos
 * convenciones, según la entidad tenga o no clínica:
 *
 *  1. logAdminClinicMutation — la acción cae sobre una ENTIDAD DE CLÍNICA
 *     (clinicId real: cobro, monedero IA, nota, reseña…). Escribe una fila en
 *     AuditLog (bitácora NOM-024). Como AuditLog.userId es FK NOT NULL a User y
 *     el AdminUser no tiene fila User, se ANCLA a un usuario de la clínica (mismo
 *     patrón que /api/admin/clinics/[id]/users/[userId]/reset-password). La
 *     atribución REAL del admin va en actorType:"admin" + actorAdminId y, además,
 *     en un marcador `_admin` dentro de `changes` (el lector del panel pinta el
 *     nombre del usuario ANCLA, así que el `_admin` deja la verdad visible).
 *
 *  2. logAdminGlobalEvent — la acción es GLOBAL, sin clínica (precios IA, planes,
 *     cupones, anuncios, afiliados, labs, proveedores, payouts, envíos). No se
 *     puede escribir en AuditLog (clinicId/userId son FK NOT NULL), así que se
 *     deja un evento ESTRUCTURADO en logs (Vercel) — mismo patrón ya usado por
 *     /api/admin/plan-config y por el archivado de clínica. Lleva el tag
 *     "ADMIN_AUDIT" para ser greppable, la identidad del admin (id+email), IP/UA
 *     y before/after. Nunca toca BD ni lanza.
 *
 * Ambos helpers son best-effort: cualquier error se traga (la auditoría jamás
 * rompe la operación principal), igual que logAudit/logMutation.
 */

export interface AdminActor {
  id: string;
  email: string;
}

type MutationAction =
  | "create"
  | "update"
  | "delete"
  | "void"
  | "soft_delete"
  | "archive";

/** Marca de atribución de admin embebida en `changes` (visible en el detalle). */
function adminMark(admin: AdminActor) {
  return { _admin: { before: null, after: { id: admin.id, email: admin.email } } };
}

/**
 * Construye el `changes` para logAudit. A diferencia de logMutation, NUNCA
 * descarta un update sin diff: una acción de admin siempre se registra (incluso
 * un "reactivar lo ya activo"), porque lo auditable es QUIÉN la ejecutó.
 */
function buildChanges(
  action: MutationAction,
  before: Record<string, any> | null | undefined,
  after: Record<string, any> | null | undefined,
  admin: AdminActor,
): Record<string, { before: any; after: any }> {
  const mark = adminMark(admin);
  if (action === "update") {
    if (before && after) {
      const d = diffObjects(before, after);
      const base = Object.keys(d).length ? d : { _update: { before, after } };
      return { ...base, ...mark };
    }
    return { _update: { before: before ?? null, after: after ?? null }, ...mark };
  }
  if (action === "create") {
    return { _created: { before: null, after: after ?? null }, ...mark };
  }
  // delete | void | soft_delete | archive — conserva el "before" (NOM-024 §7).
  return { _deleted: { before: before ?? null, after: after ?? null }, ...mark };
}

/**
 * Audita una mutación de admin sobre una entidad de clínica → fila en AuditLog.
 * Resuelve un usuario ancla de la clínica si el caller no lo pasa. Si la clínica
 * no tiene NINGÚN usuario (no hay ancla posible para la FK NOT NULL), degrada a
 * evento estructurado en logs vía logAdminGlobalEvent. No lanza.
 */
export async function logAdminClinicMutation(opts: {
  req: NextRequest;
  admin: AdminActor;
  clinicId: string;
  entityType: AuditEntityType;
  entityId: string;
  action: MutationAction;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
  /** Usuario de la clínica para anclar la FK; si falta, se resuelve aquí. */
  anchorUserId?: string | null;
}): Promise<void> {
  try {
    let anchorUserId = opts.anchorUserId ?? null;
    if (!anchorUserId) {
      const anchor = await prisma.user.findFirst({
        where: { clinicId: opts.clinicId },
        orderBy: { id: "asc" },
        select: { id: true },
      });
      anchorUserId = anchor?.id ?? null;
    }

    if (!anchorUserId) {
      // Sin usuario ancla no se satisface la FK NOT NULL → evento estructurado.
      logAdminGlobalEvent({
        req: opts.req,
        admin: opts.admin,
        entity: opts.entityType,
        entityId: opts.entityId,
        action: opts.action,
        clinicId: opts.clinicId,
        before: opts.before ?? null,
        after: opts.after ?? null,
      });
      return;
    }

    const meta = extractAuditMeta(opts.req);
    await logAudit({
      clinicId: opts.clinicId,
      userId: anchorUserId,
      entityType: opts.entityType,
      entityId: opts.entityId,
      action: opts.action,
      changes: buildChanges(opts.action, opts.before, opts.after, opts.admin),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      actorType: "admin",
      actorAdminId: opts.admin.id,
    });
  } catch (e) {
    console.error("logAdminClinicMutation error:", e);
  }
}

/**
 * Audita una acción GLOBAL de admin (sin clínica) como evento estructurado en
 * logs. Síncrono y best-effort: jamás toca BD ni lanza. El tag "ADMIN_AUDIT" lo
 * hace greppable en Vercel Logs.
 */
export function logAdminGlobalEvent(opts: {
  req: NextRequest;
  admin: AdminActor;
  /** Entidad afectada (tipada o string libre para casos sin tipo dedicado). */
  entity: AuditEntityType | string;
  entityId: string;
  /** create | update | delete | approve | reject | suspend | payout | send … */
  action: string;
  /** Contexto de clínica si lo hay (p.ej. envío dirigido a una clínica). */
  clinicId?: string | null;
  before?: any;
  after?: any;
}): void {
  try {
    const meta = extractAuditMeta(opts.req);
    console.log(
      JSON.stringify({
        tag: "ADMIN_AUDIT",
        type: `admin.${opts.entity}.${opts.action}`,
        at: new Date().toISOString(),
        entity: opts.entity,
        entityId: opts.entityId,
        action: opts.action,
        clinicId: opts.clinicId ?? null,
        adminId: opts.admin.id,
        adminEmail: opts.admin.email,
        ip: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        before: opts.before ?? null,
        after: opts.after ?? null,
      }),
    );
  } catch (e) {
    console.error("logAdminGlobalEvent error:", e);
  }
}
