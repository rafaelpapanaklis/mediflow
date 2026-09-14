import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { descartarPropuesta } from "@/lib/sabina/engine-propuestas";
import { FRASE, origenValido } from "@/lib/sabina/engine-propuestas-core";
import { crearSabinaCtx } from "@/lib/sabina/tipos";

/**
 * POST /api/sabina/propuestas/:id/descartar   (cuerpo JSON, p. ej. `{}`)
 *   ← { propuesta: SabinaPropuestaVista, ahora }
 *
 * El usuario dijo que no. Queda en el rastro y la propuesta ya no se puede
 * confirmar. 200 descartada · 409 ya no estaba pendiente (trae su estado) ·
 * 404 no existe o no es suya.
 */

export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    if (!origenValido(req.headers)) {
      return NextResponse.json({ error: "origen_invalido" }, { status: 403 });
    }
    if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
      return NextResponse.json({ error: "se_espera_json" }, { status: 415 });
    }

    const ctx = await getAuthContext();
    const sabinaCtx = crearSabinaCtx(ctx);
    if (!ctx || !sabinaCtx) {
      return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
    }

    const desenlace = await descartarPropuesta({ ctx: sabinaCtx, id: params.id, req });
    if (!desenlace.vista) {
      return NextResponse.json(
        { error: "no_encontrada", resultado: { ok: false, tipo: "no_encontrada", frase: FRASE.noEncontrada } },
        { status: 404 },
      );
    }
    return NextResponse.json({ propuesta: desenlace.vista, ahora: Date.now() }, { status: desenlace.http });
  } catch (err) {
    console.error("[sabina] fallo no previsto al descartar una propuesta", {
      err: err instanceof Error ? err.message : "desconocido",
    });
    return NextResponse.json({ error: "no_disponible" }, { status: 503 });
  }
}
