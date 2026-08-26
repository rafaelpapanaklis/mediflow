// ═══════════════════════════════════════════════════════════════════════
// PATCH /api/realty/bot/turns → corregir lo que el bot contestó
//
// La corrección NO reescribe lo que se mandó: se guarda AL LADO
// (`correctedBody`). Lo que salió, salió — borrarlo haría imposible
// entender por qué el bot dijo lo que dijo, y es justo lo que alguien va a
// querer revisar cuando un prospecto se queje.
//
// Lo que SÍ hace: las últimas correcciones viajan al siguiente turno como
// reglas ("cuando te pregunten X, contesta Y"). Corregir una vez enseña.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import {
  REALTY_BOT_FEATURE,
  isRealtyGrowthGateOk,
  openRealtyGrowthGate,
} from "@/lib/realty/bot/gate";
import { correctRealtyBotTurn, realtyGrowthStorageReady } from "@/lib/realty/bot/growth-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.send",
    feature: REALTY_BOT_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  if (!(await realtyGrowthStorageReady())) {
    return NextResponse.json({ error: "Falta aplicar sql/realty_growth.sql." }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as {
    turnId?: unknown;
    correctedBody?: unknown;
  } | null;
  const turnId = typeof body?.turnId === "string" ? body.turnId : "";
  const correctedBody = typeof body?.correctedBody === "string" ? body.correctedBody.trim() : "";

  if (!turnId) return NextResponse.json({ error: "Falta el turno" }, { status: 400 });
  if (correctedBody.length < 3) {
    return NextResponse.json({ error: "Escribe lo que debió contestar." }, { status: 400 });
  }

  // El accountId sale de la sesión: un turno de otra cuenta no se toca
  // aunque su id venga en el body (el UPDATE lleva las dos condiciones).
  const ok = await correctRealtyBotTurn({
    accountId: gate.ctx.accountId,
    turnId,
    correctedBody,
    byUserId: gate.ctx.realtyUserId,
  });

  if (!ok) return NextResponse.json({ error: "Ese turno no existe." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
