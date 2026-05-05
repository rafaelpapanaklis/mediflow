import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";
import type { PediatricAuditAction } from "@/lib/pediatrics/audit";

export type AuditAction =
  | "create" | "update" | "delete" | "view"
  | "XRAY_NOTES_UPDATED" | "FILE_NOTES_UPDATED"
  // Reset de contraseña por SUPER_ADMIN. NO incluye el password (ni hash)
  // en el log — solo la acción y el target.
  | "password_reset"
  // Acciones pediátricas (spec §4.B.5). El union se extiende vía
  // PediatricAuditAction para que TypeScript valide los strings al pasarlos
  // a logAudit/logMutation.
  | PediatricAuditAction;

export type AuditEntityType =
  | "patient"
  | "appointment"
  | "invoice"
  | "record"
  | "consent"
  | "inventory"
  | "treatment"
  | "xray-analysis"
  | "patient-file"
  | "prescription"
  | "user"
  | "clinic"
  | "subscription"
  // Pediatrics module entity types (spec §4.B.5)
  | "pediatric-record"
  | "ped-guardian"
  | "ped-behavior"
  | "ped-cambra"
  | "ped-habit"
  | "ped-eruption"
  | "ped-sealant"
  | "ped-fluoride"
  | "ped-maintainer"
  | "ped-endodontic"
  | "ped-consent";

export { PEDIATRIC_AUDIT_ACTIONS, type PediatricAuditAction } from "@/lib/pediatrics/audit";

interface AuditOptions {
  clinicId:   string;
  userId:     string;
  entityType: AuditEntityType;
  entityId:   string;
  action:     AuditAction;
  changes?:   Record<string, { before: any; after: any }>;
  ipAddress?: string;
  userAgent?: string;
}

export async function logAudit(opts: AuditOptions) {
  try {
    await prisma.auditLog.create({
      data: {
        clinicId:   opts.clinicId,
        userId:     opts.userId,
        entityType: opts.entityType,
        entityId:   opts.entityId,
        action:     opts.action,
        changes:    opts.changes ?? null,
        ipAddress:  opts.ipAddress ?? null,
        userAgent:  opts.userAgent ?? null,
      },
    });
  } catch (e) {
    // Never let audit logging crash the main operation
    console.error("Audit log error:", e);
  }
}

/**
 * Extrae IP + userAgent del NextRequest para audit log. IP soportada vía
 * x-forwarded-for (Vercel), x-real-ip (Cloudflare/nginx) o cf-connecting-ip.
 * Devuelve undefined si no encuentra header — es opcional.
 */
export function extractAuditMeta(req: NextRequest): { ipAddress?: string; userAgent?: string } {
  const xff = req.headers.get("x-forwarded-for");
  const ipAddress =
    (xff ? xff.split(",")[0]!.trim() : null) ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    undefined;
  const userAgent = req.headers.get("user-agent") ?? undefined;
  return { ipAddress: ipAddress || undefined, userAgent };
}

/**
 * Helper para reducir boilerplate al instrumentar mutations. Calcula diff
 * entre before/after, extrae IP/userAgent del req, y llama logAudit.
 *
 * Multi-tenant: clinicId siempre viene del context (getCurrentUser /
 * getAuthContext), nunca del request body.
 *
 * NUNCA tira excepciones — los errores de audit se silencian.
 */
export async function logMutation(opts: {
  req: NextRequest;
  clinicId: string;
  userId: string;
  entityType: AuditEntityType;
  entityId: string;
  action: "create" | "update" | "delete";
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
}): Promise<void> {
  try {
    const { ipAddress, userAgent } = extractAuditMeta(opts.req);
    let changes: Record<string, { before: any; after: any }> | undefined;
    if (opts.action === "update" && opts.before && opts.after) {
      changes = diffObjects(opts.before, opts.after);
      if (Object.keys(changes).length === 0) return; // no-op update, skip log
    } else if (opts.action === "create" && opts.after) {
      changes = { _created: { before: null, after: opts.after } };
    } else if (opts.action === "delete" && opts.before) {
      changes = { _deleted: { before: opts.before, after: null } };
    }
    await logAudit({
      clinicId:   opts.clinicId,
      userId:     opts.userId,
      entityType: opts.entityType,
      entityId:   opts.entityId,
      action:     opts.action,
      changes,
      ipAddress,
      userAgent,
    });
  } catch (e) {
    console.error("logMutation error:", e);
  }
}

// Calculate diff between two objects - returns only changed fields
export function diffObjects(before: Record<string, any>, after: Record<string, any>): Record<string, { before: any; after: any }> {
  const changes: Record<string, { before: any; after: any }> = {};
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));

  for (const key of allKeys) {
    // Skip metadata fields
    if (["updatedAt", "createdAt", "id"].includes(key)) continue;
    const b = before[key], a = after[key];
    const bStr = JSON.stringify(b), aStr = JSON.stringify(a);
    if (bStr !== aStr) {
      changes[key] = { before: b, after: a };
    }
  }
  return changes;
}
