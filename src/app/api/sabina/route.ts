import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { persistentRateLimit } from "@/lib/failban";
import { canSpend, chargeUsage } from "@/lib/ai-billing/wallet";
import { isAiHistoryStorageMissing } from "@/lib/ai-assistant/conversations";
import { ejecutarSabina } from "@/lib/sabina/engine";
import { AI_FEATURE_SABINA, SABINA_TOOLS } from "@/lib/sabina/engine-catalog";
import { SABINA_MAX_PREGUNTA_CHARS, construirRastro } from "@/lib/sabina/engine-core";
import {
  anexarTurnosSabina,
  crearConversacionSabina,
  leerConversacionSabina,
} from "@/lib/sabina/engine-historial";
import { guardarPropuesta, propuestasDeConversacion } from "@/lib/sabina/engine-propuestas";
import type { SabinaPropuestaVista } from "@/lib/sabina/engine-propuestas-core";
import { FRASE_SABINA_APAGADA } from "@/lib/sabina/permisos-sabina";
import { crearSabinaCtx } from "@/lib/sabina/tipos";
import { bloqueDeContexto, resolverContextoSabina } from "@/lib/sabina/contexto";

/**
 * POST /api/sabina
 *   → { pregunta: string, conversacionId?: string,
 *       contexto?: { pantalla?: string, pacienteId?: string, fecha?: string } }
 *   ← { respuesta, herramientasUsadas, conversacionId, tokens:{entrada,salida}, modelo,
 *       propuestas?: SabinaPropuestaVista[], ahora? }
 *
 * `propuestas` (solo si las hay) es lo que Sabina PROPUSO hacer, sin hacerlo: la pantalla lo pinta
 * como tarjeta y solo se ejecuta con POST /api/sabina/propuestas/:id/confirmar.
 * `ahora` es el reloj del servidor, para que la cuenta atrás de la tarjeta no
 * dependa del reloj del navegador.
 *
 * 401 sin sesión · 403 `{ sabinaApagada: true }` si el Super Admin apagó a Sabina
 * para este usuario · 402 sin saldo · 429 pasado el límite · 503 si el modelo no
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
    // El ctx de las herramientas: clínica, persona, rol, permisos y zona
    // horaria, TODO de la sesión. `null` si algo puede faltar — con
    // `clinicId: undefined` Prisma no filtra y se leerían todas las clínicas.
    // Los permisos ya vienen recortados a lo que el Super Admin deja hacer a
    // Sabina en nombre de este usuario (nunca más de lo que él puede).
    const sabinaCtx = await crearSabinaCtx(ctx);
    if (!ctx || !sabinaCtx) {
      return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
    }

    /* ── 1b. Apagada para este usuario: ni consultar. Antes del freno y del
          monedero, que no se gaste nada en decir que no ───────────────── */
    if (sabinaCtx.sabina?.apagada) {
      return NextResponse.json({ error: FRASE_SABINA_APAGADA, sabinaApagada: true }, { status: 403 });
    }

    /* ── 2. Freno de gasto por CLÍNICA (no por IP: el consultorio la
          comparte), igual que /api/consult/ai-assist ─────────────────── */
    const rl = await persistentRateLimit(req, {
      id: `sabina:${ctx.clinicId}`,
      limit: 20,
      windowSec: 300,
    });
    if (rl) return rl;

    /* ── 3. El monedero. Sabina se paga con el saldo de la clínica, como
          el bot de WhatsApp, y NO con el cupo de IA del plan: descontar de
          los dos cobraría dos veces el mismo token, y dejaría sin cupo al
          Asistente IA de una clínica que ya pagó en pesos ──────────────── */
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

    /* ── 5b. Dónde estaba quien pregunta (ws1-t1). Es una PISTA, no una
          llave: el `pacienteId` que manda la pantalla se vuelve a comprobar
          aquí contra la sesión —clínica, visibilidad, `deletedAt` y
          `patients.view`— y si no pasa, se cae en silencio y la pregunta
          sigue sin él. Nunca autoriza nada: las herramientas lo comprueban
          todo otra vez por su cuenta ─────────────────────────────────── */
    let contexto: string | null = null;
    try {
      contexto = bloqueDeContexto(await resolverContextoSabina(sabinaCtx, body.contexto)) || null;
    } catch (e) {
      // Sin contexto se contesta igual que antes de que Sabina viviera en un
      // cajón. Nunca es motivo para tirar la pregunta.
      console.error("[sabina] no se pudo resolver el contexto de pantalla", {
        clinicId: ctx.clinicId,
        err: e instanceof Error ? e.message : "desconocido",
      });
      contexto = null;
    }

    /* ── 6. El hilo previo (si lo hay). Va con el scope de la SESIÓN:
          clínica y usuario, nunca lo que mande el cliente. Y solo si es una
          conversación de SABINA: un id del Asistente IA no es contexto ─── */
    const scope = { clinicId: ctx.clinicId, userId: ctx.userId };
    let historial: Array<{ role: "user" | "assistant"; content: string }> = [];
    let conversacionPrevia: string | null = null;
    if (conversacionPedida) {
      try {
        const previa = await leerConversacionSabina(scope, conversacionPedida);
        if (previa) {
          conversacionPrevia = conversacionPedida;
          historial = previa.messages.map((m) => ({ role: m.role, content: m.content }));
        }
      } catch (e) {
        if (!isAiHistoryStorageMissing(e)) throw e;
      }
    }

    /* ── 6b. ¿Hay una tarjeta de ESTE hilo esperando el botón? El historial
          es solo texto: sin esto, el motor no distingue «confírmalo en la
          tarjeta» de verdad del de una tarjeta que nunca se preparó (el fallo
          en vivo del 14-sep-2026). Si la lectura falla, se sigue como si no
          hubiera: lo peor es que Sabina vuelva a preparar la propuesta ─── */
    let tarjetaPendiente: string | null = null;
    if (conversacionPrevia) {
      try {
        const previas = await propuestasDeConversacion({ ctx: sabinaCtx, conversacionId: conversacionPrevia });
        tarjetaPendiente = previas.filter((p) => p.estado === "pendiente").pop()?.tarjeta.frase ?? null;
      } catch (e) {
        console.error("[sabina] no se pudo leer si hay una propuesta pendiente", {
          clinicId: ctx.clinicId,
          err: e instanceof Error ? e.message : "desconocido",
        });
      }
    }

    /* ── 7. El bucle. El clinicId lo pone AQUÍ el servidor ──────────── */
    const salida = await ejecutarSabina({
      ctx: sabinaCtx,
      pregunta,
      historial,
      tools: SABINA_TOOLS,
      conversacionId: conversacionPrevia,
      tarjetaPendiente,
      contexto,
    });

    /* ── 8. Cobrar SIEMPRE lo que se gastó, aunque la respuesta fallara:
          los tokens ya se los quedó Anthropic ────────────────────────── */
    // Del MONEDERO de la clínica, igual que el bot de WhatsApp (chatMetered):
    // canSpend arriba como puerta, chargeUsage después de la llamada real, y un
    // fallo del cobro no le quita al doctor la respuesta que ya se pagó a
    // Anthropic. Un cargo —y su AiUsageEvent— por MODELO, con sus tokens: cada
    // cargo se cobra al precio de SU modelo (`pricing-core.ts`, #242); lo fija
    // `npm run test:sabina-cobro` con el monedero de verdad.
    for (const uso of salida.consumo) {
      if (uso.entrada + uso.salida <= 0) continue;
      try {
        await chargeUsage({
          clinicId: ctx.clinicId,
          feature: AI_FEATURE_SABINA,
          model: uso.modelo,
          inputTokens: uso.entrada,
          outputTokens: uso.salida,
        });
      } catch (e) {
        console.error("[sabina] no se pudo cobrar el consumo al monedero", {
          clinicId: ctx.clinicId,
          modelo: uso.modelo,
          err: e instanceof Error ? e.message : "desconocido",
        });
      }
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
    let conversacionId = conversacionPrevia;
    const turnos: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: pregunta },
      { role: "assistant", content: salida.respuesta },
    ];
    try {
      if (conversacionId) {
        const ok = await anexarTurnosSabina(scope, conversacionId, turnos);
        if (!ok) conversacionId = null; // no era suya o no es de Sabina: se abre una nueva
      }
      if (!conversacionId) {
        conversacionId = await crearConversacionSabina(scope, turnos);
      }
    } catch (e) {
      // El .sql del historial se aplica a mano; si la tabla aún no está, la
      // respuesta sigue su camino sin guardarse (mismo criterio que /api/ai).
      // Y cualquier otro fallo al guardar, igual: la respuesta YA se cobró, y
      // un 503 aquí la tiraría y la pantalla ofrecería reintentar — y cobrar
      // otra vez. Sin texto de la pregunta en el log.
      conversacionId = null;
      if (!isAiHistoryStorageMissing(e)) {
        console.error("[sabina] no se pudo guardar la conversación", {
          clinicId: ctx.clinicId,
          code: (e as { code?: string })?.code ?? null,
        });
      }
    }

    /* ── 11. Lo que Sabina propuso. Se guarda AQUÍ, después del bucle y
           fuera del candado de solo lectura: guardar una propuesta no es
           ejecutarla. Si no se puede guardar, no hay tarjeta y se dice ─── */
    let respuesta = salida.respuesta;
    const propuestas: SabinaPropuestaVista[] = [];
    for (const propuesta of salida.propuestas) {
      try {
        propuestas.push(
          await guardarPropuesta({
            ctx: sabinaCtx,
            propuesta,
            pedido: pregunta,
            conversacionId,
            modelo: salida.modelo,
            req,
          }),
        );
      } catch (e) {
        console.error("[sabina] no se pudo guardar la propuesta", {
          clinicId: ctx.clinicId,
          accion: propuesta.accion,
          err: e instanceof Error ? e.message : "desconocido",
        });
        respuesta = `${respuesta}\n\nNo pude dejar lista la propuesta para que la confirmes, así que no hay nada que confirmar. Pídemelo otra vez en un momento.`;
      }
    }

    /* ── 12. El rastro. Por LISTA BLANCA: ni la pregunta ni la respuesta
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
        propuestas: salida.propuestas.map((p) => p.accion),
      }),
    );

    return NextResponse.json({
      respuesta,
      herramientasUsadas: salida.herramientasUsadas,
      conversacionId,
      tokens: salida.tokens,
      modelo: salida.modelo,
      // Solo si hubo propuesta: sin ella la respuesta es la misma de siempre
      // (la fija `test:sabina-punta-a-punta`).
      ...(propuestas.length > 0 ? { propuestas, ahora: Date.now() } : {}),
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
