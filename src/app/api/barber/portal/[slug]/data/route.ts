import { NextRequest, NextResponse } from "next/server";
import {
  getPortalSession,
  loadPortalData,
  resolvePortalShop,
} from "@/lib/barber/client-portal";

/**
 * GET /api/barber/portal/[slug]/data — todo lo del cliente, en una llamada.
 *
 * AISLAMIENTO: no hay parámetro de cliente. El clientId sale ÚNICAMENTE de
 * la cookie firmada, y la cookie trae dentro su barbershopId, que se compara
 * contra el de ESTE slug. No existe un id que se pueda cambiar en la URL:
 * cambiar el slug solo consigue un 401.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  try {
    const shop = await resolvePortalShop(params.slug);
    if (!shop) return NextResponse.json({ error: "Barbería no encontrada" }, { status: 404 });

    const session = getPortalSession(shop.id);
    if (!session) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });

    const data = await loadPortalData({
      barbershopId: shop.id,
      clientId: session.clientId,
    });
    if (!data) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });

    return NextResponse.json(data);
  } catch (err) {
    console.error("[barber/portal/data] error:", err);
    return NextResponse.json({ error: "No pudimos cargar tu información" }, { status: 500 });
  }
}
