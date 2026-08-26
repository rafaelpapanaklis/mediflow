// ═══════════════════════════════════════════════════════════════════════
// POST /api/realty/campaigns/sweep → mandar lo que YA le tocaba salir
//
// 🔴 SIN ESTA RUTA, "PROGRAMADA" ES DECORACIÓN. Una campaña que alguien
// dejó lista para el martes a las 10 se quedaba ahí para siempre: la
// pantalla decía "programada" y nadie la mandaba. Es la peor forma de
// fallar, porque el dueño se entera semanas después de que su promoción
// nunca salió.
//
// DOS PUERTAS, igual que el barrido del bot y por la misma razón:
//   · Con `Authorization: Bearer $CRON_SECRET` → barre TODAS las cuentas.
//     Es el camino del cron.
//   · Con sesión de inmuebles → barre SOLO la cuenta de quien llama, para
//     que un dueño pueda empujar sus programadas sin esperar al cron.
//
// 🔴 EL accountId NUNCA SALE DEL BODY. Con sesión sale del contexto; con
// cron no hay accountId y se barre todo. Aceptarlo del request sería dejar
// que cualquiera dispare los WhatsApps —y el cupo— de una cuenta ajena.
//
// Manda UNA TANDA por campaña y por vuelta. El tope diario y el cupo del
// plan los sigue aplicando el envío fila por fila; repartir en vueltas es
// justo lo que protege el número del cliente.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import {
  REALTY_CAMPAIGNS_FEATURE,
  isRealtyGrowthGateOk,
  openRealtyGrowthGate,
  realtyGrowthCronAuthorized,
} from "@/lib/realty/bot/gate";
import { sweepRealtyCampaigns } from "@/lib/realty/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (realtyGrowthCronAuthorized(req)) {
    const result = await sweepRealtyCampaigns(undefined, { limit: 40 });
    return NextResponse.json({ ok: true, scope: "todas", ...result });
  }

  // El camino con sesión pide whatsapp.send y no whatsapp.view: empujar el
  // barrido es MANDAR mensajes, aunque el botón parezca de refrescar.
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.send",
    feature: REALTY_CAMPAIGNS_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  const result = await sweepRealtyCampaigns(gate.ctx.accountId, { limit: 10 });
  return NextResponse.json({ ok: true, scope: "cuenta", ...result });
}
