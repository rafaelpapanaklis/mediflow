import { type NextRequest, NextResponse } from "next/server";
import { getBarberContext } from "@/lib/barber-auth";
import {
  assertBarberFeature,
  createSale,
  listSales,
  moneyErrorResponse,
  type CreateSaleInput,
} from "@/lib/barber/cash";
import { prisma } from "@/lib/prisma";
import { saleStarsOutcome } from "@/lib/barber/stars-core";
import { origenPublicoDe } from "@/lib/url-publica";

export const dynamic = "force-dynamic";

// GET /api/barber/sales?sessionId=&limit= → tickets de la barbería (cash.view).
export async function GET(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await assertBarberFeature(ctx, "cash");
    const sp = req.nextUrl.searchParams;
    const limitRaw = Number(sp.get("limit") ?? "50");
    const rows = await listSales(ctx, {
      sessionId: sp.get("sessionId"),
      limit: Number.isFinite(limitRaw) ? limitRaw : 50,
    });
    return NextResponse.json({ sales: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}

// POST /api/barber/sales → cobra un ticket (cash.manage, turno abierto).
// Body: { appointmentId?, clientId?, barberId?, items: [{kind, id, qty}],
//         discount?, tip?, paymentMethod, redeemLoyaltyItemIndex?,
//         redeemBonusId?, membershipItemIndex?, notes? }. Los precios NO viajan
//         en el body. La respuesta trae además `stars` (lo que Caja enseña al
//         terminar: «★ +1 estrella para Juan: lleva 7 de 10», el bono que
//         alcanzó y el enlace de su tarjeta) o null.
export async function POST(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const features = await assertBarberFeature(ctx, "cash");
    const body = (await req.json().catch(() => ({}))) as CreateSaleInput;
    const sale = await createSale(ctx, body, features);
    // El cobro YA quedó: si el resumen de estrellas fallara, no se tumba.
    const stars = await saleStarsOutcome(prisma, {
      barbershopId: ctx.barbershopId,
      slug: ctx.barbershop.slug,
      saleId: sale.id,
      bonusId: typeof body.redeemBonusId === "string" ? body.redeemBonusId : null,
    }).catch((e) => {
      console.warn("[api/barber/sales] resumen de estrellas:", (e as Error).message);
      return null;
    });
    // ws6-t1 (16-nov): la tarjeta de estrellas le llega sola por WhatsApp
    // (una vez por ticket). Si no puede salir sola, Caja ofrece mandarla a
    // mano. Nunca lanza: el cobro ya quedó. Import diferido: el emisor de
    // WhatsApp es server-only y esta ruta la cargan pruebas sin Next.
    const starsCard = await import("@/lib/barber/tarjeta-cobro")
      .then(({ sendStarsCardAfterCharge }) =>
        sendStarsCardAfterCharge({
          barbershopId: ctx.barbershopId,
          saleId: sale.id,
          origin: origenPublicoDe(req, req.url),
          outcome: stars,
        }),
      )
      .catch((e) => {
        console.warn("[api/barber/sales] tarjeta por WhatsApp:", (e as Error).message);
        return null;
      });
    return NextResponse.json({ ...sale, stars, starsCard }, { status: 201 });
  } catch (e) {
    return moneyErrorResponse(e);
  }
}
