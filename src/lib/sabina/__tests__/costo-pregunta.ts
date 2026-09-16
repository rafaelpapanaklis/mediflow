/**
 * CUÁNTO CUESTA UNA PREGUNTA A SABINA — medido, no estimado.
 *
 *   export ANTHROPIC_API_KEY="$(grep -m1 '^ANTHROPIC_API_KEY=' ~/.config/panel-dental/.env | cut -d= -f2- | tr -d '"')"
 *   npm run sabina:costo
 *
 * ⚠️ NO GASTA NI UN CENTAVO. Usa SOLO `POST /v1/messages/count_tokens`, que
 * cuenta tokens y no invoca al modelo: no hay tokens de salida, no hay cargo.
 * Nunca añadas aquí una llamada a `/v1/messages`.
 *
 * La clave se lee del ENTORNO. No la escribas en este archivo ni en el reporte.
 *
 * ── QUÉ MIDE, Y QUÉ SUPONE ────────────────────────────────────────────────
 * MEDIDO con count_tokens (cifras reales de la API):
 *  · el prefijo fijo = los 23 esquemas de herramienta + el prompt del sistema,
 *    que es lo que el caché convierte en barato;
 *  · el tamaño real de cada llamada de una pregunta, con los `tool_result` de
 *    las herramientas DE VERDAD corriendo contra la base sembrada de pruebas;
 *  · los tokens de salida de las rondas de herramienta (el bloque `tool_use`
 *    que escribe el modelo se cuenta igual que cualquier otro contenido).
 *
 * SUPUESTO, y marcado como tal en la salida:
 *  · el TEXTO de la respuesta final. count_tokens no puede adivinar lo que el
 *    modelo va a escribir, así que se cuenta el de `RESPUESTA_TIPICA`, una
 *    respuesta de tres líneas como las que da Sabina a una pregunta directa.
 *    Es idéntico antes y después —el caché no cambia ni una palabra—, así que
 *    entra igual en las dos columnas y NO altera el ahorro, solo el absoluto.
 *    Para pisarlo con la cifra real de producción (columna `outputTokens` de
 *    `ai_usage_events`): SABINA_COSTO_SALIDA_FINAL=<tokens> npm run sabina:costo
 *
 * ── CÓMO SE REPITE DENTRO DE SEIS MESES ───────────────────────────────────
 * El mismo comando. La cifra se mueve si cambia el catálogo (más herramientas,
 * descripciones más largas), si Anthropic mueve un precio (`pricing-core.ts`)
 * o si Rafael cambia fx/fee en /admin/ai-billing — este script usa los precios
 * de LISTA y el fx/fee por defecto, no los de la base, para que el número sea
 * reproducible sin credenciales de Supabase.
 */
import "../engine-sin-server-only";
import "../tools/__tests__/preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { adminNorte, base } from "../tools/__tests__/siembra";
import { ejecutarSabina, type LlamadaModelo, type LlamarModelo, type TurnoModelo } from "../engine";
import { SABINA_TOOLS } from "../engine-catalog";
import { PREFIJO_CACHEADO_MINIMO_TOKENS, payloadAnthropic } from "../engine-cache";
import { computeCostUsdMicros, pricingConfigFromRows, usdMicrosToBilledCents } from "@/lib/ai-billing/pricing-core";

const CLAVE = process.env.ANTHROPIC_API_KEY;
const saltar = CLAVE ? false : "sin ANTHROPIC_API_KEY no se puede contar (count_tokens es gratis, pero pide clave)";

/** Precios de LISTA + fx/fee por defecto: lo mismo que cobra `chargeUsage`, sin base de datos. */
const PRECIOS = pricingConfigFromRows([]);

/**
 * Respuesta final SUPUESTA (ver cabecera). Tres líneas, el largo típico de una
 * pregunta directa según el propio prompt («dos o tres líneas»).
 */
const RESPUESTA_TIPICA =
  "Hoy tienes 8 citas: 5 confirmadas, 2 pendientes de confirmar y 1 cancelada.\n" +
  "La más próxima es a las 09:00 con el Dr. Martínez.\n" +
  "El hueco más grande te queda entre las 13:00 y las 15:30.";

/* ── count_tokens ──────────────────────────────────────────────────────── */

let peticiones = 0;

/** Tokens de entrada de un cuerpo de /v1/messages, según la propia API. */
async function contar(cuerpo: Record<string, unknown>): Promise<number> {
  peticiones += 1;
  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CLAVE as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`count_tokens ${res.status}: ${texto.slice(0, 300)}`);
  const n = Number(JSON.parse(texto)?.input_tokens);
  if (!Number.isFinite(n)) throw new Error(`count_tokens sin input_tokens: ${texto.slice(0, 200)}`);
  return n;
}

/** Mensaje mínimo cuyo coste se cancela al restar dos cuentas. */
const MINIMO = [{ role: "user", content: "." }];

/* ── El guion: una pregunta de verdad, sin llamar al modelo ────────────── */

/**
 * Doble del modelo que representa una pregunta directa real: en la ronda 0 pide
 * `citas_del_dia` y en la 1 contesta con texto. Las herramientas corren DE
 * VERDAD (base sembrada), así que el `tool_result` que se mide es el auténtico.
 * De paso guarda cada `LlamadaModelo` tal cual salió del motor.
 */
function guionDosLlamadas(fecha: string) {
  const llamadas: LlamadaModelo[] = [];
  const turnos: TurnoModelo[] = [
    {
      bloques: [
        { type: "tool_use", id: "toolu_medicion_1", name: "citas_del_dia", input: { fecha } },
      ],
      stopReason: "tool_use",
      tokensEntrada: 0,
      tokensSalida: 0,
      error: null,
    },
    {
      bloques: [{ type: "text", text: RESPUESTA_TIPICA }],
      stopReason: "end_turn",
      tokensEntrada: 0,
      tokensSalida: 0,
      error: null,
    },
  ];
  let i = 0;
  const llamar: LlamarModelo = async (args) => {
    llamadas.push({ ...args, messages: JSON.parse(JSON.stringify(args.messages)) });
    return turnos[Math.min(i++, turnos.length - 1)];
  };
  return { llamar, llamadas };
}

/* ── La aritmética del dinero ──────────────────────────────────────────── */

interface Llamada {
  /** Tokens de entrada TOTALES de la llamada (prefijo fijo incluido). */
  total: number;
  /** Tokens de salida de esa llamada. */
  salida: number;
}

/** Centavos MXN de una pregunta SIN caché: todo a precio de entrada. */
function centavosSinCache(modelo: string, llamadas: readonly Llamada[]): number {
  let micros = 0;
  for (const l of llamadas) micros += computeCostUsdMicros(modelo, l.total, l.salida, 0, PRECIOS);
  return usdMicrosToBilledCents(micros, PRECIOS);
}

/**
 * Centavos MXN CON caché: la primera llamada escribe el prefijo (1,25×) y las
 * siguientes lo leen (0,1×). `prefijo` son los tokens que quedan dentro del
 * último `cache_control`; el resto de cada llamada sigue a precio de entrada.
 */
function centavosConCache(modelo: string, llamadas: readonly Llamada[], prefijo: number): number {
  let micros = 0;
  llamadas.forEach((l, i) => {
    const resto = Math.max(0, l.total - prefijo);
    micros +=
      i === 0
        ? computeCostUsdMicros(modelo, resto, l.salida, 0, PRECIOS, prefijo)
        : computeCostUsdMicros(modelo, resto, l.salida, prefijo, PRECIOS);
  });
  return usdMicrosToBilledCents(micros, PRECIOS);
}

/** Lo mismo, pero con el prefijo YA caliente (otra pregunta lo escribió antes). */
function centavosCacheCaliente(modelo: string, llamadas: readonly Llamada[], prefijo: number): number {
  let micros = 0;
  for (const l of llamadas) {
    micros += computeCostUsdMicros(modelo, Math.max(0, l.total - prefijo), l.salida, prefijo, PRECIOS);
  }
  return usdMicrosToBilledCents(micros, PRECIOS);
}

const centavos = (n: number) => `${n} ¢MXN`;

/* ── La medición ───────────────────────────────────────────────────────── */

test("cuánto cuesta una pregunta, antes y después del caché", { skip: saltar }, async () => {
  const db = base();
  const ctx = adminNorte(db);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: ctx.timezone }).format(new Date());

  const g = guionDosLlamadas(hoy);
  const salida = await ejecutarSabina({
    ctx,
    pregunta: "¿Cuántas citas tengo hoy?",
    tools: SABINA_TOOLS,
    llamar: g.llamar,
  });
  assert.equal(g.llamadas.length, 2, "el guion tenía que dar dos llamadas");
  assert.equal(salida.fallo, false);

  const modelo = salida.modelo;
  const { tools, system } = payloadAnthropic(g.llamadas[0]);

  /* 1. El prefijo fijo: herramientas + prompt del sistema, por separado y
        juntos. Se resta `MINIMO` para que el sobrecoste del mensaje de relleno
        no se cuele en la cifra. */
  const soloMinimo = await contar({ model: modelo, messages: MINIMO });
  const conHerramientas = await contar({ model: modelo, messages: MINIMO, tools });
  const conSistema = await contar({ model: modelo, messages: MINIMO, system });
  const conAmbos = await contar({ model: modelo, messages: MINIMO, system, tools });

  const tHerramientas = conHerramientas - soloMinimo;
  const tSistema = conSistema - soloMinimo;
  const tPrefijo = conAmbos - soloMinimo;

  /* 2. Cada llamada de la pregunta, entera y tal como sale del motor. */
  const totales: number[] = [];
  for (const llamada of g.llamadas) {
    const cuerpo = payloadAnthropic(llamada);
    totales.push(await contar({ model: modelo, ...cuerpo }));
  }

  /* 3. Salida. La de la ronda de herramienta se MIDE: el bloque `tool_use` que
        el modelo escribió es lo que le contaron de salida, y cuenta igual como
        contenido. La API exige que a un `tool_use` le siga su `tool_result`, así
        que se mide un par completo y se le resta un par gemelo de relleno: lo
        que queda es el `tool_use`. La salida del texto final es el SUPUESTO de
        la cabecera, contado con la misma regla. */
  const toolUse = { type: "tool_use", id: "toolu_medicion_1", name: "citas_del_dia", input: { fecha: hoy } };
  const toolResultMinimo = { type: "tool_result", tool_use_id: "toolu_medicion_1", content: "." };
  const conPar = await contar({
    model: modelo,
    messages: [{ role: "user", content: "." }, { role: "assistant", content: [toolUse] }, { role: "user", content: [toolResultMinimo] }],
    tools,
  });
  const parDeRelleno = await contar({
    model: modelo,
    messages: [{ role: "user", content: "." }, { role: "assistant", content: "." }, { role: "user", content: "." }],
    tools,
  });
  const salidaRonda0 = conPar - parDeRelleno;
  const salidaFinalMedida =
    (await contar({ model: modelo, messages: [{ role: "user", content: RESPUESTA_TIPICA }] })) - soloMinimo;
  const salidaFinal = Number(process.env.SABINA_COSTO_SALIDA_FINAL) || salidaFinalMedida;

  /* 3b. Comprobación: los marcadores `cache_control` no se cobran como texto.
         Si esto no diera 0, todas las cuentas de arriba llevarían un sesgo. */
  const sinMarcadores = JSON.parse(JSON.stringify(payloadAnthropic(g.llamadas[0]))) as Record<string, any>;
  delete sinMarcadores.system[0].cache_control;
  for (const t of sinMarcadores.tools) delete t.cache_control;
  const totalSinMarcadores = await contar({ model: modelo, ...sinMarcadores });
  const costeDelMarcador = totales[0] - totalSinMarcadores;

  const llamadas: Llamada[] = [
    { total: totales[0], salida: Math.max(1, salidaRonda0) },
    { total: totales[1], salida: salidaFinal },
  ];

  /* 4. Las dos cifras. */
  const antes = centavosSinCache(modelo, llamadas);
  const despues = centavosConCache(modelo, llamadas, tPrefijo);
  const caliente = centavosCacheCaliente(modelo, llamadas, tPrefijo);

  const tresLlamadas: Llamada[] = [...llamadas, { total: totales[1], salida: salidaFinal }];
  const antes3 = centavosSinCache(modelo, tresLlamadas);
  const despues3 = centavosConCache(modelo, tresLlamadas, tPrefijo);
  const caliente3 = centavosCacheCaliente(modelo, tresLlamadas, tPrefijo);

  /* 5. El caso incómodo: una pregunta que se resuelve en UNA sola llamada (un
        saludo, un «¿qué sabes hacer?»). Ahí no hay segunda llamada que lea lo
        que la primera escribió, así que con el caché FRÍO se paga la prima de
        escritura a cambio de nada. Va al reporte tal cual: es el único caso en
        el que esto sale más caro que antes. */
  const unaSola: Llamada[] = [{ total: totales[0], salida: salidaFinal }];
  const unaAntes = centavosSinCache(modelo, unaSola);
  const unaFria = centavosConCache(modelo, unaSola, tPrefijo);
  const unaCaliente = centavosCacheCaliente(modelo, unaSola, tPrefijo);

  const linea = "─".repeat(72);
  console.log(`\n${linea}`);
  console.log(`  COSTO DE UNA PREGUNTA A SABINA — medido con count_tokens (gratis)`);
  console.log(`  pregunta: «¿Cuántas citas tengo hoy?»   ·   modelo: ${modelo}`);
  console.log(`  herramientas en el catálogo: ${SABINA_TOOLS.length}   ·   peticiones a count_tokens: ${peticiones}`);
  console.log(linea);
  console.log(`  EL PREFIJO FIJO (lo que se paga en CADA llamada, se use o no)`);
  console.log(`    esquemas de las ${SABINA_TOOLS.length} herramientas ....... ${tHerramientas} tokens`);
  console.log(`    prompt del sistema ...................... ${tSistema} tokens`);
  console.log(`    prefijo cacheable (tools + system) ...... ${tPrefijo} tokens`);
  console.log(`    mínimo que ${modelo} exige para cachear . ${PREFIJO_CACHEADO_MINIMO_TOKENS} tokens`);
  console.log(`    lo que cuestan los marcadores en sí ..... ${costeDelMarcador} tokens (tiene que ser 0)`);
  console.log(
    `    ¿cachea? ................................ ${tPrefijo >= PREFIJO_CACHEADO_MINIMO_TOKENS ? "SÍ" : "NO — por debajo del mínimo, el marcador no haría nada"}`,
  );
  console.log(linea);
  console.log(`  LA PREGUNTA, LLAMADA A LLAMADA (tokens de entrada medidos)`);
  llamadas.forEach((l, i) => {
    console.log(`    llamada ${i + 1}: ${l.total} de entrada (${l.total - tPrefijo} fuera del prefijo) · ${l.salida} de salida`);
  });
  console.log(`    (la salida de la llamada ${llamadas.length} es SUPUESTA: ${salidaFinal} tokens, ver cabecera)`);
  console.log(linea);
  console.log(`  LAS DOS CIFRAS — 2 llamadas`);
  console.log(`    ANTES  (sin caché) ...................... ${centavos(antes)}`);
  console.log(`    DESPUÉS (caché frío: esta escribe) ...... ${centavos(despues)}`);
  console.log(`    DESPUÉS (caché caliente: ya escrito) .... ${centavos(caliente)}`);
  console.log(`  LAS DOS CIFRAS — 3 llamadas`);
  console.log(`    ANTES  (sin caché) ...................... ${centavos(antes3)}`);
  console.log(`    DESPUÉS (caché frío) .................... ${centavos(despues3)}`);
  console.log(`    DESPUÉS (caché caliente) ................ ${centavos(caliente3)}`);
  console.log(linea);
  console.log(`  EL CASO QUE SALE PEOR — pregunta de UNA sola llamada (sin herramienta)`);
  console.log(`    ANTES ................................... ${centavos(unaAntes)}`);
  console.log(`    DESPUÉS (caché frío) .................... ${centavos(unaFria)}  ${unaFria > unaAntes ? "← MÁS CARO: escribe un prefijo que nadie lee" : ""}`);
  console.log(`    DESPUÉS (caché caliente) ................ ${centavos(unaCaliente)}`);
  console.log(linea);
  console.log(`  ⚠️ El caché dura ~5 min. «Frío» es la primera pregunta tras un rato`);
  console.log(`     parada; «caliente», cualquiera que llegue detrás. Una clínica que`);
  console.log(`     pregunta una vez al día paga SIEMPRE la de frío.`);
  console.log(`${linea}\n`);

  // Comprobaciones duras: que el prefijo cachee de verdad y que el caché ahorre.
  assert.ok(
    tPrefijo >= PREFIJO_CACHEADO_MINIMO_TOKENS,
    `el prefijo (${tPrefijo} tokens) NO llega al mínimo de ${modelo} (${PREFIJO_CACHEADO_MINIMO_TOKENS}): el caché no se activaría`,
  );
  assert.ok(despues < antes, `el caché frío (${despues}) no ahorra frente a ${antes}`);
  assert.ok(caliente < despues, `el caché caliente (${caliente}) tendría que ser más barato que el frío (${despues})`);
  assert.equal(costeDelMarcador, 0, "los marcadores cache_control estarían sumando tokens: la medición tendría sesgo");
});
