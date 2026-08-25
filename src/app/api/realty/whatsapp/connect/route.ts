import { NextRequest, NextResponse } from "next/server";
import { isRealtyWaGateOk, openRealtyWaGate } from "../_server";
import { disconnectRealtyWa, saveRealtyWaConnection } from "@/lib/realty/whatsapp";

export const dynamic = "force-dynamic";

/**
 * Conectar el número propio de la cuenta (WABA). El token se guarda CIFRADO
 * (encryptField) — el schema de la Ola 0 lo pedía por escrito y con razón:
 * un token de WhatsApp en claro es la cuenta entera de Meta.
 *
 * Pide `settings.edit` y no `whatsapp.send`: conectar el número es un ajuste
 * de la cuenta, no mandar un mensaje.
 */
export async function POST(req: NextRequest) {
  const gate = await openRealtyWaGate("settings.edit");
  if (!isRealtyWaGateOk(gate)) return gate.response;

  const body = await req.json().catch(() => ({}));
  const wabaId = typeof body?.wabaId === "string" ? body.wabaId.trim() : "";
  const phoneNumberId = typeof body?.phoneNumberId === "string" ? body.phoneNumberId.trim() : "";
  const token = typeof body?.token === "string" ? body.token.trim() : "";

  if (!phoneNumberId || !token) {
    return NextResponse.json(
      { error: "Faltan el identificador del número y el token." },
      { status: 400 },
    );
  }

  // Un phone_number_id ya usado por otra cuenta rompería el webhook: los dos
  // mensajes caerían en la primera que resuelva. Mejor decirlo aquí.
  const { prisma } = await import("@/lib/prisma");
  const taken = await prisma.realtyAccount.findFirst({
    where: { phoneNumberId, NOT: { id: gate.ctx.accountId } },
    select: { id: true },
  });
  if (taken) {
    return NextResponse.json(
      { error: "Ese número ya está conectado en otra cuenta." },
      { status: 409 },
    );
  }

  await saveRealtyWaConnection({
    accountId: gate.ctx.accountId,
    wabaId,
    phoneNumberId,
    token,
    // Se marca verificado al guardar; el primer estado FAILED con código 190
    // que llegue por el webhook lo vuelve a apagar solo.
    verified: true,
  });

  return NextResponse.json({ ok: true });
}

/** Desconectar: la cuenta vuelve al número de la plataforma. */
export async function DELETE() {
  const gate = await openRealtyWaGate("settings.edit");
  if (!isRealtyWaGateOk(gate)) return gate.response;

  await disconnectRealtyWa(gate.ctx.accountId);
  return NextResponse.json({ ok: true });
}
