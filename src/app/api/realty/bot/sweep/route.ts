// ═══════════════════════════════════════════════════════════════════════
// POST /api/realty/bot/sweep → correr el barrido del bot
//
// DOS PUERTAS, y son distintas a propósito:
//   · Con `Authorization: Bearer $CRON_SECRET` → barre TODAS las cuentas.
//     Es el camino del cron.
//   · Con sesión de inmuebles → barre SOLO la cuenta de quien llama. Es el
//     botón "Contestar lo pendiente" del panel, para que un dueño pueda ver
//     al bot trabajar sin esperar al cron.
//
// 🔴 EL accountId NUNCA SALE DEL BODY. En el camino con sesión sale del
// contexto; en el del cron no hay accountId y se barre todo. Aceptar un
// accountId del request sería dejar que cualquiera dispare el bot —y el
// gasto de IA— de una cuenta ajena.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import {
  REALTY_BOT_FEATURE,
  isRealtyGrowthGateOk,
  openRealtyGrowthGate,
  realtyGrowthCronAuthorized,
} from "@/lib/realty/bot/gate";
import { sweepRealtyBot } from "@/lib/realty/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (realtyGrowthCronAuthorized(req)) {
    const result = await sweepRealtyBot(undefined, { limit: 50 });
    return NextResponse.json({ ok: true, scope: "todas", ...result });
  }

  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.send",
    feature: REALTY_BOT_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  const result = await sweepRealtyBot(gate.ctx.accountId, { limit: 20 });
  return NextResponse.json({ ok: true, scope: "cuenta", ...result });
}
