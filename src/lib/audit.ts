import { prisma } from "@/lib/prisma";

export type AuditAction = "create" | "update" | "delete" | "view" | "XRAY_NOTES_UPDATED";
export type AuditEntityType = "patient" | "appointment" | "invoice" | "record" | "consent" | "inventory" | "treatment" | "xray-analysis";

interface AuditOptions {
  clinicId:   string;
  userId:     string;
  entityType: AuditEntityType;
  entityId:   string;
  action:     AuditAction;
  changes?:   Record<string, { before: any; after: any }>;
  ipAddress?: string;
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
      },
    });
  } catch (e) {
    // Never let audit logging crash the main operation
    console.error("Audit log error:", e);
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
