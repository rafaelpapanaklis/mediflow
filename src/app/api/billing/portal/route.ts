import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { logAudit, extractAuditMeta } from "@/lib/audit";
import { isClinicBillingAdmin, notClinicBillingAdminResponse } from "@/lib/billing/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/portal
 *
 * Crea una sesión del Stripe Customer Portal para que el usuario
 * gestione su método de pago, vea facturas y cancele desde el UI
 * hosted de Stripe. Requiere que la clínica ya tenga `stripeCustomerId`
 * (se crea en el primer checkout).
 *
 * Multi-tenant: clinicId del ctx.
 *
 * Solo dueño/admin: la sesión del portal permite CANCELAR la suscripción,
 * cambiar la tarjeta y ver el historial de facturas con importes. Sin este
 * check, cualquier usuario logueado de la clínica (recepción, doctor, un rol de
 * solo lectura) podía abrirlo con un fetch a mano — el botón está oculto para
 * ellos, pero eso es autorización de UI, no de API. Mismo criterio que
 * change-plan y que `/api/clinic/subscription/cancel-request`, que ya exigía
 * admin para cancelar desde NUESTRA interfaz.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  if (!isClinicBillingAdmin(user.role)) {
    return NextResponse.json(notClinicBillingAdminResponse(), { status: 403 });
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, stripeCustomerId: true },
  });
  if (!clinic) {
    return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });
  }

  if (!clinic.stripeCustomerId) {
    return NextResponse.json(
      {
        error: "no_payment_method",
        message: "Aún no hay método de pago configurado. Configura uno primero.",
      },
      { status: 400 },
    );
  }

  const stripe = getStripeSafe();
  if (!stripe) {
    return NextResponse.json(stripeUnavailableResponse(), { status: 503 });
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    new URL(req.url).origin;

  const session = await stripe.billingPortal.sessions.create({
    customer: clinic.stripeCustomerId,
    return_url: `${baseUrl}/dashboard/settings?tab=subscription`,
  });

  const { ipAddress, userAgent } = extractAuditMeta(req);
  await logAudit({
    clinicId: clinic.id,
    userId: user.id,
    entityType: "subscription",
    entityId: clinic.stripeCustomerId,
    action: "view",
    changes: {
      _source: { before: null, after: { event: "open-customer-portal" } },
    },
    ipAddress,
    userAgent,
  });

  return NextResponse.json({ url: session.url });
}
