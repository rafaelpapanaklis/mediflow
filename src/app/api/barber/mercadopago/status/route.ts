import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { persistentRateLimit } from "@/lib/failban";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { estadoCuentaMp, tiendaAceptaMercadoPago } from "@/lib/barber/mercadopago";
import { matrizDeLaSesion, matrizDelDueno } from "@/lib/barber/mercadopago-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/barber/mercadopago/status — ws6-t5 (contrato con la tienda, ws6-t1).
 *
 * Responde SIEMPRE `{ connected, account }`:
 *   · con sesión del panel: el estado de la cadena de la sesión (`connected`,
 *     `needsReconnect`, `storageReady`, `platformReady`, `canManage` = ¿es el
 *     dueño?) y la cuenta (apodo, correo y número enmascarado; nunca un token)
 *     SOLO para el Dueño y quien tiene «Configuración» (D3); al resto, null;
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
    const canManage = matrizDelDueno(ctx) != null;
    // La cuenta (apodo, CORREO y número enmascarado de Mercado Pago) solo la
    // ven el Dueño y quien tiene «Configuración» (D3, 16-nov, auditoría de
    // permisos). Al resto del panel (Recepción, Barbero) le basta saber si
    // la barbería cobra en línea: `connected` y compañía viajan igual.
    const veCuenta =
      canManage ||
      hasBarberPermission({ role: ctx.role, permissionsOverride: ctx.user.permissionsOverride }, "settings.edit");
    return NextResponse.json({ ...estado, account: veCuenta ? estado.account : null, canManage });
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
