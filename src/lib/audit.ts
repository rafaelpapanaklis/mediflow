import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";
import type { PediatricAuditAction } from "@/lib/pediatrics/audit";

export type AuditAction =
  | "create" | "update" | "delete" | "view"
  // NOM-004/NOM-024 conservación — borrado LÓGICO (no destructivo): anulación de
  // receta, soft-delete de archivo del expediente, archivado de clínica.
  | "void" | "soft_delete" | "archive"
  | "XRAY_NOTES_UPDATED" | "FILE_NOTES_UPDATED"
  // Reset de contraseña por SUPER_ADMIN. NO incluye el password (ni hash)
  // en el log — solo la acción y el target.
  | "password_reset"
  // Acciones de admin de PLATAFORMA (WS2 · cobertura de auditoría): ciclo de
  // vida de entidades globales (afiliados/labs/suppliers) y operaciones de
  // cobro/payout/envío iniciadas desde /admin.
  | "approve" | "reject" | "suspend" | "payout" | "send"
  // Acciones pediátricas (spec §4.B.5). El union se extiende vía
  // PediatricAuditAction para que TypeScript valide los strings al pasarlos
  // a logAudit/logMutation.
  | PediatricAuditAction;

export type AuditEntityType =
  | "patient"
  | "appointment"
  // Bloqueo de agenda (WS1-T2): cerrar un día o unas horas se audita igual
  // que crear o cancelar una cita — es lo que explica un hueco vacío.
  | "agenda-block"
  | "invoice"
  | "record"
  | "consent"
  | "inventory"
  | "treatment"
  | "periodontal"
  | "body-map"
  | "xray-analysis"
  | "ai-consult"
  | "patient-file"
  | "prescription"
  | "user"
  | "clinic"
  | "subscription"
  | "quote"
  | "cash-register"
  // Plataforma / admin (WS2 · cobertura de auditoría en /admin). Tipan tanto las
  // filas clinic-scoped que SÍ entran a AuditLog (p.ej. "admin-billing",
  // "ai-wallet", anclando a la clínica + un usuario suyo) como los eventos
  // GLOBALES sin clínica (p.ej. "ai-pricing", "coupon", "affiliate"), que se
  // registran como evento estructurado en logs vía logAdminGlobalEvent porque
  // AuditLog.clinicId/userId son FK NOT NULL y no admiten una acción sin clínica.
  | "admin-billing"
  | "ai-wallet"
  | "ai-pricing"
  | "ai-recharge"
  | "affiliate"
  | "affiliate-payout"
  | "affiliate-config"
  | "coupon"
  | "announcement"
  | "supplier"
  | "lab"
  | "plan-config"
  | "clinic-note"
  | "review"
  | "clinic-email"
  | "clinic-whatsapp"
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
  // WS2-T3 — atribución: "admin" + actorAdminId cuando la ejecuta un AdminUser
  // de plataforma. Default (undefined) → "staff" (User de clínica) en BD.
  actorType?:    "staff" | "admin";
  actorAdminId?: string;
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
        actorType:    opts.actorType,             // undefined → default 'staff' en BD
        actorAdminId: opts.actorAdminId ?? null,
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
  action: "create" | "update" | "delete" | "void" | "soft_delete" | "archive";
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
  actorType?:    "staff" | "admin";
  actorAdminId?: string;
}): Promise<void> {
  try {
    const { ipAddress, userAgent } = extractAuditMeta(opts.req);
    let changes: Record<string, { before: any; after: any }> | undefined;
    if (opts.action === "update" && opts.before && opts.after) {
      changes = diffObjects(opts.before, opts.after);
      if (Object.keys(changes).length === 0) return; // no-op update, skip log
    } else if (opts.action === "create" && opts.after) {
      changes = { _created: { before: null, after: opts.after } };
    } else if (
      (opts.action === "delete" ||
        opts.action === "void" ||
        opts.action === "soft_delete" ||
        opts.action === "archive") &&
      opts.before
    ) {
      // Borrado lógico/anulación (NOM-004 conservación / NOM-024 §7): preserva el
      // "before" y, si lo hay, el "after" con el motivo.
      changes = { _deleted: { before: opts.before, after: opts.after ?? null } };
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
      // Reenviar la atribución del actor (antes se perdía aquí): sin esto, una
      // mutación ejecutada por un AdminUser quedaba registrada como "staff".
      actorType:    opts.actorType,
      actorAdminId: opts.actorAdminId,
    });
  } catch (e) {
    console.error("logMutation error:", e);
  }
}

// ───────────────────────── Lecturas del expediente ─────────────────────────

/**
 * Qué se leyó. Lista CERRADA a propósito: solo abrir la ficha, imprimir una nota
 * concreta y exportar el expediente. Listas, agenda y buscador NO se registran —
 * multiplicarían las filas por mil y un rastro ilegible es no tener rastro.
 *
 * `expediente_pdf` (WS1-T4) es el expediente clínico COMPLETO en un solo PDF
 * (GET /api/patients/[id]/expediente-pdf). Entra en la lista y no se cuelga de
 * `export_arco` porque no es lo mismo: ARCO es una solicitud del titular que se
 * atiende con un JSON de portabilidad, y esto es una copia clínica impresa que
 * cualquiera con `medicalRecord.export` puede sacar desde la ficha. Si compartieran
 * etiqueta, la bitácora no podría contestar cuál de las dos pasó — y ésta es la
 * lectura más grande que existe en el panel.
 */
export type ReadKind = "ficha" | "nota_pdf" | "export_cda" | "export_arco" | "expediente_pdf";

/**
 * Ventana de dedupe. Aplica SOLO a "ficha": la página se re-renderiza con cada
 * guardado (revalidate/router.refresh) y eso no es volver a abrirla. Un PDF o un
 * export es una copia que sale del sistema: cada uno deja su fila.
 */
export const READ_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
/** Tope de espera del insert: un pooler colgado no cuelga la pantalla. */
export const READ_LOG_TIMEOUT_MS = 1500;
/**
 * Un export es una copia que SALE del sistema y es raro: ahí pesa más que quede
 * constancia que ahorrar un segundo, así que se le da más margen al insert.
 */
export const READ_LOG_EXPORT_TIMEOUT_MS = 5000;
const READ_DEDUPE_MAX_KEYS = 5000;

// En memoria POR INSTANCIA: sin viaje extra a la base para decidir si se escribe.
// Entre instancias (lambdas) no se comparte; lo peor que pasa es una fila de más.
const recentReads = new Map<string, number>();

/** Solo para pruebas. */
export function _resetReadDedupe() {
  recentReads.clear();
}

function seenRecently(key: string, now: number): boolean {
  const last = recentReads.get(key);
  if (last !== undefined && now - last < READ_DEDUPE_WINDOW_MS) return true;
  if (recentReads.size >= READ_DEDUPE_MAX_KEYS) {
    recentReads.forEach((ts, k) => {
      if (now - ts >= READ_DEDUPE_WINDOW_MS) recentReads.delete(k);
    });
    if (recentReads.size >= READ_DEDUPE_MAX_KEYS) recentReads.clear();
  }
  recentReads.set(key, now);
  return false;
}

/**
 * Bitácora de LECTURA del expediente (NOM-004 §5.12 / NOM-024 §6.3.5): quién
 * abrió qué y cuándo. Escribe `action: "view"` con `changes._read`.
 *
 * - El rastro es dato personal: aquí entran SOLO ids (paciente, nota) y el tipo
 *   de lectura. Ni nombre del paciente ni contenido clínico — la firma no deja
 *   pasar un objeto libre.
 * - NUNCA tira y nunca tarda más de READ_LOG_TIMEOUT_MS. Úsalo solapado con otro
 *   trabajo (`const p = logRead(..)` … `await p`), no como un viaje en serie.
 * - Multi-tenant: clinicId/userId siempre de la sesión. Si falta alguno no se
 *   escribe nada.
 */
export async function logRead(opts: {
  clinicId: string;
  userId: string;
  kind: ReadKind;
  patientId: string;
  /** Solo para `nota_pdf`: id de la nota (MedicalRecord). */
  recordId?: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    if (!opts.clinicId || !opts.userId || !opts.patientId) return;
    // entityId SIEMPRE es el paciente: así el filtro «por esta entidad» de la
    // bitácora contesta «quién abrió algo de este paciente» de una vez. El id de
    // la nota, si lo hay, va dentro de `_read`.
    const key = [opts.clinicId, opts.userId, opts.kind, opts.recordId ?? opts.patientId].join(":");
    if (opts.kind === "ficha" && seenRecently(key, Date.now())) return;

    const write = prisma.auditLog
      .create({
        data: {
          clinicId:   opts.clinicId,
          userId:     opts.userId,
          entityType: "patient",
          entityId:   opts.patientId,
          action:     "view",
          changes:    { _read: { before: null, after: { kind: opts.kind, ...(opts.recordId ? { recordId: opts.recordId } : {}) } } },
          ipAddress:  opts.ipAddress ?? null,
          userAgent:  opts.userAgent ?? null,
        },
      })
      .then(() => undefined)
      .catch((e: unknown) => {
        // Si no se escribió, que el siguiente intento no quede tapado por el dedupe.
        recentReads.delete(key);
        console.error("logRead error:", e);
      });
    const limit =
      opts.kind === "export_cda" || opts.kind === "export_arco" || opts.kind === "expediente_pdf"
        ? READ_LOG_EXPORT_TIMEOUT_MS
        : READ_LOG_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), limit);
    });
    try {
      if ((await Promise.race([write, timeout])) === "timeout") {
        // No sabemos si la fila entró. Mejor una fila repetida que una perdida:
        // se suelta la clave para que la siguiente apertura vuelva a intentarlo.
        recentReads.delete(key);
        console.error("logRead timeout:", opts.kind, limit, "ms");
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (e) {
    console.error("logRead error:", e);
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
