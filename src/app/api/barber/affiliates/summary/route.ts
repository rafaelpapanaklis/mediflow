import { NextResponse } from "next/server";
import { getBarberAffiliateSummary } from "@/lib/barber/affiliates";
import { affiliatesErrorResponse, requireBarberAffiliates } from "../_lib";

/**
 * GET /api/barber/affiliates/summary — todo lo que pinta el panel del socio.
 *
 * La página ya trae este mismo objeto renderizado en el servidor; esta ruta
 * existe para REFRESCAR sin recargar (después de guardar los datos de cobro
 * o de reclamar un código). Filtra por la barbería de la SESIÓN: el
 * barbershopId sale de getBarberContext, jamás del query.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireBarberAffiliates();
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ summary: await getBarberAffiliateSummary(auth.ctx) });
  } catch (err) {
    return affiliatesErrorResponse(err);
  }
}
