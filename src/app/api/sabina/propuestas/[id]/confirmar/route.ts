import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { persistentRateLimit } from "@/lib/failban";
import { ACCIONES_SABINA } from "@/lib/sabina/engine-catalog";
import { confirmarPropuesta } from "@/lib/sabina/engine-propuestas";
import { FRASE, origenValido } from "@/lib/sabina/engine-propuestas-core";
import { crearSabinaCtx } from "@/lib/sabina/tipos";

/**
 * POST /api/sabina/propuestas/:id/confirmar   (cuerpo JSON, p. ej. `{}`)
 *   ← { propuesta: SabinaPropuestaVista, ahora }
 *
 * La FASE 2. Es la única puerta por la que una propuesta de Sabina escribe, y la
 * dispara el botón de la tarjeta: el modelo no tiene herramienta que llegue aquí,
 * y un «sí» escrito en el chat no la llama.
 *
 * 200 se ejecutó (mira `propuesta.estado`: `hecha` o `fallida`, con la frase) ·
 * 404 no existe, o no es de esta clínica o de este usuario (el mismo 404) ·
 * 409 ya se usó, se descartó o la reemplazó otra (trae el resultado que quedó) ·
 * 410 caducó · 401 sin sesión · 403 desde otro origen · 415 sin JSON · 429.
 * Nunca un 500 mudo.
 *
 * Todo lo que decide está en `confirmarPropuesta` (engine-propuestas.ts).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Params {
  params: { id: string };
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    // Confirmar escribe: no se acepta desde otro sitio, ni como formulario simple.
    if (!origenValido(req.headers)) {
      return NextResponse.json({ error: "origen_invalido" }, { status: 403 });
    }
    if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
      return NextResponse.json({ error: "se_espera_json" }, { status: 415 });
    }

    const ctx = await getAuthContext();
    const sabinaCtx = await crearSabinaCtx(ctx);
    if (!ctx || !sabinaCtx) {
      return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
    }

    const rl = await persistentRateLimit(req, {
      id: `${ctx.clinicId}:${ctx.userId}`,
      scope: "sabina-propuestas",
      limit: 30,
      windowSec: 300,
    });
    if (rl) return rl;

    const desenlace = await confirmarPropuesta({
      ctx: sabinaCtx,
      id: params.id,
      req,
      acciones: ACCIONES_SABINA,
    });
    if (!desenlace.vista) {
      return NextResponse.json(
        { error: "no_encontrada", resultado: { ok: false, tipo: "no_encontrada", frase: FRASE.noEncontrada } },
        { status: 404 },
      );
    }
    return NextResponse.json({ propuesta: desenlace.vista, ahora: Date.now() }, { status: desenlace.http });
  } catch (err) {
    console.error("[sabina] fallo no previsto al confirmar una propuesta", {
      err: err instanceof Error ? err.message : "desconocido",
    });
    return NextResponse.json(
      { error: "no_disponible", resultado: { ok: false, tipo: "error", frase: FRASE.errorInterno } },
      { status: 503 },
    );
  }
}
