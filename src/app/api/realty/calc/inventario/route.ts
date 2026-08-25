// GET /api/realty/calc/inventario?min=&max= — cuántos inmuebles PROPIOS
// entran en el presupuesto que acaba de salir del precalificador.
//
// Es la pieza que convierte una calculadora en una venta: el prospecto no se
// va con un número abstracto, se va con "hay 7 casas que te quedan".
//
// Devuelve un CONTEO, no las fichas. El listado lo pinta la pantalla de
// inmuebles con su propio control de acceso; aquí no se filtra media cartera
// al navegador para pintar un número.
import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCalcApi } from "../_guard";

export const dynamic = "force-dynamic";

function pesosDesdeCentavos(raw: string | null): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n) / 100;
}

export async function GET(req: NextRequest) {
  // properties.view: cuenta inmuebles de la cartera.
  const guard = await requireCalcApi("properties.view");
  if (!guard.ok) return guard.res;
  const ctx = guard.ctx!;

  const max = pesosDesdeCentavos(req.nextUrl.searchParams.get("max"));
  if (max === null || max <= 0) return NextResponse.json({ count: 0 });

  // Solo techo, sin piso: a un comprador con dos millones le sirve ver una
  // casa de millón y medio. Poner un mínimo escondería justo las que más
  // fácil se cierran.
  try {
    const count = await prisma.realtyProperty.count({
      where: {
        accountId: ctx.accountId,
        operation: "VENTA",
        status: "DISPONIBLE",
        // Solo pesos: comparar un presupuesto en MXN contra un precio en USD
        // daría un conteo que no significa nada.
        currency: "MXN",
        price: { gt: new Prisma.Decimal(0), lte: new Prisma.Decimal(String(max)) },
      },
    });
    return NextResponse.json({ count });
  } catch (e) {
    console.error("[realty-calc] conteo de inventario falló:", e);
    return NextResponse.json({ count: 0 });
  }
}
