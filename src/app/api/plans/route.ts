import { NextResponse } from "next/server";
import { getResolvedPlans } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/plans — público. Devuelve los planes ya resueltos (precio
 * mensual/anual, bullets de marketing, límites y permisos por módulo) leídos
 * de la tabla `plan_configs` (con caché + fallback). Lo consumen los client
 * components que muestran precios sin importar nada hardcodeado
 * (subscription-tab, paso 3 del registro, etc.).
 */
export async function GET() {
  const plans = await getResolvedPlans();
  return NextResponse.json({ plans });
}
