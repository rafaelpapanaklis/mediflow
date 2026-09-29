import type { NextRequest } from "next/server";
import { extractAuditMeta, logAudit, type AuditAction, type AuditEntityType } from "@/lib/audit";
import type { CategoriaMovimiento } from "./catalogo";

/**
 * EL helper de los movimientos del paciente: una llamada por cada escritura de
 * datos del paciente (perfil, citas, expediente, archivos, dinero, ortodoncia…).
 *
 *   await registrarMovimientoDelPaciente({
 *     clinicId: ctx.clinicId, userId: ctx.userId, patientId: cita.patientId,
 *     entityType: "appointment", entityId: cita.id, action: "create",
 *     texto: "Agendó una cita para el 3 de octubre a las 10:00",
 *     req,
 *   });
 *
 * - Escribe una fila en `audit_logs` (la bitácora NOM-024 que ya existía) con
 *   `patientId`, así «Movimientos» lista todo lo de un paciente con un índice.
 * - `texto` es la frase que se mostrará, en español y SIN datos clínicos (qué se
 *   hizo, no qué contenía). Si falta, se redacta de entidad + acción + campos.
 * - `campos` son los NOMBRES de lo que cambió (nunca valores). `cambios`, si se
 *   pasa, es el diff crudo antes/después para el rastro legal; no se muestra.
 * - NUNCA tira: si el registro falla se anota el error y la acción principal
 *   sigue. Multi-tenant: clinicId/userId salen de la sesión, jamás del cliente;
 *   sin clinicId, userId o patientId no se escribe nada (un `undefined` no debe
 *   crear una fila huérfana que otra clínica pudiera leer).
 * - Úsalo DESPUÉS de que la escritura principal tuvo éxito, y solo una vez por
 *   acción: si la ruta ya llama a `logAudit`/`logMutation`, pásale `patientId` y
 *   `texto` a esa llamada en vez de duplicar la fila.
 */
export interface MovimientoDelPaciente {
  clinicId: string;
  userId: string;
  patientId: string;
  entityType: AuditEntityType | (string & {});
  entityId: string;
  action: AuditAction;
  texto?: string;
  /**
   * Solo cuando la categoría NO sale de `entityType` (p. ej. el odontograma se
   * registra colgado de `entityType: "patient"` pero es del expediente clínico:
   * de esto depende qué ve quien no tiene permiso clínico).
   */
  categoria?: CategoriaMovimiento;
  campos?: readonly string[];
  cambios?: Record<string, { before: unknown; after: unknown }>;
  /** El request, para IP y user-agent. Opcional (server actions no lo tienen). */
  req?: NextRequest | null;
  actorType?: "staff" | "admin";
  actorAdminId?: string;
}

export function armarCambiosDelMovimiento(m: {
  texto?: string;
  categoria?: CategoriaMovimiento;
  campos?: readonly string[];
  cambios?: Record<string, { before: unknown; after: unknown }>;
}): Record<string, { before: unknown; after: unknown }> | undefined {
  const texto = m.texto?.trim();
  const campos = (m.campos ?? []).filter((c) => c && !c.startsWith("_"));
  const conMov = texto || campos.length > 0 || m.categoria;
  if (!conMov && !m.cambios) return undefined;
  return {
    ...(m.cambios ?? {}),
    ...(conMov
      ? {
          _mov: {
            before: null,
            after: {
              ...(texto ? { texto } : {}),
              ...(m.categoria ? { categoria: m.categoria } : {}),
              ...(campos.length > 0 ? { campos: Array.from(campos) } : {}),
            },
          },
        }
      : {}),
  };
}

export async function registrarMovimientoDelPaciente(m: MovimientoDelPaciente): Promise<void> {
  try {
    if (!m.clinicId || !m.userId || !m.patientId || !m.entityId) return;
    const meta = m.req ? extractAuditMeta(m.req) : {};
    await logAudit({
      clinicId: m.clinicId,
      userId: m.userId,
      entityType: m.entityType as AuditEntityType,
      entityId: m.entityId,
      action: m.action,
      patientId: m.patientId,
      changes: armarCambiosDelMovimiento(m),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      actorType: m.actorType,
      actorAdminId: m.actorAdminId,
    });
  } catch (e) {
    console.error("registrarMovimientoDelPaciente error:", e);
  }
}
