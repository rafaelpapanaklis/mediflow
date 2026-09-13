/**
 * COBRO DE IA AL PRECIO DEL MODELO QUE DE VERDAD SE USÓ (WS1-T5).
 *
 * Run: npm run test:ai-precio-modelo
 *
 * Por qué existe: `computeCostUsdMicros()` cobraba TODO al precio único de la
 * fila `default` de AiPricingConfig (tarifa de Sonnet 4.6), así que una llamada
 * con Haiku —que cuesta la tercera parte— salía como si fuera Sonnet. No había
 * ni una prueba sobre esta aritmética, y por eso nadie lo vio.
 *
 * Qué fija:
 *   · cada modelo se cobra a SU precio (entrada, salida y caché) × fx × (1 + fee);
 *   · un id con fecha (`claude-haiku-4-5-20251001`, el que usa el chat) es Haiku;
 *   · un modelo desconocido, vacío o un alias se cobra al precio de SONNET 4.6
 *     (decisión de Rafael, 2026-09-13): nunca revienta, nunca cobra cero, nunca
 *     menos de lo que se cobraba antes, y nunca a tarifa de Opus/Fable;
 *   · cada vez que se dispara ese respaldo queda registrado (no una vez por
 *     proceso), y /admin/ai-billing puede listar los cobros que lo usaron;
 *   · el tipo de cambio y el fee que Rafael edita en /admin/ai-billing mandan;
 *   · un precio por modelo editado desde el admin (fila `model:<id>`) manda.
 *
 * Cómo prueba: sobre el núcleo PURO (`pricing-core.ts`, sin Prisma ni
 * `server-only`), que es el que usan `getPricingConfig()` y los cinco
 * llamadores vía `pricing.ts`. El config se arma desde las MISMAS filas que
 * devuelve Prisma, así que la prueba no depende de su forma interna.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  computeCostUsdMicros,
  pricingConfigFromRows,
  usdMicrosToBilledCents,
  type PricingRow,
} from "@/lib/ai-billing/pricing-core";
import { AI_CHAT_MODEL } from "@/lib/ai/models";

// ── Las filas de ai_pricing_configs, tal como las devuelve Prisma ───────────
let rows: PricingRow[] = [];

/** Fila con los @default del schema, pisada por lo que se pase. */
function row(id: string, over: Partial<PricingRow> = {}): PricingRow {
  return {
    id,
    inputUsdPerMtok: 3,
    outputUsdPerMtok: 15,
    cacheWriteUsdPerMtok: 3.75,
    cacheReadUsdPerMtok: 0.3,
    usdToMxnRate: 19.5,
    feePct: 8,
    ...over,
  };
}

/** Lo que se le cobra a la clínica (centavos MXN) por una llamada. */
async function billed(model: string, input: number, output: number, cacheRead = 0, cacheWrite = 0) {
  const c = pricingConfigFromRows(rows);
  const micros = computeCostUsdMicros(model, input, output, cacheRead, c, cacheWrite);
  return { micros, cents: usdMicrosToBilledCents(micros, c) };
}

// Precios de lista de Anthropic, USD por millón de tokens. Caché de 5 min:
// escribir = 1.25× la entrada, leer = 0.1× la entrada.
const LISTA = {
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
} as const;
/** El respaldo para un modelo sin precio: Sonnet 4.6, el que se cobraba a todo antes de #242. */
const RESPALDO = LISTA["claude-sonnet-4-6"];

const M = 1_000_000;
/** micro-USD → centavos MXN, a mano: USD × fx × 1.08 × 100. */
const centavos = (micros: number, fx = 19.5, fee = 8) => Math.round((micros / M) * fx * (1 + fee / 100) * 100);

beforeEach(() => {
  rows = [row("default")];
});

// ── 1. Cada modelo a SU precio ──────────────────────────────────────────────
for (const [model, p] of Object.entries(LISTA)) {
  test(`${model}: entrada, salida y caché a su propio precio × fx × 1.08`, async () => {
    // Un millón de tokens de cada tipo, por separado: el costo en micro-USD es
    // exactamente el precio por millón × 1e6.
    const soloEntrada = await billed(model, M, 0);
    assert.equal(soloEntrada.micros, p.input * M, "entrada");
    assert.equal(soloEntrada.cents, centavos(p.input * M));

    const soloSalida = await billed(model, 0, M);
    assert.equal(soloSalida.micros, p.output * M, "salida");
    assert.equal(soloSalida.cents, centavos(p.output * M));

    const soloLectura = await billed(model, 0, 0, M, 0);
    assert.equal(soloLectura.micros, Math.round(p.cacheRead * M), "lectura de caché");

    const soloEscritura = await billed(model, 0, 0, 0, M);
    assert.equal(soloEscritura.micros, Math.round(p.cacheWrite * M), "escritura de caché");

    // Una llamada realista, todo junto.
    const mixta = await billed(model, 6_200, 230, 1_000, 2_000);
    const esperado = Math.round(6_200 * p.input + 230 * p.output + 1_000 * p.cacheRead + 2_000 * p.cacheWrite);
    assert.equal(mixta.micros, esperado, "llamada mixta");
    assert.equal(mixta.cents, centavos(esperado));
  });
}

test("Haiku se cobra a la TERCERA parte de Sonnet 4.6, no al mismo precio", async () => {
  const haiku = await billed("claude-haiku-4-5", 50_000, 4_000);
  const sonnet = await billed("claude-sonnet-4-6", 50_000, 4_000);
  assert.equal(haiku.micros * 3, sonnet.micros);
  assert.ok(haiku.cents < sonnet.cents);
});

// ── 2. El id con fecha que usa el chat del asistente ────────────────────────
test("el id con fecha del chat (AI_CHAT_MODEL) se cobra como Haiku", async () => {
  assert.equal(AI_CHAT_MODEL, "claude-haiku-4-5-20251001", "si cambia el modelo del chat, revisa esta prueba");
  const conFecha = await billed(AI_CHAT_MODEL, 12_345, 678);
  const sinFecha = await billed("claude-haiku-4-5", 12_345, 678);
  assert.equal(conFecha.micros, sinFecha.micros);
  assert.equal(conFecha.micros, 12_345 * 1 + 678 * 5);
});

// ── 3. Modelo desconocido: precio de Sonnet 4.6, nunca revienta ni cobra cero ─
for (const raro of ["", "   ", "sonnet", "claude-sonnet", "gpt-4o", "claude-opus-9", undefined as any, null as any]) {
  test(`modelo desconocido ${JSON.stringify(raro)} → precio de Sonnet 4.6, > 0, sin lanzar`, async () => {
    const r = await billed(raro, M, M);
    assert.equal(r.micros, (RESPALDO.input + RESPALDO.output) * M);
    assert.ok(r.cents > 0);
  });
}

test("un modelo desconocido no cobra menos que lo que usa dental hoy, ni a tarifa de Opus", async () => {
  // En dental solo se usan Sonnet 4.6 y Haiku 4.5. Cobrar Opus a un modelo sin
  // precio serían cinco veces lo que costó: eso ya no es un error, es un cobro
  // que duele. Sonnet 4.6 protege sin castigar a la clínica.
  const desconocido = await billed("modelo-que-no-existe", 10_000, 1_000, 500, 700);
  for (const model of ["claude-sonnet-4-6", "claude-haiku-4-5"]) {
    const conocido = await billed(model, 10_000, 1_000, 500, 700);
    assert.ok(desconocido.micros >= conocido.micros, `${model} no puede costar más que un desconocido`);
  }
  const opus = await billed("claude-opus-5", 10_000, 1_000, 500, 700);
  assert.ok(desconocido.micros < opus.micros, "un modelo sin precio no se cobra a tarifa de Opus");
});

test("el respaldo es el precio VIGENTE de Sonnet 4.6: si el admin lo editó, manda lo editado", async () => {
  rows = [row("default"), row("model:claude-sonnet-4-6", { inputUsdPerMtok: 3.3, outputUsdPerMtok: 16.5, cacheWriteUsdPerMtok: 4.1, cacheReadUsdPerMtok: 0.33 })];
  assert.equal((await billed("modelo-nuevo", M, M, M, M)).micros, Math.round((3.3 + 16.5 + 0.33 + 4.1) * M));
});

test("cada vez que salta el respaldo queda registrado — no solo la primera", async (t) => {
  const avisos: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { avisos.push(args); });
  t.mock.method(console, "warn", (...args: unknown[]) => { avisos.push(args); });

  // Un modelo con precio no avisa nada.
  await billed("claude-haiku-4-5-20251001", 1_000, 100);
  assert.equal(avisos.length, 0, "un modelo con precio no debe dejar aviso");

  // El mismo modelo sin precio, tres cobros: tres registros, cada uno con el
  // modelo, la etiqueta fija para buscarlo en los logs y a qué se cobró.
  for (let i = 0; i < 3; i++) await billed("claude-sin-precio-9", 1_000, 100);
  assert.equal(avisos.length, 3, "el respaldo tiene que registrarse en CADA cobro, no una vez por proceso");
  for (const [etiqueta, datos] of avisos as Array<[string, Record<string, unknown>]>) {
    assert.match(String(etiqueta), /\[ai-billing\] PRECIO_DE_RESPALDO/);
    assert.equal(datos.model, "claude-sin-precio-9");
    assert.equal(datos.cobradoComo, "claude-sonnet-4-6");
  }
});

test("modelos sin precio: de los cobros guardados, solo los que cayeron en el respaldo", async () => {
  const { unpricedModelsFromUsage } = await import("@/lib/ai-billing/pricing-core");
  const c = pricingConfigFromRows(rows);
  const lista = unpricedModelsFromUsage(
    [
      { model: "claude-haiku-4-5-20251001", _count: { _all: 900 }, _sum: { billedCents: 12_000 } },
      { model: "claude-sonnet-4-6", _count: { _all: 40 }, _sum: { billedCents: 30_000 } },
      { model: "claude-sin-precio-9", _count: { _all: 7 }, _sum: { billedCents: 350 } },
      { model: "", _count: { _all: 2 }, _sum: { billedCents: null } },
    ],
    c,
  );
  assert.deepEqual(lista, [
    { model: "claude-sin-precio-9", events: 7, billedCents: 350 },
    { model: "", events: 2, billedCents: 0 },
  ]);
});

// ── 4. Lo que Rafael edita en /admin/ai-billing manda ───────────────────────
test("el tipo de cambio y el fee editados a mano mandan sobre el cobro", async () => {
  rows = [row("default", { usdToMxnRate: 17.25, feePct: 8 })];
  const r = await billed("claude-haiku-4-5", M, 0);
  assert.equal(r.cents, centavos(1 * M, 17.25, 8)); // 1 USD × 17.25 × 1.08 = 18.63 MXN
  assert.equal(r.cents, 1863);
});

test("los precios globales viejos de la fila default ya no pisan el precio del modelo", async () => {
  rows = [row("default", { inputUsdPerMtok: 3, outputUsdPerMtok: 15 })];
  const r = await billed("claude-haiku-4-5", M, 0);
  assert.equal(r.micros, 1 * M);
});

test("un precio por modelo editado desde el admin (fila model:<id>) manda", async () => {
  rows = [
    row("default", { usdToMxnRate: 18, feePct: 8 }),
    row("model:claude-haiku-4-5", { inputUsdPerMtok: 1.5, outputUsdPerMtok: 6, cacheWriteUsdPerMtok: 2, cacheReadUsdPerMtok: 0.2 }),
  ];
  const r = await billed("claude-haiku-4-5-20251001", M, M, M, M);
  assert.equal(r.micros, Math.round((1.5 + 6 + 0.2 + 2) * M));
  // El fx y el fee siguen saliendo de la fila default, no de la del modelo.
  assert.equal(r.cents, centavos(Math.round((1.5 + 6 + 0.2 + 2) * M), 18, 8));
  // Los demás modelos no se enteran.
  assert.equal((await billed("claude-sonnet-4-6", M, 0)).micros, 3 * M);
});

test("una fila de modelo con precio en cero o basura no deja cobrar cero", async () => {
  rows = [row("default"), row("model:claude-haiku-4-5", { inputUsdPerMtok: 0, outputUsdPerMtok: Number.NaN })];
  const r = await billed("claude-haiku-4-5", M, M);
  assert.equal(r.micros, (1 + 5) * M, "se ignora la fila rota y vale el precio de lista");
});

test("sin fila en la base se cobra igual, a precio de lista", async () => {
  rows = [];
  const r = await billed("claude-sonnet-4-6", M, 0);
  assert.equal(r.micros, 3 * M);
  assert.equal(r.cents, centavos(3 * M, 19.5, 8));
});

// ── 5. Una sola verdad de precios: la tabla del estudio de inmuebles ────────
test("la tabla del estudio de inmuebles no se ha desincronizado de la de cobro", async () => {
  const { MODEL_PRICE_USD_PER_MTOK } = await import("@/lib/realty/studio/pricing");
  const { ANTHROPIC_MODEL_PRICES } = await import("@/lib/ai-billing/pricing-core");
  for (const [model, p] of Object.entries(MODEL_PRICE_USD_PER_MTOK)) {
    const nuestro = ANTHROPIC_MODEL_PRICES[model];
    assert.ok(nuestro, `${model} está en inmuebles pero no en la tabla de cobro`);
    assert.equal(nuestro.inputUsdPerMtok, p.input, `${model}: entrada`);
    assert.equal(nuestro.outputUsdPerMtok, p.output, `${model}: salida`);
  }
});

// ── 6. Los modelos que de verdad pasan los llamadores tienen precio ─────────
// Solo AI_CHAT_MODEL se lee del código: las rutas declaran su MODEL como
// constante local sin exportar. Los demás son los literales que había en cada
// llamador el 2026-09-12 (revisados a mano); si uno cambia, esta prueba no se entera.
test("cada modelo que pasan los llamadores está en la tabla (no cae en el respaldo)", async () => {
  const { resolveModelPrice } = await import("@/lib/ai-billing/pricing-core");
  const c = pricingConfigFromRows(rows);
  const usados = {
    // src/lib/whatsapp/bot/ai.ts (CHAT_MODEL) y el default de meter.ts / integrations/claude
    "bot de WhatsApp": "claude-sonnet-4-6",
    // src/app/api/xrays/[id]/analyze, consult/ai-assist, prescriptions/check-contraindications
    "radiografías, consulta y recetas": "claude-sonnet-4-6",
    // src/app/api/ai (AI_CHAT_MODEL, con fecha)
    "chat del asistente": AI_CHAT_MODEL,
    // Sabina (rama integracion/sabina): directa y abierta
    "Sabina directa": "claude-haiku-4-5",
    "Sabina abierta": "claude-sonnet-4-6",
  };
  for (const [quien, model] of Object.entries(usados)) {
    assert.equal(resolveModelPrice(model, c).known, true, `${quien}: ${model} no tiene precio`);
  }
});

test("Fable 5 y 5.1 a su precio (5.1 lee caché a 0.25)", async () => {
  assert.equal((await billed("claude-fable-5", M, M, M, M)).micros, (10 + 50 + 1 + 12.5) * M);
  assert.equal((await billed("claude-fable-5-1", M, M, M, M)).micros, (10 + 50 + 0.25 + 12.5) * M);
});

test("un modelo desconocido también paga la caché a precio de Sonnet 4.6", async () => {
  const r = await billed("modelo-nuevo", 0, 0, M, M);
  assert.equal(r.micros, (RESPALDO.cacheRead + RESPALDO.cacheWrite) * M); // 0.30 + 3.75
});

test("una fila con id no canónico o de un modelo fuera de la tabla no pisa nada", async () => {
  rows = [
    row("default"),
    row("model:claude-haiku-4-5-20251001", { inputUsdPerMtok: 9, outputUsdPerMtok: 9, cacheWriteUsdPerMtok: 9, cacheReadUsdPerMtok: 9 }),
    row("model:constructor", { inputUsdPerMtok: 0.01, outputUsdPerMtok: 0.01, cacheWriteUsdPerMtok: 0.01, cacheReadUsdPerMtok: 0.01 }),
    row("model:gpt-4o", { inputUsdPerMtok: 0.01, outputUsdPerMtok: 0.01, cacheWriteUsdPerMtok: 0.01, cacheReadUsdPerMtok: 0.01 }),
  ];
  assert.equal((await billed("claude-haiku-4-5", M, 0)).micros, 1 * M);
  assert.equal((await billed("constructor", M, 0)).micros, RESPALDO.input * M);
  assert.equal((await billed("gpt-4o", M, 0)).micros, RESPALDO.input * M);
});

test("una fila de modelo con la caché en cero se ignora (no regala la caché)", async () => {
  rows = [row("default"), row("model:claude-sonnet-4-6", { inputUsdPerMtok: 3.3, cacheReadUsdPerMtok: 0 })];
  assert.equal((await billed("claude-sonnet-4-6", 0, 0, M, 0)).micros, Math.round(0.3 * M));
  assert.equal((await billed("claude-sonnet-4-6", M, 0)).micros, 3 * M);
});

test("un nombre heredado de Object ('constructor') no se cuela como precio", async () => {
  const r = await billed("constructor", M, 0);
  assert.equal(r.micros, RESPALDO.input * M);
});

// ── 7. El editor de /admin/ai-billing ───────────────────────────────────────
test("editor del admin: acepta precios válidos de modelos de la tabla", async () => {
  const { parseModelPriceEdits } = await import("@/lib/ai-billing/pricing-core");
  const r = parseModelPriceEdits({
    "claude-haiku-4-5-20251001": { inputUsdPerMtok: "1.1", outputUsdPerMtok: 5.5, cacheWriteUsdPerMtok: 1.4, cacheReadUsdPerMtok: 0.11 },
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.edits, [
      { model: "claude-haiku-4-5", price: { inputUsdPerMtok: 1.1, outputUsdPerMtok: 5.5, cacheWriteUsdPerMtok: 1.4, cacheReadUsdPerMtok: 0.11 } },
    ]);
  }
  assert.deepEqual(parseModelPriceEdits(undefined), { ok: true, edits: [] });
});

test("editor del admin: rechaza modelo desconocido, precios en cero (también caché), negativos o faltantes", async () => {
  const { parseModelPriceEdits } = await import("@/lib/ai-billing/pricing-core");
  const bien = { inputUsdPerMtok: 1, outputUsdPerMtok: 5, cacheWriteUsdPerMtok: 1.25, cacheReadUsdPerMtok: 0.1 };
  assert.equal(parseModelPriceEdits({ "gpt-4o": bien }).ok, false);
  assert.equal(parseModelPriceEdits({ constructor: bien }).ok, false);
  assert.equal(parseModelPriceEdits({ "claude-haiku-4-5": { ...bien, inputUsdPerMtok: 0 } }).ok, false);
  assert.equal(parseModelPriceEdits({ "claude-haiku-4-5": { ...bien, outputUsdPerMtok: "" } }).ok, false);
  assert.equal(parseModelPriceEdits({ "claude-haiku-4-5": { ...bien, cacheReadUsdPerMtok: -1 } }).ok, false);
  assert.equal(parseModelPriceEdits({ "claude-haiku-4-5": { ...bien, cacheReadUsdPerMtok: 0 } }).ok, false);
  assert.equal(parseModelPriceEdits({ "claude-haiku-4-5": { ...bien, cacheWriteUsdPerMtok: "" } }).ok, false);
  assert.equal(parseModelPriceEdits({ "claude-haiku-4-5": { inputUsdPerMtok: 1, outputUsdPerMtok: 5 } }).ok, false);
  assert.equal(parseModelPriceEdits([bien]).ok, false);
});

test("editor del admin: la lista marca qué modelo se separó del precio de lista", async () => {
  const { modelPriceRows } = await import("@/lib/ai-billing/pricing-core");
  rows = [row("default"), row("model:claude-opus-5", { inputUsdPerMtok: 6, outputUsdPerMtok: 25, cacheWriteUsdPerMtok: 6.25, cacheReadUsdPerMtok: 0.5 })];
  const lista = modelPriceRows(pricingConfigFromRows(rows));
  const opus = lista.find((m) => m.model === "claude-opus-5")!;
  assert.equal(opus.inputUsdPerMtok, 6);
  assert.equal(opus.list.inputUsdPerMtok, 5);
  assert.equal(opus.edited, true);
  assert.equal(lista.find((m) => m.model === "claude-haiku-4-5")!.edited, false);
});

test("editor del admin: solo escribe lo que se separa de la lista o un modelo que ya tenía fila", async () => {
  const { modelEditsToWrite } = await import("@/lib/ai-billing/pricing-core");
  const lista = { inputUsdPerMtok: 1, outputUsdPerMtok: 5, cacheWriteUsdPerMtok: 1.25, cacheReadUsdPerMtok: 0.1 };
  const otro = { ...lista, inputUsdPerMtok: 1.2 };
  const sinFilas = new Set<string>(["default"]);
  // Igual a la lista y sin fila → no se crea fila (la tabla en código sigue mandando).
  assert.deepEqual(modelEditsToWrite([{ model: "claude-haiku-4-5", price: lista }], sinFilas), []);
  // Distinto de la lista → se escribe.
  assert.equal(modelEditsToWrite([{ model: "claude-haiku-4-5", price: otro }], sinFilas).length, 1);
  // Ya tenía fila y vuelve a la lista → se escribe, para que la fila deje de pisar con el precio viejo.
  assert.equal(modelEditsToWrite([{ model: "claude-haiku-4-5", price: lista }], new Set(["model:claude-haiku-4-5"])).length, 1);
});

// ── 8. Que el respaldo se VEA sin leer logs ─────────────────────────────────
test("/admin/ai-billing agrupa los cobros por modelo y enseña los que no tienen precio (por fuente)", async () => {
  // La aritmética de `unpricedModelsFromUsage` está probada arriba; esto fija
  // que la ruta y la pantalla la usan. Sin esto la prueba pasaría con el helper
  // bien y el aviso sin cablear.
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const ruta = readFileSync(join(process.cwd(), "src/app/api/admin/ai-billing/route.ts"), "utf8");
  assert.match(ruta, /groupBy\(\{\s*by: \["model"\]/, "la ruta no agrupa los cobros por modelo");
  assert.match(ruta, /unpricedModels: unpricedModelsFromUsage\(usageByModel, pricing\)/, "la ruta no devuelve los modelos sin precio");
  const pantalla = readFileSync(join(process.cwd(), "src/app/admin/ai-billing/ai-billing-client.tsx"), "utf8");
  assert.match(pantalla, /d\.unpricedModels\?\.length/, "la pantalla no enseña los modelos sin precio");
});
