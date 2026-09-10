import "server-only";
import { hasPermission } from "@/lib/auth/permissions";
import {
  SABINA_CALL_TIMEOUT_MS,
  SABINA_MAX_OUTPUT_TOKENS,
  SABINA_MAX_TOOL_ROUNDS,
  SABINA_TURN_BUDGET_MS,
  clasificarDificultad,
  construirSystemPrompt,
  debeEscalar,
  garantizarAvisoSinPermiso,
  modeloPara,
  resultadoParaModelo,
  toolsParaModelo,
  validarLlamada,
  zodAJsonSchema,
} from "./engine-core";
import type { ValidacionFallo } from "./engine-core";
import type {
  SabinaCtx,
  SabinaDificultad,
  SabinaRespuesta,
  SabinaResultado,
  SabinaResultadoFallo,
  SabinaTool,
  SabinaUsuario,
} from "./engine-types";

/**
 * Sabina — el bucle.
 *
 * Recibe la pregunta, decide el modelo, le ofrece las herramientas, ejecuta lo
 * que el modelo elija (nunca a ciegas) y le devuelve el resultado hasta que
 * pueda contestar.
 *
 * El criterio es el de `src/lib/barber/bot.ts`, que ya corre esto en
 * producción: presupuesto de tiempo para todo el turno, AbortSignal por
 * llamada, tope de rondas y última vuelta SIN herramientas para que el modelo
 * cierre con palabras. Tres diferencias, todas explicadas en el reporte:
 * elección de modelo por dificultad, segunda pasada al modelo caro, y el
 * `sin_permiso` con red de seguridad en código.
 */

/* ── La llamada al modelo, aislada para poder probar el bucle sin red ── */

export interface BloqueModelo {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export interface TurnoModelo {
  bloques: BloqueModelo[];
  stopReason: string | null;
  tokensEntrada: number;
  tokensSalida: number;
  error: string | null;
}

export interface LlamadaModelo {
  modelo: string;
  system: string;
  messages: unknown[];
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  signal: AbortSignal;
}

export type LlamarModelo = (args: LlamadaModelo) => Promise<TurnoModelo>;

/**
 * La llamada de verdad. `fetch` directo y no `@anthropic-ai/sdk` por lo mismo
 * que `barber/bot.ts` y `/api/consult/ai-assist`: la versión instalada es la
 * 0.91 y el resto del repo habla con la API por HTTP. Un segundo estilo aquí
 * solo añade una forma más de equivocarse.
 */
export const llamarAnthropic: LlamarModelo = async (args) => {
  const vacio: TurnoModelo = {
    bloques: [],
    stopReason: null,
    tokensEntrada: 0,
    tokensSalida: 0,
    error: null,
  };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ...vacio, error: "sin_api_key" };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: args.modelo,
        max_tokens: SABINA_MAX_OUTPUT_TOKENS,
        system: args.system,
        messages: args.messages,
        ...(args.tools.length > 0 ? { tools: args.tools } : {}),
      }),
      signal: args.signal,
    });

    if (!res.ok) {
      const cuerpo = await res.text().catch(() => "");
      return { ...vacio, error: `claude_${res.status}: ${cuerpo.slice(0, 180)}` };
    }

    const data = await res.json();
    return {
      bloques: Array.isArray(data?.content) ? (data.content as BloqueModelo[]) : [],
      stopReason: typeof data?.stop_reason === "string" ? data.stop_reason : null,
      tokensEntrada: Number(data?.usage?.input_tokens) || 0,
      tokensSalida: Number(data?.usage?.output_tokens) || 0,
      error: null,
    };
  } catch (err) {
    return { ...vacio, error: err instanceof Error ? err.message : "fallo de red" };
  }
};

/* ── Ejecutar UNA herramienta ─────────────────────────────────────────── */

/**
 * Comprueba el permiso y ejecuta. El permiso se mira ANTES de tocar la base:
 * un `sin_permiso` no puede costar una consulta, y sobre todo no puede
 * devolver datos que luego «se omitan» en la redacción.
 */
export async function ejecutarHerramienta(
  tool: SabinaTool<any, any>,
  ctx: SabinaCtx,
  usuario: SabinaUsuario,
  params: unknown,
): Promise<SabinaResultado> {
  if (!hasPermission({ role: usuario.role, permissionsOverride: usuario.permissionsOverride }, tool.permiso)) {
    return { ok: false, motivo: "sin_permiso", permiso: tool.permiso };
  }
  try {
    const datos = await tool.ejecutar(ctx, params);
    // Una herramienta bien escrita ya devuelve el SabinaResultado del contrato.
    // Si devolviera el dato pelado, se envuelve aquí en vez de reventar.
    if (datos && typeof datos === "object" && "ok" in (datos as Record<string, unknown>)) {
      return datos as SabinaResultado;
    }
    return { ok: true, datos, resumen: "" };
  } catch (err) {
    return {
      ok: false,
      motivo: "error",
      detalle: err instanceof Error ? err.message : "la consulta falló",
    };
  }
}

/* ── El bucle ─────────────────────────────────────────────────────────── */

export interface SabinaEjecutarInput {
  ctx: SabinaCtx;
  usuario: SabinaUsuario;
  pregunta: string;
  /** Turnos previos de la conversación guardada, ya en orden. */
  historial?: ReadonlyArray<{ role: "user" | "assistant"; content: string }>;
  tools: readonly SabinaTool<any, any>[];
  conversacionId?: string | null;
  /** Seam de pruebas: por defecto la llamada real. */
  llamar?: LlamarModelo;
  /** Seam de pruebas: reloj. */
  ahora?: () => number;
  /** Seam de pruebas: presupuesto del turno. */
  presupuestoMs?: number;
}

export async function ejecutarSabina(input: SabinaEjecutarInput): Promise<SabinaRespuesta> {
  const llamar = input.llamar ?? llamarAnthropic;
  const ahora = input.ahora ?? (() => Date.now());
  const presupuesto = input.presupuestoMs ?? SABINA_TURN_BUDGET_MS;
  const arranque = ahora();
  const limite = arranque + presupuesto;

  const dificultad: SabinaDificultad = clasificarDificultad(input.pregunta);
  const hoy = (input.ctx.ahora ?? new Date()).toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const esquemas = toolsParaModelo(input.tools, (t) => zodAJsonSchema(t.parametros));

  const messages: unknown[] = [
    ...(input.historial ?? []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.pregunta },
  ];

  const herramientasUsadas: string[] = [];
  const sinPermiso: string[] = [];
  let tokensEntrada = 0;
  let tokensSalida = 0;
  let rondas = 0;
  let respuesta: string | null = null;
  let fallo = false;
  let escalado = false;
  let modelo = modeloPara(dificultad);

  // Dos pasadas como mucho: la barata y, si no cerró, la cara — con los datos
  // que la barata YA trajo, así que la segunda no vuelve a consultar la base.
  for (let pasada = 0; pasada < 2; pasada++) {
    let rondasAgotadas = false;

    for (let ronda = 0; ronda <= SABINA_MAX_TOOL_ROUNDS; ronda++) {
      const queda = limite - ahora();
      if (queda <= 1_500) {
        rondasAgotadas = true;
        break;
      }

      const controlador = new AbortController();
      const reloj = setTimeout(
        () => controlador.abort(),
        Math.min(SABINA_CALL_TIMEOUT_MS, queda),
      );
      const turno = await llamar({
        modelo,
        system: construirSystemPrompt({ dificultad, hoy }),
        messages,
        // Última vuelta sin herramientas: el modelo tiene que cerrar con
        // palabras, no pedir otra consulta que ya no cabe.
        tools: ronda === SABINA_MAX_TOOL_ROUNDS ? [] : esquemas,
        signal: controlador.signal,
      });
      clearTimeout(reloj);

      rondas += 1;
      tokensEntrada += turno.tokensEntrada;
      tokensSalida += turno.tokensSalida;

      if (turno.error) {
        // El texto de la pregunta NO viaja al log; sí el motivo y la clínica.
        console.error("[sabina] el modelo no respondió", {
          clinicId: input.ctx.clinicId,
          modelo,
          error: turno.error,
        });
        fallo = true;
        break;
      }

      const texto = turno.bloques
        .filter((b) => b.type === "text")
        .map((b) => (b.text ?? "").trim())
        .filter(Boolean)
        .join("\n")
        .trim();

      const llamadas = turno.bloques.filter((b) => b.type === "tool_use");

      if (llamadas.length === 0 || turno.stopReason !== "tool_use") {
        respuesta = texto || null;
        break;
      }

      if (ronda === SABINA_MAX_TOOL_ROUNDS) {
        rondasAgotadas = true;
        break;
      }

      // El bloque del asistente vuelve TAL CUAL (con sus tool_use) o la API
      // rechaza el tool_result que sigue.
      messages.push({ role: "assistant", content: turno.bloques });

      const resultados: unknown[] = [];
      for (const llamada of llamadas) {
        const nombre = llamada.name ?? "";
        const validacion = validarLlamada(input.tools, nombre, llamada.input);

        if (!validacion.ok) {
          // Herramienta inventada o parámetros basura: se le dice al modelo y
          // NO se ejecuta nada.
          const rechazo = validacion as ValidacionFallo;
          resultados.push({
            type: "tool_result",
            tool_use_id: llamada.id,
            is_error: true,
            content: JSON.stringify({ ok: false, motivo: "error", detalle: rechazo.detalle }),
          });
          continue;
        }

        const resultado = await ejecutarHerramienta(
          validacion.tool,
          input.ctx,
          input.usuario,
          validacion.params,
        );
        if (!herramientasUsadas.includes(nombre)) herramientasUsadas.push(nombre);
        const fallado = resultado as SabinaResultadoFallo;
        if (resultado.ok !== true && fallado.motivo === "sin_permiso" && !sinPermiso.includes(fallado.permiso)) {
          sinPermiso.push(fallado.permiso);
        }

        resultados.push({
          type: "tool_result",
          tool_use_id: llamada.id,
          content: resultadoParaModelo(resultado),
        });
      }

      // TODOS los tool_result en UN SOLO mensaje de usuario.
      messages.push({ role: "user", content: resultados });
    }

    if (fallo) break;

    const escalar = debeEscalar({
      dificultad,
      yaEscalado: escalado,
      respuesta,
      rondasAgotadas,
      huboHerramientas: herramientasUsadas.length > 0,
    });
    if (!escalar) break;
    if (limite - ahora() <= 2_000) break; // sin tiempo para otra pasada

    escalado = true;
    modelo = modeloPara("abierta");
  }

  const texto = garantizarAvisoSinPermiso(respuesta ?? "", sinPermiso);

  return {
    respuesta: texto,
    herramientasUsadas,
    tokens: { entrada: tokensEntrada, salida: tokensSalida },
    modelo,
    dificultad,
    escalado,
    rondas,
    sinPermiso,
    fallo: fallo || texto.trim().length === 0,
  };
}
