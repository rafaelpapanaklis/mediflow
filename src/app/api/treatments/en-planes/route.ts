import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { esIdDeLaBase, MENSAJE_ID_INVALIDO } from "@/lib/validation/id";
import { filasEnPlanesDelPaciente } from "@/lib/treatments/ya-en-planes.server";

export const dynamic = "force-dynamic";

/**
 * GET /api/treatments/en-planes?patientId= — SOLO LECTURA (ws1-t6 v3, MAYOR-B): lo que el paciente
 * ya tiene en sus planes de tratamiento, de TODOS los doctores, para que «Nuevo plan» no vuelva a
 * ofrecer lo marcado en rojo que ya está en otro plan («ya en el plan X»).
 *
 * Solo lo mínimo, por fila: tipo de procedimiento, dientes, nombre del plan y estado (y cuándo se
 * hizo). Sin precios, sin notas, sin el doctor. Las reglas de qué cuenta: `ya-en-planes.ts`.
 *
 * Permisos: `treatments.view` (el de abrir la ventana del plan) + paciente de la clínica de la
 * sesión y visible para quien pregunta. Decisión del 28-oct: cualquier doctor ve los planes de otros
 * (por eso aquí no se filtra por doctor, a diferencia de `GET /api/treatments`).
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.clinicId) return NextResponse.json({ filas: [] });
  const denied = denyIfMissingPermission(ctx, "treatments.view");
  if (denied) return denied;

  const patientId = new URL(req.url).searchParams.get("patientId") ?? "";
  if (!patientId || !esIdDeLaBase(patientId)) return NextResponse.json({ error: MENSAJE_ID_INVALIDO }, { status: 400 });
  const paciente = await prisma.patient.findFirst({ where: { id: patientId, clinicId: ctx.clinicId }, select: { id: true } });
  if (!paciente) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  const oculto = await assertPatientVisible(paciente.id, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (oculto) return oculto;

  const { filas } = await filasEnPlanesDelPaciente(ctx.clinicId, paciente.id);
  return NextResponse.json({ filas });
}
