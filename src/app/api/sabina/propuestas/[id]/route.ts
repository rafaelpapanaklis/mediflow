import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { consultarPropuesta } from "@/lib/sabina/engine-propuestas";
import { FRASE } from "@/lib/sabina/engine-propuestas-core";

/**
 * GET /api/sabina/propuestas/:id
 *   ← { propuesta: SabinaPropuestaVista, ahora }
 *
 * SOLO LECTURA: en qué quedó una propuesta. La pantalla la usa para «Consultar
 * qué pasó» cuando se cortó la red al confirmar —volver a POSTear confirmar
 * podría ser la PRIMERA confirmación, sin la casilla ni la pausa de la tarjeta— y
 * para refrescar tarjetas cuya copia local puede estar vieja.
 *
 * 404 si no existe o no es de esta clínica y de este usuario (el mismo 404).
 */

export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getAuthContext();
    if (!ctx?.clinicId || !ctx?.userId) {
      return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
    }
    const vista = await consultarPropuesta({ ctx: { clinicId: ctx.clinicId, userId: ctx.userId }, id: params.id });
    if (!vista) {
      return NextResponse.json(
        { error: "no_encontrada", resultado: { ok: false, tipo: "no_encontrada", frase: FRASE.noEncontrada } },
        { status: 404 },
      );
    }
    return NextResponse.json({ propuesta: vista, ahora: Date.now() });
  } catch (err) {
    console.error("[sabina] fallo no previsto al consultar una propuesta", {
      err: err instanceof Error ? err.message : "desconocido",
    });
    return NextResponse.json({ error: "no_disponible" }, { status: 503 });
  }
}
