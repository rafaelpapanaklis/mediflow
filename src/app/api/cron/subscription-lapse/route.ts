import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  MANUAL_LAPSE_STATUS,
  manualLapseWhere,
  shouldLapseManualSubscription,
} from "@/lib/billing/manual-subscription-lapse";

export const dynamic = "force-dynamic";
// Plan Vercel Pro. El barrido es una lectura indexable y un updateMany, así que
// en la práctica tarda segundos; los 300 s son para que no se corte si algún día
// hay muchas clínicas y la BD está fría.
export const maxDuration = 300;

/**
 * SUB-01 · Cron diario — devuelve a "past_due" al pagador MANUAL cuyo periodo ya
 * venció.
 *
 * El criterio, el estado destino y —muy importante— la razón por la que las
 * SEDES quedan fuera viven en @/lib/billing/manual-subscription-lapse. Leer ese
 * archivo antes de tocar el filtro de aquí.
 *
 * Resumen: quien paga con SPEI/OXXO no tiene suscripción de Stripe. Nadie
 * renueva y nadie avisa, pero `subscriptionStatus` se quedaba en "active" para
 * siempre y `isPlanExpired` da por viva cualquier clínica "active" mire la fecha
 * que mire. Un pago único = acceso indefinido, e invisible además para
 * /admin/payments, que lista las morosas con `{ not: "active" }`.
 *
 * Las clínicas de TARJETA no se tocan nunca: renuevan solas y Stripe ya manda
 * invoice.payment_failed / customer.subscription.deleted.
 *
 * IDEMPOTENTE. Lo que ya está en past_due no vuelve a entrar (el filtro exige
 * "active"), así que puede correr mil veces sin efecto acumulado. El `where` del
 * updateMany repite las condiciones de la lectura para que una clínica que pague
 * justo entre el SELECT y el UPDATE no quede suspendida por la carrera.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}, igual que los otros 18 crons.
 */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/subscription-lapse] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // Tope explícito. Si algún día se llena, el log lo dice en vez de dejar
  // creer que se barrió todo: al día siguiente el cron toma las siguientes.
  const TOPE = 500;

  const candidatas = await prisma.clinic.findMany({
    where: manualLapseWhere(now),
    orderBy: { nextBillingDate: "asc" },
    select: {
      id: true,
      name: true,
      plan: true,
      monthlyPrice: true,
      subscriptionStatus: true,
      stripeSubscriptionId: true,
      nextBillingDate: true,
      trialEndsAt: true,
    },
    take: TOPE,
  });

  // Segundo filtro con el predicado puro sobre la fila YA leída. El `where` de
  // Prisma y el predicado tienen que decir lo mismo; si alguien cambia uno y no
  // el otro, esto lo atrapa aquí en vez de en producción.
  const aVencer = candidatas.filter((c) => shouldLapseManualSubscription(c, now));
  const descartadas = candidatas.length - aVencer.length;
  if (descartadas > 0) {
    console.error(
      "[cron/subscription-lapse] el where de Prisma y shouldLapseManualSubscription NO coinciden",
      JSON.stringify({ leidas: candidatas.length, descartadas }),
    );
  }

  if (aVencer.length === 0) {
    return NextResponse.json({ lapsed: 0, clinics: [], truncated: false });
  }

  const ids = aVencer.map((c) => c.id);
  const result = await prisma.clinic.updateMany({
    // Se repiten las condiciones de la lectura a propósito (ver el bloque de
    // arriba): sin ellas, una clínica que pagara entre el SELECT y el UPDATE
    // quedaría suspendida recién pagada.
    where: {
      id: { in: ids },
      subscriptionStatus: "active",
      stripeSubscriptionId: null,
      nextBillingDate: { not: null, lt: now },
      trialEndsAt: { lt: now },
    },
    data: { subscriptionStatus: MANUAL_LAPSE_STATUS },
  });

  // AuditLog NO se usa aquí: sus columnas clinicId y userId son FK NOT NULL a
  // users, y un cron no tiene usuario. El webhook de Stripe intenta salvarlo
  // pasando el clinicId como userId, con lo que la fila no entra (logAudit se
  // come el error). Mientras eso no se resuelva, la traza de estos cambios de
  // estado es este log estructurado, que sí queda en los logs de Vercel.
  for (const c of aVencer) {
    console.log(
      "[cron/subscription-lapse] active → past_due",
      JSON.stringify({
        clinicId: c.id,
        name: c.name,
        plan: c.plan,
        monthlyPrice: c.monthlyPrice,
        nextBillingDate: c.nextBillingDate,
        trialEndsAt: c.trialEndsAt,
      }),
    );
  }

  const truncated = candidatas.length === TOPE;
  if (truncated) {
    console.warn(
      "[cron/subscription-lapse] se alcanzó el tope de la pasada; quedan clínicas para mañana",
      JSON.stringify({ tope: TOPE }),
    );
  }

  return NextResponse.json({
    lapsed: result.count,
    clinics: aVencer.map((c) => ({ id: c.id, name: c.name, nextBillingDate: c.nextBillingDate })),
    truncated,
  });
}
