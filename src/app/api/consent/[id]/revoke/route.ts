// POST /api/consent/[id]/revoke — el paciente retira su consentimiento.
//
// Revocar NO es borrar: el documento firmado se conserva íntegro y encima se
// anota quién registró la revocación, cuándo y por qué. Ese es el punto — la
// carta demuestra que hubo consentimiento hasta esa fecha, y la revocación
// demuestra que dejó de haberlo. Borrarla dejaría a la clínica sin ninguna de
// las dos cosas.
//
// El motivo es OBLIGATORIO: una revocación sin motivo, leída dentro de dos
// años, no le sirve a nadie.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logMutation } from "@/lib/audit";

const MAX_REASON = 500;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "consents.revoke");
  if (denied) return denied;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json(
      { error: "Escribe el motivo de la revocación: queda en el expediente." },
      { status: 400 },
    );
  }

  const form = await prisma.consentForm.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true, procedure: true, signedAt: true, revokedAt: true },
  });
  if (!form) return NextResponse.json({ error: "Consentimiento no encontrado" }, { status: 404 });

  const hidden = await assertPatientVisible(form.patientId, {
    userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  if (!form.signedAt) {
    return NextResponse.json(
      {
        error:
          "Este consentimiento todavía no está firmado, así que no hay nada que revocar. " +
          "Si ya no aplica, elimínalo.",
      },
      { status: 409 },
    );
  }
  if (form.revokedAt) {
    return NextResponse.json({ error: "Este consentimiento ya estaba revocado." }, { status: 409 });
  }

  const now = new Date();
  const res = await prisma.consentForm.updateMany({
    where: { id: form.id, clinicId: ctx.clinicId, deletedAt: null, revokedAt: null, signedAt: { not: null } },
    data: {
      revokedAt: now,
      revokedById: ctx.userId,
      revokedReason: reason.slice(0, MAX_REASON),
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
    action: "void",
    before: {
      patientId: form.patientId,
      procedure: form.procedure,
      signedAt: form.signedAt.toISOString(),
    },
    after: { revokedAt: now.toISOString(), revokedReason: reason.slice(0, MAX_REASON) },
  });

  return NextResponse.json({ ok: true, revokedAt: now.toISOString() });
}
