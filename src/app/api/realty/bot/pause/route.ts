// ═══════════════════════════════════════════════════════════════════════
// POST   /api/realty/bot/pause → esta conversación la atiende una persona
// DELETE /api/realty/bot/pause → devolvérsela al bot
//
// Mientras haya pausa, el bot calla en ese teléfono. Es lo mismo que pasa
// solo cuando el prospecto pide humano; aquí es un botón para cuando quien
// lo decide es el equipo.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { mxTenDigits } from "@/lib/phone-mx";
import {
  REALTY_BOT_FEATURE,
  isRealtyGrowthGateOk,
  openRealtyGrowthGate,
} from "@/lib/realty/bot/gate";
import {
  pauseRealtyBotThread,
  resumeRealtyBotThread,
  realtyGrowthStorageReady,
} from "@/lib/realty/bot/growth-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readPhone(req: NextRequest): Promise<string | null> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return null;
  return mxTenDigits((body as { phone?: unknown }).phone as string);
}

export async function POST(req: NextRequest) {
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.send",
    feature: REALTY_BOT_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  if (!(await realtyGrowthStorageReady())) {
    return NextResponse.json({ error: "Falta aplicar sql/realty_growth.sql." }, { status: 503 });
  }

  const phone = await readPhone(req);
  if (!phone) return NextResponse.json({ error: "Teléfono no válido" }, { status: 400 });

  await pauseRealtyBotThread({
    accountId: gate.ctx.accountId,
    phone,
    reason: "Lo tomó una persona desde el panel",
  });
  return NextResponse.json({ ok: true, paused: true });
}

export async function DELETE(req: NextRequest) {
  const gate = await openRealtyGrowthGate({
    permission: "whatsapp.send",
    feature: REALTY_BOT_FEATURE,
  });
  if (!isRealtyGrowthGateOk(gate)) return gate.response;

  const phone = await readPhone(req);
  if (!phone) return NextResponse.json({ error: "Teléfono no válido" }, { status: 400 });

  const ok = await resumeRealtyBotThread(gate.ctx.accountId, phone);
  return NextResponse.json({ ok, paused: false });
}
