// POST /api/consent/[id]/renew — regenera la liga de firma de un pendiente.
//
// La liga vive siete días. Vencida, la página pública responde 410 y el
// paciente ve "el enlace ha expirado" — que es correcto, pero hasta ahora la
// única salida era crear otra carta y duplicar el registro. Aquí se emite un
// TOKEN NUEVO con el MISMO contenido: el documento que el paciente va a firmar
// sigue siendo el que el doctor revisó, y la liga vieja deja de funcionar (que
// es justo lo que se quiere si se compartió por error).

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logMutation } from "@/lib/audit";
import { consentPublicUrl, regenerateConsentLink } from "@/lib/consent/link";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 20);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "consents.create");
  if (denied) return denied;

  const form = await prisma.consentForm.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true, signedAt: true, revokedAt: true },
  });
  if (!form) return NextResponse.json({ error: "Consentimiento no encontrado" }, { status: 404 });

  const hidden = await assertPatientVisible(form.patientId, {
    userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  if (form.signedAt) {
    return NextResponse.json(
      { error: "Este consentimiento ya está firmado: no necesita una liga nueva." },
      { status: 409 },
    );
  }
  if (form.revokedAt) {
    return NextResponse.json({ error: "Este consentimiento está revocado." }, { status: 409 });
  }

  const renewed = await regenerateConsentLink(form.id, ctx.clinicId);
  if (!renewed) {
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
    action: "update",
    before: { linkRenewed: false },
    after: { linkRenewed: true, expiresAt: renewed.expiresAt.toISOString() },
  });

  return NextResponse.json({
    ok: true,
    token: renewed.token,
    expiresAt: renewed.expiresAt.toISOString(),
    signUrl: consentPublicUrl(renewed.token, req.nextUrl.origin),
  });
}
