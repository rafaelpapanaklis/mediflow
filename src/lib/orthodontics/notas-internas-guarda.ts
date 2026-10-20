// Ortodoncia — «Notas internas»: la guarda de las rutas (sesión, clínica dental, llaves, caso del tenant y
// visibilidad del paciente). Parte del módulo SOLO-EQUIPO (NOTAS_INTERNAS_SOLO_EQUIPO, ver ./notas-internas-service).
// `clinicId` y `userId` salen SIEMPRE de la sesión; el cuerpo y la URL solo traen ids que aquí se comprueban.

import "server-only";
import { NextResponse } from "next/server";
import { getAuthContext, type AuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { canViewPatient } from "@/lib/patient-visibility";
import { hasActiveOrthodonticsModule } from "./access";
import {
  MENSAJE_SIN_ACCESO_NOTAS_INTERNAS,
  puedeNotasInternas,
  type ModoNotasInternas,
} from "./notas-internas-acceso";

/** Un id que viaja por URL o cuerpo: texto corto y sin rarezas. Lo demás es «no pedido». */
export function leerIdNotas(valor: unknown): string | null {
  const v = typeof valor === "string" ? valor.trim() : "";
  return v && v.length <= 64 && /^[\w-]+$/.test(v) ? v : null;
}

export function respuestaNotas(codigo: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ code: codigo, ...extra }, { status });
}

export async function guardaNotasInternas(
  modo: ModoNotasInternas,
): Promise<{ ctx: AuthContext; res: null } | { ctx: null; res: NextResponse }> {
  const ctx = await getAuthContext();
  if (!ctx || !ctx.clinicId || !ctx.userId) return { ctx: null, res: respuestaNotas("UNAUTHORIZED", 401, { error: "No autenticado" }) };
  if (ctx.clinicCategory !== "DENTAL") return { ctx: null, res: respuestaNotas("CATEGORIA_NO_VALIDA", 403, { error: "Categoría no válida" }) };
  if (!puedeNotasInternas({ role: ctx.role, permissionsOverride: ctx.permissionsOverride }, modo)) {
    return { ctx: null, res: respuestaNotas("SIN_PERMISO", 403, { error: MENSAJE_SIN_ACCESO_NOTAS_INTERNAS }) };
  }
  // Leer lo ya escrito no pide el módulo vigente (el expediente se conserva en solo lectura); escribir, sí.
  if (modo === "escribir" && !(await hasActiveOrthodonticsModule(ctx.clinicId))) {
    return { ctx: null, res: respuestaNotas("MODULE_REQUIRED", 403, { error: "Módulo de Ortodoncia no contratado" }) };
  }
  return { ctx, res: null };
}

/**
 * El caso (de ESTA clínica) y su paciente, solo si el paciente es visible para quien pregunta
 * (`visibleUserIds`). Si no existe o no se ve: `null` — para quien no lo ve, no existe (404, nunca 403).
 */
export async function casoVisibleDeLaSesion(
  ctx: AuthContext,
  caseId: string,
): Promise<{ caseId: string; patientId: string } | null> {
  if (!ctx.clinicId) return null;
  const caso = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: caseId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true },
  });
  if (!caso) return null;
  const visible = await canViewPatient(caso.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  return visible ? { caseId: caso.id, patientId: caso.patientId } : null;
}

/** ¿Este paciente es visible para la sesión? (para PATCH, donde la nota trae su paciente). */
export async function pacienteVisibleDeLaSesion(ctx: AuthContext, patientId: string): Promise<boolean> {
  if (!ctx.clinicId) return false;
  return canViewPatient(patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
}
