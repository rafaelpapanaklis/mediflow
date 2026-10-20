import "server-only";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { METODOS_DE_PAGO_MANUAL_DEL_PLAN, periodoPagadoHasta } from "@/lib/billing/cobro-rechazado";
import { finProtegidoPorRastros } from "@/lib/billing/regla-cobro-tarjeta.server";

/**
 * INVARIANTE (decimocuarta vuelta): una clínica NUNCA queda sin acceso antes del fin de lo que YA pagó.
 *
 * Un cobro rechazado (`invoice.payment_failed`) deja el acceso en «rechazo + 24 h». Pero si la clínica ya tiene un periodo pagado
 * vigente, el acceso queda en `max(fin de lo pagado, rechazo + 24 h)`. El caso: la regla de la suspensión le dio un periodo por un
 * cobro de tarjeta, Stripe renovó después con el ciclo viejo y esa renovación se rechazó; recortar a «rechazo + 24 h» dejaba sin
 * servicio a quien pagó hasta dentro de semanas.
 *
 * «Pagado vigente» se prueba con evidencia de un PAGO, nunca con el `trialEndsAt` solo (eso reintroduciría el caso BEVADENT, donde
 * Stripe abre el periodo nuevo antes del rechazo y la base lo lee como pagado):
 *   · un pago MANUAL registrado (fila pagada de la lista de métodos manuales, incluida la activación de /admin) cuyo periodo sigue vigente;
 *   · un periodo pagado a mano en la suscripción de Stripe (`trialing` + la marca `periodo_pagado_hasta`);
 *   · el fin de lo pagado que dejó la regla de la suspensión por un cobro de tarjeta (rastro `regla_fallo` / `regla_ok`).
 * Si la lectura de Stripe falla, la función LANZA (AC2). No se usan las filas de cobros de Stripe: una mensualidad de MÓDULO pagada también tiene un periodo futuro y no paga el plan.
 */
export async function finDeAccesoProtegido(args: {
  clinicId: string;
  stripe: Pick<Stripe, "subscriptions"> | null;
  stripeSubscriptionId: string | null | undefined;
  ahora?: Date;
}): Promise<Date | null> {
  const ahora = args.ahora ?? new Date();
  const candidatos: Date[] = [];
  const manuales = await prisma.subscriptionInvoice.findMany({
    where: {
      clinicId: args.clinicId,
      status: "paid",
      periodEnd: { gt: ahora },
      OR: [{ method: null }, { method: { in: [...METODOS_DE_PAGO_MANUAL_DEL_PLAN] } }],
    },
    select: { periodEnd: true },
  });
  for (const f of manuales) if (f.periodEnd) candidatos.push(new Date(f.periodEnd));
  if (args.stripe && args.stripeSubscriptionId) {
    // AC2: si Stripe no responde, el error SE PROPAGA (el webhook contesta 5xx y Stripe reenvía el evento): la marca puede ser la única
    // evidencia de lo pagado, y seguir sin ella bajaría el acceso a «rechazo + 24 h».
    // Una suscripción que Stripe ya no tiene (`resource_missing`) no es una lectura fallida: simplemente no hay marca.
    try {
      const marca = periodoPagadoHasta(await args.stripe.subscriptions.retrieve(args.stripeSubscriptionId), ahora);
      if (marca) candidatos.push(marca);
    } catch (e) {
      const err = e as { code?: string; statusCode?: number };
      if (err?.code !== "resource_missing" && err?.statusCode !== 404) throw e;
    }
  }
  const rastro = await finProtegidoPorRastros(args.clinicId, ahora);
  if (rastro) candidatos.push(rastro);
  if (candidatos.length === 0) return null;
  return new Date(Math.max(...candidatos.map((d) => d.getTime())));
}
