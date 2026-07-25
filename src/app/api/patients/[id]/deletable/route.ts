import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { patientVisibilityAnd } from "@/lib/patient-visibility";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { getPatientDeleteBlockers } from "@/lib/patient-deletion";

/**
 * GET /api/patients/:id/deletable → `{ deletable, reasons }`.
 *
 * Solo lectura: el modal de eliminar lo llama al abrirse para poder decir de
 * entrada "este paciente tiene 3 facturas, no se puede eliminar" en vez de
 * hacer que el usuario escriba ELIMINAR para recibir un 409 en la cara.
 *
 * NO es la autoridad: la decisión real la vuelve a tomar
 * DELETE ?mode=hard con el mismo precheck, dentro de la request que borra.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Mismo permiso que el borrado: quien no puede borrar tampoco necesita saber
  // qué se lo impediría.
  const denied = denyIfMissingPermission(ctx, "patients.delete");
  if (denied) return denied;

  // Multi-tenant + visibilidad por paciente. Si no lo puede ver, no existe.
  const patient = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId, AND: patientVisibilityAnd(ctx) },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const reasons = await getPatientDeleteBlockers(params.id, ctx.clinicId);
  return NextResponse.json({ deletable: reasons.length === 0, reasons });
}
