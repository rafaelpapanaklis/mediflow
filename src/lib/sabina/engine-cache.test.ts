/**
 * DÓNDE CAE CADA `cache_control`, Y QUÉ CUESTA CADA TOKEN DE CACHÉ.
 *
 *   npm run test:sabina-cache
 *
 * Sin red y sin base: `engine-cache.ts` solo arma un objeto, y `pricing-core.ts`
 * solo hace cuentas. Lo de punta a punta —que el motor mande de verdad ese
 * cuerpo y que el monedero cobre de verdad ese importe— está en
 * `npm run test:sabina-cobro`.
 *
 * Por qué hace falta fijarlo. El caché falla EN SILENCIO: si el marcador cae en
 * el sitio equivocado, o el catálogo deja de ser idéntico entre llamadas, o
 * alguien mete un dato variable delante del prefijo, la petición sigue saliendo
 * bien y lo único que cambia es la factura. Nadie se entera durante meses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { PREFIJO_CACHEADO_MINIMO_TOKENS, payloadAnthropic, tokensCacheDeUsage } from "./engine-cache";
import { computeCostUsdMicros, pricingConfigFromRows } from "@/lib/ai-billing/pricing-core";

const esquema = (name: string) => ({
  name,
  description: `qué hace ${name}`,
  input_schema: { type: "object", properties: {} } as Record<string, unknown>,
});

const TRES = [esquema("resumen_clinica"), esquema("citas_del_dia"), esquema("agendar_cita")];
const ENTRADA = { system: "Eres Sabina.", messages: [{ role: "user", content: "¿cuántas citas?" }], tools: TRES };

/* ── Dónde cae el marcador ─────────────────────────────────────────────── */

test("el marcador va en la ÚLTIMA herramienta: así el prefijo es el catálogo entero", () => {
  const p = payloadAnthropic(ENTRADA);
  assert.deepEqual(
    p.tools?.map((t) => [t.name, Boolean(t.cache_control)]),
    [["resumen_clinica", false], ["citas_del_dia", false], ["agendar_cita", true]],
  );
});

test("el segundo marcador va al final del system, y el prompt llega intacto al modelo", () => {
  const p = payloadAnthropic(ENTRADA);
  assert.equal(p.system.length, 1);
  assert.equal(p.system[0].type, "text");
  // 🔴 Lo que lee el modelo NO cambia: mismos bytes, solo envueltos en bloque.
  assert.equal(p.system[0].text, ENTRADA.system);
  assert.deepEqual(p.system[0].cache_control, { type: "ephemeral" });
});

test("dos marcadores y ni uno más: Anthropic solo admite cuatro por petición", () => {
  const p = payloadAnthropic(ENTRADA);
  const marcadores =
    (p.tools ?? []).filter((t) => t.cache_control).length + p.system.filter((b) => b.cache_control).length;
  assert.equal(marcadores, 2);
});

test("los mensajes NO se marcan: son distintos en cada pregunta y solo pagarían la prima de escritura", () => {
  const p = payloadAnthropic(ENTRADA);
  assert.deepEqual(p.messages, ENTRADA.messages);
  assert.equal(JSON.stringify(p.messages).includes("cache_control"), false);
});

/* ── La última ronda ───────────────────────────────────────────────────── */

test("la última ronda conserva el catálogo y apaga las herramientas con tool_choice: none", () => {
  const p = payloadAnthropic({ ...ENTRADA, sinHerramientas: true });
  assert.equal(p.tools?.length, 3, "sin catálogo se rompe el prefijo justo en la llamada más cargada");
  assert.deepEqual(p.tool_choice, { type: "none" });
  // Y el prefijo es el MISMO que el de las rondas anteriores: si no, no hay
  // acierto de caché por muy puestas que estén las herramientas.
  assert.deepEqual(p.tools, payloadAnthropic(ENTRADA).tools);
});

test("en las rondas normales no va tool_choice: el modelo tiene que poder consultar", () => {
  assert.equal(payloadAnthropic(ENTRADA).tool_choice, undefined);
});

test("sin herramientas en el catálogo no se manda `tools` vacío ni tool_choice", () => {
  const p = payloadAnthropic({ ...ENTRADA, tools: [], sinHerramientas: true });
  assert.equal(p.tools, undefined);
  assert.equal(p.tool_choice, undefined);
});

/* ── El freno de mano ──────────────────────────────────────────────────── */

test("SABINA_CACHE=0 quita los marcadores y deja el resto igual", (t) => {
  process.env.SABINA_CACHE = "0";
  t.after(() => { delete process.env.SABINA_CACHE; });

  const p = payloadAnthropic(ENTRADA);
  assert.equal((p.tools ?? []).some((h) => h.cache_control), false);
  assert.equal(p.system[0].cache_control, undefined);
  // Lo que ve el modelo es idéntico con y sin caché.
  assert.equal(p.system[0].text, ENTRADA.system);
  assert.deepEqual(p.tools?.map((h) => h.name), ["resumen_clinica", "citas_del_dia", "agendar_cita"]);
});

/* ── Leer los contadores ───────────────────────────────────────────────── */

test("se leen los dos contadores del usage de Anthropic", () => {
  assert.deepEqual(
    tokensCacheDeUsage({ input_tokens: 21, cache_read_input_tokens: 9_987, cache_creation_input_tokens: 0 }),
    { lectura: 9_987, escritura: 0 },
  );
  assert.deepEqual(
    tokensCacheDeUsage({ cache_creation_input_tokens: 9_987 }),
    { lectura: 0, escritura: 9_987 },
  );
});

test("un usage raro cae a cero y NUNCA inventa tokens: se cobraría de más", () => {
  for (const usage of [
    undefined, null, {}, "texto", 7,
    { cache_read_input_tokens: null },
    { cache_read_input_tokens: "9987" satisfies string },
    { cache_read_input_tokens: -5, cache_creation_input_tokens: NaN },
    { cacheReadInputTokens: 9_987 }, // si algún día renombran los campos
  ]) {
    const t = tokensCacheDeUsage(usage);
    assert.ok(t.lectura >= 0 && t.escritura >= 0, `usage ${JSON.stringify(usage)} dio negativo`);
    assert.ok(Number.isFinite(t.lectura) && Number.isFinite(t.escritura));
  }
  // El texto "9987" SÍ es un número para la API si algún día lo manda así.
  assert.equal(tokensCacheDeUsage({ cache_read_input_tokens: "9987" }).lectura, 9_987);
  assert.equal(tokensCacheDeUsage({ cache_read_input_tokens: "muchos" }).lectura, 0);
  assert.equal(tokensCacheDeUsage({ cache_creation_input_tokens: -5 }).escritura, 0);
});

/* ── El precio ─────────────────────────────────────────────────────────── */

test("leer del caché cuesta 0,1× y escribir 1,25×: cobrarlos como entrada sería cobrar de más", () => {
  const cfg = pricingConfigFromRows([]);
  const PREFIJO = 9_987; // el medido de verdad por `npm run sabina:costo`

  // Caché frío: la primera llamada ESCRIBE el prefijo.
  const frio = computeCostUsdMicros("claude-haiku-4-5", 21, 66, 0, cfg, PREFIJO);
  // Caché caliente: la siguiente lo LEE.
  const caliente = computeCostUsdMicros("claude-haiku-4-5", 763, 77, PREFIJO, cfg);
  // Y lo que costaba antes, con todo a precio de entrada.
  const antes = computeCostUsdMicros("claude-haiku-4-5", 21 + PREFIJO, 66, 0, cfg);

  assert.equal(frio, Math.round(21 * 1 + 66 * 5 + PREFIJO * 1.25));
  assert.equal(caliente, Math.round(763 * 1 + 77 * 5 + PREFIJO * 0.1));
  assert.ok(frio > antes, "escribir el caché cuesta un 25 % más que no cachear: eso es lo que se recupera leyendo");
  assert.ok(caliente < antes, "leer del caché tiene que ser mucho más barato que no cachear");

  // Lo que pasaría si alguien volviera a meter los dos en el saco de `cacheTokens`
  // (que se cobra a precio de LECTURA): la escritura saldría casi gratis y
  // DaleControl pondría la diferencia.
  const toqueTodoComoLectura = computeCostUsdMicros("claude-haiku-4-5", 21, 66, PREFIJO, cfg);
  assert.ok(toqueTodoComoLectura < frio, "escribir cuesta 12,5 veces lo que leer: no son intercambiables");
});

test("el mínimo cacheable declarado es el de Haiku 4.5, el modelo que contesta la mayoría", () => {
  // No es una constante decorativa: por debajo de esto Anthropic no crea la
  // entrada y no avisa. Y el mínimo NO baja con cada generación (512 en los
  // más nuevos, 4 096 aquí), así que no se puede deducir.
  assert.equal(PREFIJO_CACHEADO_MINIMO_TOKENS, 4_096);
});
