import { NextResponse } from "next/server";
import { getBarberContext, type BarberContext } from "@/lib/barber-auth";
import { matrizDelDueno } from "@/lib/barber/mercadopago-core";

/**
 * Puerta de lo que CAMBIA la cuenta de Mercado Pago de la barbería
 * (conectar, desconectar): sesión de barbería + DUEÑO de la cadena.
 * La matriz sale de la sesión; nada del body ni de la query participa.
 */
export type GateDueno = { ctx: BarberContext; rootId: string } | { response: NextResponse };

export async function gateDueno(): Promise<GateDueno> {
  const ctx = await getBarberContext();
  if (!ctx) return { response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  const rootId = matrizDelDueno(ctx);
  if (!rootId) {
    return {
      response: NextResponse.json(
        { error: "Solo el dueño de la barbería puede conectar o desconectar Mercado Pago.", code: "ownerOnly" },
        { status: 403 },
      ),
    };
  }
  return { ctx, rootId };
}
