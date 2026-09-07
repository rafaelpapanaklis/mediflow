import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Permiso granular: borrar una foto de antes/después es borrar IMAGEN CLÍNICA
  // del paciente, y el catálogo ya fijó de quién es ese borrado —
  // "medicalRecord.edit" cubre borrar notas SOAP, placas y modelos 3D, y dice
  // expresamente que dárselo a "Subir radiografías" se lo regalaría a recepción
  // (permissions.ts, nota de medicalRecord.edit). Mismo criterio aquí: sin esta
  // línea un READONLY destruía evidencia clínica con solo tener sesión.
  const deniedPerm = denyIfMissingPermission(ctx, "medicalRecord.edit");
  if (deniedPerm) return deniedPerm;

  const photo = await prisma.beforeAfterPhoto.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  // Visibilidad por paciente: el GET y el POST hermanos ya la exigen; sin ella,
  // quien no puede ver a un paciente restringido sí podía borrarle las fotos.
  const hidden = await assertPatientVisible(photo.patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  await prisma.beforeAfterPhoto.deleteMany({ where: { id: params.id, clinicId: ctx.clinicId } });

  return NextResponse.json({ success: true });
}
