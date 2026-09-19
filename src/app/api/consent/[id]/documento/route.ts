// GET /api/consent/[id]/documento — la carta lista para la HOJA del panel:
// cabecera, texto, firmas (con su imagen), revocación, evidencia y faltantes.
//
// La lista del tab NO trae el texto a propósito (`CONSENT_DTO_SELECT`): son
// varios KB por fila. Se pide aquí, de una en una, cuando alguien abre la carta.
//
// Sale de la misma lectura que el PDF (`loadConsentDocumento`), así que lo que
// se ve, lo que se imprime y lo que se descarga son el mismo documento.

import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { loadConsentDocumento } from "@/lib/consent/consent-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Hasta cuatro firmas que bajar del bucket (4 s cada una como mucho).
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "consents.view");
  if (denied) return denied;
  // `clinicId: undefined` no filtra nada: sin clínica en la sesión no se consulta.
  if (!ctx.clinicId) return NextResponse.json({ error: "Consentimiento no encontrado" }, { status: 404 });

  const form = await prisma.consentForm.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId, deletedAt: null },
    select: { patientId: true },
  });
  if (!form) return NextResponse.json({ error: "Consentimiento no encontrado" }, { status: 404 });

  const hidden = await assertPatientVisible(form.patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (hidden) return hidden;

  const documento = await loadConsentDocumento(params.id, ctx.clinicId);
  if (!documento) return NextResponse.json({ error: "Consentimiento no encontrado" }, { status: 404 });

  return NextResponse.json(documento, {
    headers: { "Cache-Control": "private, no-cache, no-store, must-revalidate" },
  });
}
