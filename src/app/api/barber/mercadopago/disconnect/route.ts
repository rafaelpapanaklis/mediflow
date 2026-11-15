import { NextResponse } from "next/server";
import { desconectarCuenta, estadoCuentaMp } from "@/lib/barber/mercadopago";
import { gateDueno } from "../_gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/barber/mercadopago/disconnect — ws6-t5.
 *
 * El DUEÑO desconecta la cuenta de Mercado Pago de su cadena: los tokens se
 * borran (la fila queda con la cuenta y la fecha). Desde ese momento la
 * tienda deja de ofrecer «Pagar ahora en línea». Los pedidos ya pagados no
 * cambian. La confirmación se pide en la pantalla antes de llamar aquí.
 */
export async function POST() {
  const gate = await gateDueno();
  if ("response" in gate) return gate.response;
  try {
    await desconectarCuenta(gate.rootId);
    return NextResponse.json({ ok: true, status: await estadoCuentaMp(gate.rootId) });
  } catch (e) {
    console.error(`[barber-mp] no se pudo desconectar (barbería ${gate.rootId}): ${(e as Error).message}`);
    return NextResponse.json({ error: "No pudimos desconectar Mercado Pago. Intenta de nuevo." }, { status: 500 });
  }
}
