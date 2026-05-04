import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { logAudit, extractAuditMeta } from "@/lib/audit";

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
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

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
