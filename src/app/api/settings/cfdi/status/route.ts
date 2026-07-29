import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getOrganizationStatus } from "@/lib/facturapi";
import { isFacturapiLive } from "@/lib/facturapi-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/settings/cfdi/status
 *
 * Checklist REAL de la organización fiscal de la clínica en Facturapi: qué le
 * falta para emitir CFDI con validez fiscal (datos fiscales, CSD, Carta
 * Manifiesto, logo). La fuente de verdad es `is_production_ready` /
 * `pending_steps` de la propia organización — no la adivinamos.
 *
 * Admin, aislado por el clinicId de la SESIÓN (nunca del body/query). El único
 * parámetro aceptado es ?refresh=1, que salta el caché en memoria de unos
 * segundos que trae getOrganizationStatus (para el botón "Actualizar").
 *
 * Nunca devuelve secretos: solo booleans y las descripciones que Facturapi ya
 * escribe para mostrarle al usuario.
 */
export async function GET(req: NextRequest) {
  // ?refresh=1 salta el caché y pega a Facturapi con la USER_KEY de la cuenta,
  // que es COMPARTIDA por todas las clínicas: sin límite, alguien machacando
  // "Actualizar" podría quemar el rate limit de la cuenta para todos.
  const rl = rateLimit(req, 30, 60 * 1000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const clinic = await prisma.clinic.findUnique({
    where:  { id: ctx!.clinicId },
    select: { facturApiOrgId: true, facturApiEnabled: true, csdUploaded: true, csdValidUntil: true },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  const live = isFacturapiLive();

  // Sin organización (o sin Facturapi configurado en el servidor) no hay nada que
  // consultar: el primer paso es guardar los datos fiscales.
  if (!clinic.facturApiOrgId || !process.env.FACTURAPI_USER_KEY) {
    return NextResponse.json({
      live,
      configured:        false,
      orgExists:         false,
      isProductionReady: false,
      stepsKnown:        true,
      steps:             { legal: false, certificate: false, manifiesto: false, logo: false },
      pendingSteps:      [],
      csdValidUntil:     clinic.csdValidUntil,
    });
  }

  try {
    const status = await getOrganizationStatus(clinic.facturApiOrgId, {
      refresh: req.nextUrl.searchParams.get("refresh") === "1",
    });
    return NextResponse.json({
      live,
      configured:        true,
      orgExists:         status.exists,
      isProductionReady: status.isProductionReady,
      stepsKnown:        status.stepsKnown,
      steps: {
        legal:       status.hasLegal,
        certificate: status.hasCertificate,
        manifiesto:  status.manifestSigned,
        logo:        status.hasLogo,
      },
      pendingSteps:  status.pendingSteps,
      csdValidUntil: status.certificateExpiresAt ?? clinic.csdValidUntil,
    });
  } catch (err: any) {
    // Facturapi no respondió: no afirmamos nada (mostrar todo en rojo asustaría
    // sin motivo). El panel pinta un estado neutro "no pudimos consultar".
    console.error("CFDI status error:", err);
    return NextResponse.json({
      live,
      configured:        true,
      unavailable:       true,
      orgExists:         true,
      isProductionReady: false,
      steps:             { legal: null, certificate: null, manifiesto: null, logo: null },
      pendingSteps:      [],
      csdValidUntil:     clinic.csdValidUntil,
    });
  }
}
