import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { persistentRateLimit } from "@/lib/failban";
import { getBarberContext } from "@/lib/barber-auth";
import { estadoCuentaMp, tiendaAceptaMercadoPago } from "@/lib/barber/mercadopago";
import { matrizDeLaSesion, matrizDelDueno } from "@/lib/barber/mercadopago-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/barber/mercadopago/status — ws6-t5 (contrato con la tienda, ws6-t1).
 *
 * Responde SIEMPRE `{ connected, account }`:
 *   · con sesión del panel: la cuenta de la cadena de la sesión, con apodo,
 *     correo y la cuenta enmascarada (nunca un token), más `needsReconnect`,
 *     `storageReady`, `platformReady` y `canManage` (¿es el dueño?);
 *   · sin sesión, con `?slug=<barbería>`: solo `connected` (¿la tienda de esa
 *     barbería ofrece pagar en línea?) y `account: null`;
 *   · sin sesión ni slug: `{ connected: false, account: null }`.
 * `connected` = la barbería PUEDE cobrar ahora (plataforma configurada y
 * token legible). Nunca truena por la conexión: un token que no abre es
 * `connected: false, needsReconnect: true`.
 */
export async function GET(req: NextRequest) {
  const ctx = await getBarberContext();
  if (ctx) {
    const estado = await estadoCuentaMp(matrizDeLaSesion(ctx));
    return NextResponse.json({ ...estado, canManage: matrizDelDueno(ctx) != null });
  }

  const slug = (req.nextUrl.searchParams.get("slug") ?? "").trim().toLowerCase();
  if (!slug || slug.length > 80) return NextResponse.json({ connected: false, account: null });
  const limited = await persistentRateLimit(req, { limit: 120, windowSec: 600, scope: "barber-mp-status" });
  if (limited) return limited;
  try {
    const shop = await prisma.barbershop.findUnique({ where: { slug }, select: { id: true, isActive: true } });
    const connected = !!shop?.isActive && (await tiendaAceptaMercadoPago(shop.id));
    return NextResponse.json({ connected, account: null });
  } catch (e) {
    console.error(`[barber-mp] status público falló (${slug}): ${(e as Error).message}`);
    return NextResponse.json({ connected: false, account: null });
  }
}
