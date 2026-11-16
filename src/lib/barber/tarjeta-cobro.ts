import "server-only";
import { prisma } from "@/lib/prisma";
import { barberiaTieneWhatsApp } from "@/lib/barber/wa-conectado";
import { barberClientOptedOut } from "@/lib/barber/whatsapp-core";
import { deliverBarberMessageNow } from "@/lib/barber/whatsapp";
import type { SaleStarsOutcome } from "@/lib/barber/stars-core";
import { readStarsCardSetting } from "@/lib/barber/tarjeta-cobro-ajuste";
import {
  absoluteCardUrl,
  decideStarsCardSend,
  manualStarsCardResult,
  renderStarsCardText,
  starsCardChargeMoves,
  starsCardMark,
  starsCardParams,
  starsCardTotal,
  type StarsCardChargeResult,
} from "@/lib/barber/tarjeta-cobro-core";

/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — la tarjeta de estrellas llega sola tras el cobro
   (ws6-t1, 16-nov). La regla está en ./tarjeta-cobro-core.

   El interruptor de Configuración vive en ./tarjeta-cobro-ajuste (encendido
   por defecto, también sin el SQL).

   El barbershopId SIEMPRE sale de la sesión (o del ticket que ya se filtró
   por ella). Nunca del navegador.
   ═══════════════════════════════════════════════════════════════════════ */

export { readStarsCardSetting, saveStarsCardSetting, _reiniciarTarjetaCobro, type StarsCardSetting } from "@/lib/barber/tarjeta-cobro-ajuste";

/**
 * Tras un cobro con estrellas: encola y manda AHORA «Llevas 4 de 6 estrellas
 * · Ver mi tarjeta». Una sola vez por ticket (la marca auto:tarjeta:<ticket>,
 * comprobada con un candado por ticket). Nunca lanza: el cobro ya quedó.
 *
 * `outcome` es lo que la ruta de cobro ya calculó (saleStarsOutcome); null =
 * el ticket no tiene cliente o la tarjeta está apagada → no hay nada que mandar.
 * `origin` es el dominio público de la petición (para el enlace absoluto).
 */
export async function sendStarsCardAfterCharge(args: {
  barbershopId: string;
  saleId: string;
  origin: string;
  outcome: SaleStarsOutcome | null;
}): Promise<StarsCardChargeResult> {
  const none: StarsCardChargeResult = { status: "none", manualHref: null, reason: "noStars" };
  const { barbershopId, saleId, origin, outcome } = args;
  if (!barbershopId || !saleId || !outcome) return none;
  // «Tras cada cobro CON estrellas»: el ticket ganó una o usó un bono. Una
  // venta solo de productos no mueve la tarjeta y no merece un mensaje.
  if (!starsCardChargeMoves(outcome)) return none;

  const params = starsCardParams({
    firstName: outcome.firstName,
    stars: outcome.stars,
    total: starsCardTotal(outcome.stars, outcome.next),
    url: absoluteCardUrl(origin, outcome.cardPath),
  });
  const text = renderStarsCardText(params);
  let phone: string | null = null;

  try {
    const sale = await prisma.barberSale.findFirst({
      where: { id: saleId, barbershopId },
      select: { clientId: true, client: { select: { phone: true, preferences: true } } },
    });
    if (!sale?.clientId || !sale.client) return none;
    phone = sale.client.phone;

    const setting = await readStarsCardSetting(barbershopId);
    const connected = setting.enabled ? await barberiaTieneWhatsApp(barbershopId) : false;
    const mark = starsCardMark(saleId);

    // Una vez por ticket: candado por ticket + ¿ya hay una fila con su marca?
    const queued = await prisma.$transaction(async (tx) => {
      const pre = decideStarsCardSend({
        enabled: setting.enabled,
        hasStars: true,
        phone,
        optedOut: barberClientOptedOut(sale.client!.preferences),
        connected,
        alreadyQueued: false,
      });
      // (sin strict, `!pre.send` no estrecha la unión: se pregunta por el campo)
      if ("skip" in pre) return { skip: pre.skip, id: null as string | null };
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dcb:tarjeta:${barbershopId}:${saleId}`}))`;
      const ya = await tx.barberMessage.findFirst({
        where: { barbershopId, direction: "OUTBOUND", templateName: mark },
        select: { id: true },
      });
      if (ya) return { skip: "already" as const, id: null };
      // La fila nace dentro del candado: la segunda petición del mismo ticket ya la ve.
      const id = await enqueueBarberMessageTx(tx, { barbershopId, phone: pre.phone, body: text, templateName: mark, clientId: sale.clientId });
      return { skip: null, id };
    });

    if (queued.skip === "already") return { status: "queued", manualHref: null, reason: "already" };
    if (queued.skip) return manualStarsCardResult(phone, text, queued.skip);
    if (!queued.id) return manualStarsCardResult(phone, text, "noPhone");

    const sent = await deliverBarberMessageNow(barbershopId, queued.id);
    if (sent.status === "SENT") return { status: "sent", manualHref: null, reason: null };
    if (sent.status === "PENDING") return { status: "queued", manualHref: null, reason: null };
    const reason = sent.code === "TEMPLATE_PENDING" ? "templatePending" : sent.code === "QUOTA" ? "quota" : sent.code === "NOT_CONNECTED" ? "notConnected" : "sendFailed";
    return manualStarsCardResult(phone, text, reason);
  } catch (e) {
    console.warn(`[barber/tarjeta-cobro] no se pudo mandar la tarjeta del ticket ${saleId}:`, (e as Error).message);
    return manualStarsCardResult(phone, text, "sendFailed");
  }
}

/** Lo mismo que enqueueBarberMessage (whatsapp.ts), dentro de la transacción del candado. */
async function enqueueBarberMessageTx(
  tx: Pick<typeof prisma, "barberMessage">,
  input: { barbershopId: string; phone: string; body: string; templateName: string; clientId: string },
): Promise<string> {
  const row = await tx.barberMessage.create({
    data: {
      barbershopId: input.barbershopId,
      direction: "OUTBOUND",
      phone: input.phone,
      body: input.body,
      templateName: input.templateName,
      status: "PENDING",
      clientId: input.clientId,
    },
    select: { id: true },
  });
  return row.id;
}

