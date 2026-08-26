// ═══════════════════════════════════════════════════════════════════════
// GET  /api/realty/bot → todo lo que pinta /inmobiliaria/bot
// PATCH /api/realty/bot → guardar la configuración
//
// 🔴 LAS DOS COSAS QUE ESTA RUTA NO DEJA PASAR, y que están aquí y no en la
// pantalla porque quien escriba un curl llega igual:
//   1. ENCENDER SIN TOPE. Si el body trae `enabled: true` y el tope de
//      gasto queda en 0, se rechaza con 400. No hay orden de llamadas que
//      deje el bot encendido con gasto abierto.
//   2. ENCENDER SIN WHATSAPP. Sin número conectado el bot no tiene con qué
//      contestar; encenderlo sería prometer algo que no va a pasar.
//
// El tope MÁXIMO lo vuelve a acotar `normalizeRealtyBotSettings` (recorta a
// 500) y la base lo repite con un CHECK. Tres capas para el mismo número
// porque es el que decide cuánto se le cobra a una inmobiliaria.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { getRealtyWaConnection, getRealtyWaQuota } from "@/lib/realty/whatsapp";
import {
  REALTY_BOT_FEATURE,
  isRealtyGrowthGateOk,
  openRealtyGrowthGate,
} from "@/lib/realty/bot/gate";
import {
  getRealtyBotSpendToday,
  normalizeRealtyBotSettings,
  realtyQuotaIsTight,
  type RealtyBotPanelState,
  type RealtyBotSkipReason,
} from "@/lib/realty/bot";
import {
  getRealtyBotSettings,
  listRealtyBotPauses,
  listRealtyBotTurns,
  listRealtyBotVisits,
  realtyGrowthStorageReady,
  saveRealtyBotSettings,
} from "@/lib/realty/bot/growth-db";
import { realtyMicrosToMxn } from "@/lib/realty/bot/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ¿Hay llave de IA en el entorno? Sin ella el bot no puede pensar. */
function aiConfigured(): boolean {
  return Boolean(
    (process.env.REALTY_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "").trim(),
  );
}

function aiModelName(): string {
  return (process.env.REALTY_BOT_AI_MODEL || "").trim() || "claude-sonnet-4-6";
}

export async function GET() {
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.view",
    feature: REALTY_BOT_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;
  const { ctx } = gate;

  const [settings, storageReady, quota, connection] = await Promise.all([
    getRealtyBotSettings(ctx.accountId),
    realtyGrowthStorageReady(),
    getRealtyWaQuota(ctx.accountId),
    getRealtyWaConnection(ctx.accountId),
  ]);

  const [spend, pauses, rawTurns, visits] = await Promise.all([
    getRealtyBotSpendToday(ctx.accountId, ctx.account.timezone, settings.aiDailyCapMxn),
    listRealtyBotPauses(ctx.accountId),
    listRealtyBotTurns(ctx.accountId, 60),
    listRealtyBotVisits(ctx.accountId, 20),
  ]);

  const state: RealtyBotPanelState = {
    settings,
    storageReady,
    aiConfigured: aiConfigured(),
    aiModel: aiModelName(),
    spend: {
      day: spend.day,
      spentMxn: spend.spentMxn,
      capMxn: spend.capMxn,
      turns: rawTurns.filter((t) => t.outboundBody).length,
      capReached: spend.capReached,
    },
    quota: {
      used: quota.used,
      limit: quota.limit,
      tight: realtyQuotaIsTight(quota.used, quota.limit),
    },
    pauses,
    turns: rawTurns.map((t) => ({
      id: t.id,
      phone: t.phone,
      contactName: t.contactName,
      inboundBody: t.inboundBody,
      outboundBody: t.outboundBody,
      skipReason: (t.skipReason as RealtyBotSkipReason) ?? null,
      handoff: t.handoff,
      handoffReason: t.handoffReason,
      costMxn: realtyMicrosToMxn(t.costMicros),
      correctedBody: t.correctedBody,
      correctedAt: t.correctedAt,
      createdAt: t.createdAt,
    })),
    visits,
  };

  return NextResponse.json({ state, connected: connection.state === "CONNECTED" });
}

export async function PATCH(req: NextRequest) {
  // Cambiar la configuración del bot es EMITIR mensajes en nombre de la
  // cuenta: pide whatsapp.send, no whatsapp.view.
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.send",
    feature: REALTY_BOT_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;
  const { ctx } = gate;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!(await realtyGrowthStorageReady())) {
    return NextResponse.json(
      { error: "Falta aplicar sql/realty_growth.sql en la base. Escríbenos a soporte." },
      { status: 503 },
    );
  }

  const current = await getRealtyBotSettings(ctx.accountId);
  // Se parte de lo GUARDADO y se pisa con lo que venga: un PATCH que solo
  // trae `enabled` no puede borrar el tono ni el horario.
  const next = normalizeRealtyBotSettings({ ...current, ...(body as Record<string, unknown>) });

  if (next.enabled) {
    // 🔴 PUERTA 1 — encendido SIEMPRE con tope. La normalización ya recortó
    // el máximo; esto impide el 0.
    if (next.aiDailyCapMxn <= 0) {
      return NextResponse.json(
        {
          error:
            "Ponle un tope de gasto de IA al día antes de encender el bot. Sin tope no se enciende.",
          field: "aiDailyCapMxn",
        },
        { status: 400 },
      );
    }
    // 🔴 PUERTA 2 — sin número conectado no hay bot.
    const connection = await getRealtyWaConnection(ctx.accountId);
    if (connection.state !== "CONNECTED") {
      return NextResponse.json(
        {
          error: "Conecta tu WhatsApp antes de encender el bot.",
          field: "whatsapp",
        },
        { status: 400 },
      );
    }
  }

  const saved = await saveRealtyBotSettings(ctx.accountId, next, ctx.realtyUserId);
  return NextResponse.json({ settings: saved });
}
