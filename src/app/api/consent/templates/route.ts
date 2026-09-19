// GET /api/consent/templates — las plantillas que ofrece «Nuevo consentimiento
// informado»: SOLO las de kind CONSENTIMIENTO de la clínica de la sesión.
//
// La primera vez que una clínica entra se le siembra el catálogo (idempotente,
// ver lib/consent/seed-templates). Multi-tenant: clinicId SIEMPRE de la sesión.

import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { listClinicConsentTemplates } from "@/lib/consent/clinic-templates";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, 60);
  if (limited) return limited;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "consents.create");
  if (denied) return denied;

  return NextResponse.json(await listClinicConsentTemplates(ctx.clinicId));
}
