import { NextRequest, NextResponse } from "next/server";
import { runNetworkBonusSweep } from "@/lib/affiliates/network-bonus";
import { sendAffiliateNetworkBonusAwardedEmail } from "@/lib/affiliate-emails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// El barrido procesa afiliado por afiliado (a propósito, para no abrir seis
// transacciones a la vez contra PgBouncer) y encima manda un correo por bono
// otorgado. Con el default de 10 s se cortaría a media pasada y, aunque nada
// se perdería —cada escritura es idempotente—, los awards del final del
// alfabeto esperarían un mes. 300 s es el mismo techo que cfdi-overage.
export const maxDuration = 300;

/**
 * GET /api/cron/affiliate-network-bonus — Vercel Cron "0 8 1 * *"
 * (08:00 UTC el día 1 de cada mes).
 *
 * QUÉ BARRE
 * Los BONOS POR RED de los afiliados: los que premian las clínicas activas que
 * trajeron LOS AFILIADOS QUE ÉL INVITÓ (no las que trajo él mismo — para esas
 * está el Bono por Clínicas Activas). En una pasada recuenta la red de cada
 * afiliado y mueve sus awards por el ciclo de vida, que hoy es corto: arrancar
 * la racha, reiniciarla si se pierde el umbral, y otorgar cuando se sostuvo.
 *
 * NO GENERA MENSUALIDADES. La modalidad mensual se retiró: todo bono por red es
 * un PAGO ÚNICO, y su comisión (`netbonus:<awardId>:once`) la escribe el propio
 * barrido en la misma transacción que otorga el escalón. No queda nada
 * pendiente de elegir ni de renovar cada mes.
 *
 * ESTE ARCHIVO NO DECIDE NADA. Autentica, invoca y notifica. Toda la lógica de
 * dinero vive en `runNetworkBonusSweep` (src/lib/affiliates/network-bonus.ts) y
 * su cerebro puro `decideNetworkSweep` (network-bonus-core.ts), que se prueba
 * sin base de datos con `npm run test:bonos-red`. Duplicar aquí aunque sea un
 * umbral sería crear una segunda verdad sobre cuánto se le paga a quién.
 *
 * POR QUÉ UNA VEZ AL MES
 * La cláusula del programa cuenta MESES sostenidos, no días: correrlo más
 * seguido no adelantaría ningún bono (`monthsElapsed` sigue redondeando hacia
 * abajo) y solo multiplicaría escrituras. El día 1 hace además que el mes del
 * reloj y el mes que se paga sean el mismo — `periodKey` es UTC justamente
 * para que dos corridas a los lados de la medianoche no caigan en meses
 * distintos.
 *
 * DÓNDE ESTÁ EL CANDADO DE IDEMPOTENCIA
 * En el índice ÚNICO de `affiliate_commissions."stripeInvoiceId"`. El bono se
 * escribe con la referencia `netbonus:<awardId>:once` (commissionRefOnce) en la
 * MISMA `$transaction` que otorga el award. Correr el cron dos veces NO paga
 * doble: el segundo intento choca contra el índice y el rollback deja también
 * el award como estaba, así que nunca queda un escalón marcado como otorgado
 * sin su comisión. El `updateMany` condicionado a `status = 'tracking'` es solo
 * el filtro barato que evita intentarlo; la garantía es la base de datos, no
 * una lectura previa (esa carrera se pierde). Los choques se cuentan en
 * `duplicatesBlocked` y en una corrida sana deberían ser 0.
 *
 * DEGRADACIÓN
 * Si el programa está apagado o `sql/afiliados-bonos-red.sql` todavía no está
 * aplicado, el barrido devuelve `ran: false` sin tocar nada y aquí se responde
 * 200 con `skipped`. Un deploy adelantado al SQL no debe pintar de rojo el
 * panel de crons de Vercel: no es un fallo, es que no hay nada que barrer.
 */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron/affiliate-network-bonus] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  try {
    const summary = await runNetworkBonusSweep(now);

    if (!summary.ran) {
      return NextResponse.json({
        skipped: true,
        reason:
          "Bonos por red apagados (networkBonusEnabled), sin escalones configurados " +
          "o sql/afiliados-bonos-red.sql sin aplicar",
        periodKey: summary.periodKey,
        timestamp: now.toISOString(),
      });
    }

    // Los correos van DESPUÉS del barrido y nunca dentro de él: para cuando se
    // manda el primero, el dinero ya está escrito. Si Resend está caído, el
    // afiliado igual ve su bono en el panel; al revés —mandar el correo y que
    // la escritura falle— le estaríamos prometiendo un bono inexistente.
    //
    // Uno por uno y con su propio try/catch: un correo caído no puede tumbar el
    // cron ni deshacer lo ya escrito, y NO se reintenta porque el barrido del
    // mes siguiente ya no volverá a otorgar ese escalón (el award queda en
    // `awarded`) — el aviso vive también en el panel, que es la fuente de
    // verdad, y el bono se cobra igual aunque el correo nunca llegue.
    // `sendAffiliateNetworkBonusAwardedEmail` tiene su propio try/catch
    // interno; este es el cinturón sobre los tirantes.
    //
    // Secuencial a propósito: son un puñado de awards al mes y así no se
    // dispara el rate limit del proveedor de correo con una ráfaga.
    let emailsSent = 0;
    let emailsFailed = 0;
    for (const awardId of summary.awardedIds) {
      try {
        await sendAffiliateNetworkBonusAwardedEmail({ awardId });
        emailsSent += 1;
      } catch (err) {
        emailsFailed += 1;
        console.error("[cron/affiliate-network-bonus] correo del award", awardId, err);
      }
    }

    console.info(
      `[cron/affiliate-network-bonus] ${summary.periodKey}: ${summary.affiliates} afiliados, ` +
        `${summary.started} rachas iniciadas, ${summary.refreshed} refrescadas, ` +
        `${summary.resets} reiniciadas, ${summary.awarded} bonos otorgados ` +
        `($${summary.awardedMxn}), ${summary.duplicatesBlocked} duplicados bloqueados, ` +
        `${summary.errors} errores, ${emailsSent} correos`,
    );

    // El summary completo en la respuesta: es lo que se lee en los logs de
    // Vercel para saber qué hizo la corrida sin abrir la base de datos.
    return NextResponse.json({
      ok: true,
      ...summary,
      emailsSent,
      emailsFailed,
      timestamp: now.toISOString(),
    });
  } catch (err) {
    // Solo se llega aquí si el barrido explotó de verdad: sus errores por
    // afiliado ya se aíslan dentro y se cuentan en `summary.errors`.
    console.error("[cron/affiliate-network-bonus]", err);
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}
