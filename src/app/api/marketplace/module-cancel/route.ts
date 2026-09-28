import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { canPurchaseModules, canRequestModuleCancellation } from "@/lib/marketplace/module-purchase-core";
import { logAudit, extractAuditMeta } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ moduleKey: z.string().min(1) });

/**
 * POST /api/marketplace/module-cancel
 *
 * Programa la cancelación del módulo al FIN del periodo ya pagado
 * (`cancel_at_period_end`, mismo patrón que src/app/api/barber/billing/cancel).
 * El módulo sigue activo (el caso clínico, los pacientes, todo) hasta esa
 * fecha; al llegar, Stripe manda `customer.subscription.deleted` y el
 * webhook (src/app/api/webhooks/stripe/route.ts) recién ahí marca
 * `clinic_modules.status = 'cancelled'`. Esta ruta NUNCA borra ni toca
 * ningún dato del módulo — solo le pide a Stripe que no vuelva a cobrar.
 *
 * Un módulo activado por soporte ("admin", ej. Rafael Clínica) o pagado
 * con SPEI/OXXO (pago único, sin suscripción) no tiene nada que cancelar
 * aquí — `canRequestModuleCancellation` lo rechaza con un mensaje claro.
 *
 * Solo dueño o administrador (`canPurchaseModules`, misma regla que el
 * checkout) — cancelar un cobro recurrente compromete a la clínica igual
 * que contratarlo. La pantalla ya esconde el botón a los demás roles; esto
 * es la comprobación real, en el servidor.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  if (!canPurchaseModules(user.role)) {
    return NextResponse.json(
      { error: "Solo el dueño o un administrador de la clínica puede cancelar módulos. Pídeselo a tu administrador.", code: "solo_administrador" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const mod = await prisma.module.findUnique({ where: { key: parsed.data.moduleKey } });
  if (!mod) return NextResponse.json({ error: "Módulo no encontrado" }, { status: 404 });

  const cm = await prisma.clinicModule.findUnique({
    where: { clinicId_moduleId: { clinicId, moduleId: mod.id } },
    select: { paymentMethod: true, stripeSubscriptionId: true, status: true },
  });

  const check = canRequestModuleCancellation(cm);
  if (check.ok === false) return NextResponse.json({ error: check.error }, { status: 400 });

  const stripe = getStripeSafe();
  if (!stripe) return NextResponse.json(stripeUnavailableResponse(), { status: 503 });

  await stripe.subscriptions.update(check.stripeSubscriptionId, { cancel_at_period_end: true });

  const { ipAddress, userAgent } = extractAuditMeta(req);
  await logAudit({
    clinicId,
    userId: user.id,
    entityType: "subscription",
    entityId: check.stripeSubscriptionId,
    action: "update",
    changes: {
      _source: {
        before: null,
        after: { moduleKey: mod.key, action: "cancel_at_period_end", stripeSubscriptionId: check.stripeSubscriptionId },
      },
    },
    ipAddress,
    userAgent,
  });

  return NextResponse.json({ ok: true, message: "El módulo se cancelará al final del periodo ya pagado." });
}
