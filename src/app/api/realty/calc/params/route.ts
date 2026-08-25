// GET /api/realty/calc/params — los parámetros vigentes de las calculadoras.
//
// PÚBLICO a propósito: son tasas de impuestos, valores del INPC y topes de
// crédito publicados en el DOF. No hay nada de ninguna cuenta aquí (la tabla
// ni siquiera tiene accountId), así que no hay nada que filtrar.
//
// Existe para que una pantalla pública —la ficha de un inmueble, por
// ejemplo— pueda pintar el estimado de escrituración sin importar código de
// servidor. Un componente de servidor no la necesita: puede llamar
// directamente a getCalcParamRows().
import { NextResponse } from "next/server";
import { getCalcParamRows } from "@/lib/realty/calc/params";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await getCalcParamRows();
  return NextResponse.json(
    { rows },
    {
      headers: {
        // Cambian una vez al año: media hora de caché en el borde no le hace
        // daño a nadie y le quita a Postgres una consulta por visita.
        "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
      },
    },
  );
}
