import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Permiso granular: mover la ortesis de etapa (evaluación → molde →
  // laboratorio → entregado…) es avanzar el tratamiento del paciente, lo mismo
  // que cubre "treatments.edit" ("Crear y editar planes de tratamiento (y
  // registrar sesiones)"). Se elige esa key y no medicalRecord.edit para no
  // dejar fuera a recepción, que es quien registra la vuelta del laboratorio y
  // la entrega: lo que cierra es la escritura de un READONLY, que es el hallazgo.
  const deniedPerm = denyIfMissingPermission(ctx, "treatments.edit");
  if (deniedPerm) return deniedPerm;

  const record = await prisma.formulaRecord.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId, type: "orthotics_pipeline" },
  });
  if (!record) return NextResponse.json({ error: "Orthotics record not found" }, { status: 404 });

  // Visibilidad por paciente: el GET y el POST de este mismo módulo ya la
  // exigen; este PATCH era el único que escribía sobre el registro de un
  // paciente restringido sin comprobar que el usuario pueda verlo.
  const hidden = await assertPatientVisible(record.patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const body = await req.json();
  const currentFormula = record.formula as Record<string, any>;

  const updatedFormula = {
    ...currentFormula,
    ...(body.status !== undefined && { status: body.status }),
    ...(body.notes !== undefined && { notes: body.notes }),
    ...(body.orthoticType !== undefined && { orthoticType: body.orthoticType }),
  };

  const updated = await prisma.formulaRecord.update({
    where: { id: params.id },
    data: { formula: updatedFormula },
  });

  return NextResponse.json(updated);
}
