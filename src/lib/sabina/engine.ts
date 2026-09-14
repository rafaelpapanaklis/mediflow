import "server-only";
import {
  SABINA_CALL_TIMEOUT_MS,
  SABINA_MAX_OUTPUT_TOKENS,
  SABINA_MAX_TOOL_ROUNDS,
  SABINA_MAX_TURNOS_HISTORIAL,
  SABINA_TURN_BUDGET_MS,
  clasificarDificultad,
  construirSystemPrompt,
  debeEscalar,
  garantizarAvisoPropuesta,
  garantizarAvisoSinPermiso,
  garantizarAvisoSinPermisoAccion,
  hoyParaPrompt,
  modeloPara,
  resultadoParaModelo,
  toolsParaModelo,
  validarLlamada,
  zodAJsonSchema,
} from "./engine-core";
import type { ValidacionFallo, ValidacionLlamada } from "./engine-core";
import type {
  SabinaConsumo,
  SabinaCtx,
  SabinaDificultad,
  SabinaRespuesta,
  SabinaResultado,
  SabinaResultadoFallo,
  SabinaTool,
} from "./engine-types";
import { correrHerramienta } from "./tools/base";
import {
  accionDeHerramienta,
  fraseSinPermisoAccion,
  propuestaDeDatos,
  type DatosDeAccion,
  type PropuestaPreparada,
} from "./engine-acciones";
import { SABINA_MAX_PROPUESTAS_POR_TURNO } from "./engine-propuestas-core";
import { CandadoNoDisponible, EscrituraBloqueada, soloLectura } from "./engine-solo-lectura";
import { FRASE_SABINA_APAGADA, causaSinPermiso, type CausaSinPermiso } from "./permisos-sabina";

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
 * 🔴 Toda herramienta corre bajo `soloLectura` (engine-solo-lectura.ts). Dentro
 * del bucle del modelo NADA escribe —ni Prisma, ni un `fetch`/`http` que no sea
 * GET—, la herramienta sea de consulta, de acción o una que alguien escriba
 * mañana sin saber de este mecanismo. Escribir es la fase 2, y la fase 2 es otra
 * petición que dispara el usuario (POST /api/sabina/propuestas/:id/confirmar).
 * Si una herramienta lo intenta, su resultado es un `error` y queda en el log.
 *
 * Ejecuta por el runner de las herramientas (`correrHerramienta`), que corta en
 * el orden del contrato: sesión → permiso → parámetros → consulta. El permiso
 * se mira ANTES de tocar la base, con el rol y el override del ctx de la
 * sesión: un `sin_permiso` no puede costar una consulta, y sobre todo no puede
 * devolver datos que luego «se omitan» en la redacción. Y es el runner el que
 * produce el `resumen` y el `sin_datos`: llamando a `tool.ejecutar` directo, el
 * modelo recibía el dato sin su resumen y una lista vacía como `ok`.
 */
export async function ejecutarHerramienta(
  tool: SabinaTool<any, any>,
  ctx: SabinaCtx,
  params: unknown,
): Promise<SabinaResultado> {
  try {
    return await soloLectura(`herramienta ${tool.nombre}`, () => correrHerramienta(tool, ctx, params));
  } catch (e) {
    if (e instanceof EscrituraBloqueada || e instanceof CandadoNoDisponible) {
      console.error("[sabina] herramienta frenada por el candado de solo lectura", {
        clinicId: ctx.clinicId,
        herramienta: tool.nombre,
        detalle: e.message,
      });
      return { ok: false, motivo: "error", detalle: e.message };
    }
    return { ok: false, motivo: "error", detalle: e instanceof Error ? e.message : "error_desconocido" };
  }
}

/* ── El bucle ─────────────────────────────────────────────────────────── */

export interface SabinaEjecutarInput {
  /** De `await crearSabinaCtx(await getAuthContext())`: clínica, persona, rol, permisos (ya recortados para Sabina) y zona. */
  ctx: SabinaCtx;
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

  // Apagada para este usuario: ni una llamada al modelo. Las herramientas ya
  // dirían «sin permiso» a todo (el ctx no tiene ninguno), pero el modelo podría
  // contestar de memoria con el historial, y cada vuelta se cobra al monedero.
  // El endpoint corta antes; esto es para quien llame al motor por otro lado.
  if (input.ctx.sabina?.apagada) {
    return {
      respuesta: FRASE_SABINA_APAGADA,
      herramientasUsadas: [],
      tokens: { entrada: 0, salida: 0 },
      consumo: [],
      modelo: modeloPara(dificultad),
      dificultad,
      escalado: false,
      rondas: 0,
      sinPermiso: [],
      propuestas: [],
      fallo: false,
    };
  }

  // El «hoy» de la CLÍNICA, no el del proceso (UTC en Vercel): a las 19:00 de
  // México el servidor ya va en el día siguiente, y el modelo pediría las citas
  // de mañana.
  const hoy = hoyParaPrompt(new Date(arranque), input.ctx.timezone);

  const esquemas = toolsParaModelo(input.tools, (t) => zodAJsonSchema(t.parametros));
  const queHacen = input.tools
    .map((t) => accionDeHerramienta(t)?.queHace)
    .filter((q): q is string => typeof q === "string" && q.length > 0);

  // Solo los últimos turnos, y arrancando por uno del doctor: la API rechaza
  // una conversación que empieza con el asistente.
  const previos = (input.historial ?? []).slice(-SABINA_MAX_TURNOS_HISTORIAL);
  while (previos.length > 0 && previos[0].role !== "user") previos.shift();
  const messages: unknown[] = [
    ...previos.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.pregunta },
  ];

  const herramientasUsadas: string[] = [];
  const sinPermiso: string[] = [];
  const sinPermisoAcciones: Array<{ frase: string; queHace: string; permiso: string }> = [];
  const propuestas: PropuestaPreparada[] = [];
  let tokensEntrada = 0;
  let tokensSalida = 0;
  const consumo: SabinaConsumo[] = [];
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
        system: construirSystemPrompt({ dificultad, hoy, acciones: queHacen }),
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
      let delModelo = consumo.find((c) => c.modelo === modelo);
      if (!delModelo) {
        delModelo = { modelo, entrada: 0, salida: 0 };
        consumo.push(delModelo);
      }
      delModelo.entrada += turno.tokensEntrada;
      delModelo.salida += turno.tokensSalida;

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
        // El zod de una herramienta puede llevar `refine`/`transform`, que es
        // código: también valida bajo el candado.
        const validacion: ValidacionLlamada<any> = await soloLectura(`validar ${nombre}`, async () =>
          validarLlamada(input.tools, nombre, llamada.input),
        ).catch((e) => ({ ok: false as const, motivo: "parametros" as const, detalle: e instanceof Error ? e.message : "error" }));

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

        const accion = accionDeHerramienta(validacion.tool);

        const resultado = await ejecutarHerramienta(validacion.tool, input.ctx, validacion.params);
        if (!herramientasUsadas.includes(nombre)) herramientasUsadas.push(nombre);
        const fallado = resultado as SabinaResultadoFallo;
        let fraseSinPermiso: string | undefined;
        let causa: CausaSinPermiso | undefined;
        let sustituyeOtra = false;
        if (resultado.ok !== true && fallado.motivo === "sin_permiso") {
          // Solo la frase: quién no tenía el permiso, el usuario o Sabina. La
          // decisión ya la tomó el runner con el ctx recortado.
          causa = causaSinPermiso(input.ctx, fallado.permiso);
          if (accion) {
            fraseSinPermiso = fraseSinPermisoAccion(accion.queHace, causa);
            sinPermisoAcciones.push({ frase: fraseSinPermiso, queHace: accion.queHace, permiso: accion.permiso });
          } else if (!sinPermiso.includes(fallado.permiso)) {
            sinPermiso.push(fallado.permiso);
          }
        }
        if (accion && resultado.ok === true) {
          const datosAccion = resultado.datos as DatosDeAccion;
          if (datosAccion?.estado === "sin_permiso") {
            sinPermisoAcciones.push({ frase: datosAccion.frase, queHace: accion.queHace, permiso: accion.permiso });
          }
          // Solo una herramienta de acción REAL produce propuesta: se busca por la
          // referencia de sus datos, no por lo que diga el JSON.
          const propuesta = propuestaDeDatos(resultado.datos);
          if (propuesta) {
            // Una propuesta por turno, y vale la ÚLTIMA: si el modelo corrige la
            // suya (otro paciente tras buscar mejor, la pasada cara que arregla la
            // barata), la equivocada no sale (ver engine-propuestas-core.ts).
            sustituyeOtra = propuestas.length >= SABINA_MAX_PROPUESTAS_POR_TURNO;
            if (sustituyeOtra) propuestas.splice(0, propuestas.length - SABINA_MAX_PROPUESTAS_POR_TURNO + 1);
            propuestas.push(propuesta);
          }
        }
        // Una herramienta compuesta (`resumen_clinica`) contesta `ok` y apunta en
        // `datos.omitidas` las secciones que el usuario no puede ver. También
        // entran a la red de la regla 3: si el modelo se calla la parte de
        // dinero, el aviso lo pone el motor.
        const omitidas = resultado.ok === true ? (resultado.datos as { omitidas?: unknown })?.omitidas : null;
        if (Array.isArray(omitidas)) {
          for (const o of omitidas) {
            const permiso = (o as { permiso?: unknown })?.permiso;
            if (typeof permiso === "string" && permiso && !sinPermiso.includes(permiso)) sinPermiso.push(permiso);
          }
        }

        resultados.push({
          type: "tool_result",
          tool_use_id: llamada.id,
          content: sustituyeOtra
            ? JSON.stringify({
                ...JSON.parse(resultadoParaModelo(resultado, { fraseSinPermiso, causa })),
                sustituye: "Esta propuesta SUSTITUYE a la que preparaste antes en este turno: el usuario solo verá esta. Una propuesta a la vez.",
              })
            : resultadoParaModelo(resultado, { fraseSinPermiso, causa }),
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

  const texto = garantizarAvisoPropuesta(
    garantizarAvisoSinPermisoAccion(
      garantizarAvisoSinPermiso(respuesta ?? "", sinPermiso, (p) => causaSinPermiso(input.ctx, p)),
      sinPermisoAcciones,
    ),
    propuestas.length > 0,
  );

  return {
    respuesta: texto,
    herramientasUsadas,
    tokens: { entrada: tokensEntrada, salida: tokensSalida },
    consumo,
    modelo,
    dificultad,
    escalado,
    rondas,
    sinPermiso: Array.from(new Set([...sinPermiso, ...sinPermisoAcciones.map((f) => f.permiso)])),
    propuestas,
    fallo: fallo || texto.trim().length === 0,
  };
}
