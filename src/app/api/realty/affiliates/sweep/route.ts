// ═══════════════════════════════════════════════════════════════════════
// POST /api/realty/affiliates/sweep → devengar las comisiones del mes
//
// 🔴 ESTA RUTA ES DE PLATAFORMA Y NO TIENE CAMINO DE CUENTA. A diferencia
// de los otros barridos del área, aquí NO hay una versión "solo mi cuenta":
// devengar es CREAR DINERO A COBRAR, y quien lo dispara no puede ser el
// mismo que lo cobra. Se abre con el secreto del cron o con sesión de
// admin de DaleControl; con sesión de inmuebles, nunca.
//
// Lo que hace es una APROXIMACIÓN honesta, y por eso la comisión nace
// PENDIENTE (nadie cobra sin que una persona la apruebe): el punto correcto
// para devengar es el webhook de Stripe del vertical, que es de OTRA
// terminal y no se toca desde aquí. Mientras esa línea no exista, el
// barrido devenga una comisión al mes por cada cuenta referida que está al
// corriente, usando el precio de su plan como base.
//
// El día que el webhook llame a `accrueRealtyAffiliateCommission` con la
// factura real, este barrido deja de encontrar trabajo SOLO: comprueba el
// mes antes de insertar, así que no duplica.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { realtyGrowthCronAuthorized } from "@/lib/realty/bot/gate";
import { sweepRealtyAffiliateCommissions } from "@/lib/realty/affiliates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!realtyGrowthCronAuthorized(req)) {
    const session = await getAdminSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sweepRealtyAffiliateCommissions();
  return NextResponse.json({ ok: true, ...result });
}
