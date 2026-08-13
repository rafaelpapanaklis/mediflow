// DELETE /api/consent/[id] — borrado LÓGICO de un consentimiento pendiente.
//
// LA REGLA DURA DEL MÓDULO: un consentimiento FIRMADO no se borra ni se edita
// jamás. La NOM-004-SSA3-2012 (numeral 5.11) obliga a conservar el expediente
// al menos cinco años, y una carta firmada es la prueba de que el paciente
// aceptó el procedimiento — es justo lo que habría que destruir para tapar una
// mala praxis. Por eso el intento responde 409 con el motivo, no 403 genérico.
//
// Lo que sí se puede tirar es un pendiente que nunca se firmó: un borrador con
// el procedimiento equivocado. Y aun así se marca `deletedAt` en vez de
// borrarse: la fila sigue ahí para la auditoría.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logMutation } from "@/lib/audit";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 20);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "consents.revoke");
  if (denied) return denied;

  const form = await prisma.consentForm.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true, procedure: true, signedAt: true, revokedAt: true },
  });
  if (!form) return NextResponse.json({ error: "Consentimiento no encontrado" }, { status: 404 });

  const hidden = await assertPatientVisible(form.patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  if (form.signedAt) {
    return NextResponse.json(
      {
        error:
          "Un consentimiento firmado no se puede eliminar: forma parte del expediente y debe " +
          "conservarse. Si el paciente cambió de opinión, usa Revocar.",
      },
      { status: 409 },
    );
  }

  // La condición se repite en el where de la escritura para que no exista un
  // hueco entre comprobar "no está firmado" y marcar el borrado.
  const res = await prisma.consentForm.updateMany({
    where: { id: form.id, clinicId: ctx.clinicId, deletedAt: null, signedAt: null },
    data: { deletedAt: new Date() },
  });
  if (res.count === 0) {
    return NextResponse.json(
      { error: "El consentimiento cambió de estado. Vuelve a cargar la lista." },
      { status: 409 },
    );
  }

  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "consent",
    entityId: form.id,
    action: "soft_delete",
    before: { patientId: form.patientId, procedure: form.procedure, signedAt: null },
  });

  return NextResponse.json({ ok: true });
}
