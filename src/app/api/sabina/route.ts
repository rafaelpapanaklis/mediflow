import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { persistentRateLimit } from "@/lib/failban";
import { addAiTokens, aiTokenLimitError } from "@/lib/ai-tokens";
import { canSpend } from "@/lib/ai-billing/wallet";
import { recordUsageNoCharge } from "@/lib/ai-billing/record-usage";
import {
  appendMessages,
  createConversation,
  getConversation,
  isAiHistoryStorageMissing,
} from "@/lib/ai-assistant/conversations";
import { ejecutarSabina } from "@/lib/sabina/engine";
import { AI_FEATURE_SABINA, SABINA_TOOLS } from "@/lib/sabina/engine-catalog";
import { SABINA_MAX_PREGUNTA_CHARS, construirRastro } from "@/lib/sabina/engine-core";

/**
 * POST /api/sabina
 *   → { pregunta: string, conversacionId?: string }
 *   ← { respuesta, herramientasUsadas, conversacionId, tokens:{entrada,salida}, modelo }
 *
 * 401 sin sesión · 402 sin saldo · 429 pasado el límite · 503 si el modelo no
 * responde. NUNCA un 500 mudo: el catch final también contesta con su motivo.
 *
 * Sabina vive AL LADO del Asistente IA actual; no lo toca ni lo sustituye.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const arranque = Date.now();

  try {
    /* ── 1. Quién pregunta ─────────────────────────────────────────── */
    const ctx = await getAuthContext();
    if (!ctx) {
      return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
    }

    /* ── 2. Freno de gasto por CLÍNICA (no por IP: el consultorio la
          comparte), igual que /api/consult/ai-assist ─────────────────── */
    const rl = await persistentRateLimit(req, {
      id: `sabina:${ctx.clinicId}`,
      limit: 20,
      windowSec: 300,
    });
    if (rl) return rl;

    /* ── 3. La cuota del plan ──────────────────────────────────────── */
    const limite = await aiTokenLimitError(ctx.clinicId);
    if (limite) return NextResponse.json(limite, { status: 429 });

    /* ── 4. El monedero ────────────────────────────────────────────── */
    if (!(await canSpend(ctx.clinicId))) {
      return NextResponse.json(
        {
          error: "El monedero de IA de la clínica se quedó sin saldo. Recárgalo para seguir usando a Sabina.",
          sinSaldo: true,
          isAdmin: ctx.isAdmin,
        },
        { status: 402 },
      );
    }

    /* ── 5. La pregunta ────────────────────────────────────────────── */
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Body inválido" }, { status: 400 });
    }
    const pregunta =
      typeof body.pregunta === "string" ? body.pregunta.trim().slice(0, SABINA_MAX_PREGUNTA_CHARS) : "";
    if (!pregunta) {
      return NextResponse.json({ error: "Escribe una pregunta." }, { status: 400 });
    }
    const conversacionPedida =
      typeof body.conversacionId === "string" && body.conversacionId.trim()
        ? body.conversacionId.trim()
        : null;

    /* ── 6. El hilo previo (si lo hay). Va con el scope de la SESIÓN:
          clínica y usuario, nunca lo que mande el cliente ─────────────── */
    const scope = { clinicId: ctx.clinicId, userId: ctx.userId };
    let historial: Array<{ role: "user" | "assistant"; content: string }> = [];
    if (conversacionPedida) {
      try {
        const previa = await getConversation(scope, conversacionPedida);
        if (previa) {
          historial = previa.messages.map((m) => ({ role: m.role, content: m.content }));
        }
      } catch (e) {
        if (!isAiHistoryStorageMissing(e)) throw e;
      }
    }

    /* ── 7. El bucle. El clinicId lo pone AQUÍ el servidor ──────────── */
    const salida = await ejecutarSabina({
      ctx: { clinicId: ctx.clinicId, userId: ctx.userId, ahora: new Date() },
      usuario: { role: ctx.role, permissionsOverride: ctx.permissionsOverride },
      pregunta,
      historial,
      tools: SABINA_TOOLS,
      conversacionId: conversacionPedida,
    });

    /* ── 8. Cobrar SIEMPRE lo que se gastó, aunque la respuesta fallara:
          los tokens ya se los quedó Anthropic ────────────────────────── */
    const totalTokens = salida.tokens.entrada + salida.tokens.salida;
    if (totalTokens > 0) {
      // Cupo del plan. El slug va a "other" porque AI_FEATURES es una unión
      // CERRADA en src/lib/ai-tokens.ts y ese archivo no es de esta tarea;
      // añadir "sabina" allí es una línea, y está en el punto 6 del reporte.
      await addAiTokens(ctx.clinicId, totalTokens, "other", ctx.userId);
      // Costo real para la Tesorería. billedCents = 0: el plan lo absorbe, a la
      // clínica NO se le cobra dinero nuevo por Sabina (ver punto 4).
      await recordUsageNoCharge({
        clinicId: ctx.clinicId,
        feature: AI_FEATURE_SABINA,
        model: salida.modelo,
        inputTokens: salida.tokens.entrada,
        outputTokens: salida.tokens.salida,
      });
    }

    /* ── 9. Si el modelo no contestó → 503, nunca un 500 mudo ───────── */
    if (salida.fallo) {
      return NextResponse.json(
        { error: "Sabina no pudo contestar en este momento. Inténtalo de nuevo." },
        { status: 503 },
      );
    }

    /* ── 10. La conversación guardada. AQUÍ —y solo aquí— viven el texto
           de la pregunta y el de la respuesta ─────────────────────────── */
    let conversacionId = conversacionPedida;
    try {
      if (conversacionId) {
        const ok = await appendMessages(scope, conversacionId, [
          { role: "user", content: pregunta },
          { role: "assistant", content: salida.respuesta },
        ]);
        if (!ok) conversacionId = null; // no era suya: se abre una nueva
      }
      if (!conversacionId) {
        const nueva = await createConversation(scope, {
          group: "admin",
          messages: [
            { role: "user", content: pregunta },
            { role: "assistant", content: salida.respuesta },
          ],
        });
        conversacionId = nueva.conversation.id;
      }
    } catch (e) {
      // El .sql del historial se aplica a mano; si la tabla aún no está, la
      // respuesta sigue su camino sin guardarse (mismo criterio que /api/ai).
      if (!isAiHistoryStorageMissing(e)) throw e;
    }

    /* ── 11. El rastro. Por LISTA BLANCA: ni la pregunta ni la respuesta
           salen a los logs, pueden llevar datos de paciente ───────────── */
    console.info(
      "[sabina]",
      construirRastro({
        clinicId: ctx.clinicId,
        userId: ctx.userId,
        conversacionId,
        modelo: salida.modelo,
        dificultad: salida.dificultad,
        escalado: salida.escalado,
        herramientas: salida.herramientasUsadas,
        rondas: salida.rondas,
        tokensEntrada: salida.tokens.entrada,
        tokensSalida: salida.tokens.salida,
        ms: Date.now() - arranque,
        sinPermiso: salida.sinPermiso,
      }),
    );

    return NextResponse.json({
      respuesta: salida.respuesta,
      herramientasUsadas: salida.herramientasUsadas,
      conversacionId,
      tokens: salida.tokens,
      modelo: salida.modelo,
    });
  } catch (err) {
    // Sin texto de la pregunta en el log, por lo mismo de siempre.
    console.error("[sabina] fallo no previsto", err);
    return NextResponse.json(
      { error: "Sabina no está disponible en este momento." },
      { status: 503 },
    );
  }
}
