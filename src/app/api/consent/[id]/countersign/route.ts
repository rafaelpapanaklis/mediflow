// POST /api/consent/[id]/countersign — contrafirma del estomatólogo.
//
// La NOM-004-SSA3-2012 numeral 10.1.1 pide en la carta el nombre y la FIRMA del
// médico, no solo la del paciente; la NOM-013-SSA2-2015 numeral 9.6.9 lo repite
// para la consulta estomatológica. Hasta ahora el módulo solo capturaba la del
// paciente, así que el documento quedaba a medias.
//
// Se contrafirma DESPUÉS del paciente y una sola vez: una firma profesional
// puesta antes de que el paciente acepte no acredita nada, y poder repisarla
// convertiría el documento en algo editable.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logMutation } from "@/lib/audit";
import { signaturePath, uploadSignature, validateSignatureDataUrl } from "@/lib/consent/signature";

/** Quién puede estampar la firma del profesional responsable. */
const COUNTERSIGN_ROLES = ["DOCTOR", "ADMIN", "SUPER_ADMIN"];

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "consents.create");
  if (denied) return denied;

  // El permiso no basta: esta firma dice "yo, profesional, me hago responsable
  // del acto". Recepción puede generar y enviar la carta, no firmarla.
  if (!COUNTERSIGN_ROLES.includes(ctx.role)) {
    return NextResponse.json(
      { error: "Solo el doctor responsable puede estampar la firma del doctor en el consentimiento." },
      { status: 403 },
    );
  }

  const form = await prisma.consentForm.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId, deletedAt: null },
    select: {
      id: true, patientId: true, procedure: true,
      signedAt: true, revokedAt: true, doctorId: true, doctorSignedAt: true,
    },
  });
  if (!form) return NextResponse.json({ error: "Consentimiento no encontrado" }, { status: 404 });

  const hidden = await assertPatientVisible(form.patientId, {
    userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  if (!form.signedAt) {
    return NextResponse.json(
      { error: "El paciente todavía no ha firmado. La firma del doctor se estampa después de la suya." },
      { status: 409 },
    );
  }
  if (form.revokedAt) {
    return NextResponse.json(
      { error: "Este consentimiento está revocado y ya no se firma." },
      { status: 409 },
    );
  }
  if (form.doctorSignedAt) {
    return NextResponse.json(
      { error: "Este consentimiento ya tiene la firma del doctor." },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const check = await validateSignatureDataUrl(body.signatureDataUrl);
  if (check.error) {
    return NextResponse.json(
      check.detail ? { error: check.error, detalle: check.detail } : { error: check.error },
      { status: check.status },
    );
  }

  const path = signaturePath(ctx.clinicId, form.id, "doctor");
  const stored = await uploadSignature(path, check.buffer);
  if (!stored) {
    // Aquí sí se falla: a diferencia de la firma del paciente, esto lo puede
    // reintentar la persona que está frente a la pantalla.
    return NextResponse.json(
      { error: "No se pudo guardar la firma. Inténtalo de nuevo." },
      { status: 502 },
    );
  }

  const now = new Date();
  const res = await prisma.consentForm.updateMany({
    // Las mismas condiciones en el where: si otra pestaña contrafirmó mientras
    // tanto, esta escritura no pisa la anterior.
    where: {
      id: form.id, clinicId: ctx.clinicId, deletedAt: null,
      revokedAt: null, doctorSignedAt: null, signedAt: { not: null },
    },
    data: {
      doctorSignedAt: now,
      doctorSignatureUrl: stored,
      // Sin responsable asignado, lo es quien firma: si no, el PDF saldría con
      // una firma sobre una línea sin nombre.
      ...(form.doctorId ? {} : { doctorId: ctx.userId }),
    },
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
    action: "update",
    before: { doctorSignedAt: null },
    after: { doctorSignedAt: now.toISOString(), doctorId: form.doctorId ?? ctx.userId },
  });

  return NextResponse.json({ ok: true, doctorSignedAt: now.toISOString() });
}
