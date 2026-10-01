/**
 * Modelo, prompt caching y cobro de la IA del bot (ws1-t5, auditoría #8).
 *
 * Run: npm run test:wa-bot-ia
 *
 * Código de verdad de punta a punta: generateAiReply → chatMetered → chat() →
 * fetch. Lo único falso es `fetch` (una API de Anthropic de mentira que
 * guarda el cuerpo y responde lo que diga la prueba), el monedero y el
 * interruptor de funciones. Ni una llamada real.
 *
 * Lo que se comprueba en el CUERPO enviado:
 *  - modelo claude-sonnet-5 con `thinking: {type: "disabled"}`;
 *  - system en dos bloques: el fijo (reglas + persona + FAQs) con
 *    cache_control y la fecha en el segundo, sin cache_control;
 *  - otros usos de chat() (texto plano, sin thinking) salen igual que antes.
 * Y en el cobro:
 *  - #8: si Claude no contesta en 12 s la petición se ABORTA y no se cobra;
 *  - los tokens de caché se cobran separados (lectura y escritura);
 *  - ws1-t11: «Así hablamos» entra en la parte fija, entre persona y FAQs, y
 *    sin ejemplos (o sin su SQL) no deja rastro.
 */
import Module from "node:module";
import path from "node:path";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(__dirname, "../../../../..");
type Fila = Record<string, any>;

const estado = {
  cuerpos: [] as Fila[],
  senales: [] as Array<AbortSignal | undefined>,
  /** "ok" responde; "cuelga" no responde hasta que la aborten. */
  modo: "ok" as "ok" | "cuelga",
  texto: "Claro, abrimos a las 9.",
  uso: { input_tokens: 300, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as Fila,
  cobros: [] as Fila[],
  reservasLiberadas: 0,
  /** Lo que devuelve «Así hablamos» (ws1-t11); "" = sin ejemplos o sin SQL. */
  tono: "",
  tonoPedidoPara: [] as string[],
};

globalThis.fetch = (async (url: unknown, init?: { body?: string; signal?: AbortSignal }) => {
  assert.equal(String(url), "https://api.anthropic.com/v1/messages");
  estado.cuerpos.push(JSON.parse(String(init?.body ?? "{}")));
  estado.senales.push(init?.signal);
  if (estado.modo === "cuelga") {
    await new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  }
  return new Response(
    JSON.stringify({ content: [{ type: "text", text: estado.texto }], usage: estado.uso }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as typeof fetch;

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/ai-billing/wallet.ts"), {
    canSpend: async () => true,
    estimarCostoCents: async () => 1,
    reservarSaldo: async (clinicId: string) => ({ id: "reserva", clinicId, amountCents: 1 }),
    liberarReserva: async () => { estado.reservasLiberadas++; },
    chargeUsage: async (args: Fila) => { estado.cobros.push(args); return null; },
  }],
  [path.join(RAIZ, "src/lib/ai-billing/interruptores.server.ts"), { funcionIaApagada: async () => false }],
  [path.join(RAIZ, "src/lib/whatsapp/bot/aprende/tono-prompt.ts"), {
    bloqueDeTonoDeLaClinica: async (clinicId: string) => {
      estado.tonoPedidoPara.push(clinicId);
      return estado.tono;
    },
  }],
]);
const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only") return {};
  let resuelto: string | null = null;
  try { resuelto = M._resolveFilename(req, parent, isMain); } catch { resuelto = null; }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

process.env.ANTHROPIC_API_KEY = "sk-prueba-no-es-real";

let ai: typeof import("../ai");
let claude: typeof import("@/lib/integrations/claude");
let pricing: typeof import("@/lib/ai-billing/pricing-core");
before(async () => {
  ai = await import("../ai");
  claude = await import("@/lib/integrations/claude");
  pricing = await import("@/lib/ai-billing/pricing-core");
});

beforeEach(() => {
  estado.cuerpos.length = 0;
  estado.senales.length = 0;
  estado.cobros.length = 0;
  estado.reservasLiberadas = 0;
  estado.modo = "ok";
  estado.tono = "";
  estado.tonoPedidoPara.length = 0;
  estado.texto = "Claro, abrimos a las 9.";
  estado.uso = { input_tokens: 300, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
});

const CONFIG = {
  id: "cfg", clinicId: "clinica_prueba", enabled: true, botName: "Asistente",
  persona: "PERSONA-DE-LA-CLINICA: trato cálido.", greeting: null, businessHours: null, afterHoursMsg: null,
  canAnswerFaq: true, canBookAppointments: true, fallbackToHuman: true, timezone: "America/Mexico_City",
};
const FAQS = [{ id: "f1", question: "¿Horario?", answer: "De 9 a 18.", enabled: true, order: 0 }];
const INPUT = {
  clinicId: "clinica_prueba", threadId: "t1", incomingText: "¿abren el sábado?", history: [],
  patient: { id: "p1", phone: "5215555555555", firstName: "Lucía" },
};

test("el bot llama a claude-sonnet-5 sin razonamiento y con 400 tokens de salida", async () => {
  const r = await ai.generateAiReply(INPUT, CONFIG, FAQS);
  assert.equal(r?.reply, "Claro, abrimos a las 9.");
  const cuerpo = estado.cuerpos[0];
  assert.equal(cuerpo.model, "claude-sonnet-5");
  assert.deepEqual(cuerpo.thinking, { type: "disabled" });
  assert.equal(cuerpo.max_tokens, 400);
  assert.equal(cuerpo.temperature, undefined, "Sonnet 5 rechaza sampling no por defecto");
});

test("prompt caching: lo fijo con cache_control, la fecha y el nombre en un bloque aparte sin caché", async () => {
  await ai.generateAiReply(INPUT, CONFIG, FAQS);
  const [fijo, variable, ...resto] = estado.cuerpos[0].system;
  assert.equal(resto.length, 0);
  assert.deepEqual(fijo.cache_control, { type: "ephemeral" });
  assert.match(fijo.text, /REGLAS DEL SISTEMA/);
  assert.match(fijo.text, /PERSONA-DE-LA-CLINICA/);
  assert.match(fijo.text, /De 9 a 18/);
  assert.ok(!/Hoy es/.test(fijo.text), "la fecha no puede ir en la parte cacheada");
  assert.ok(!/Lucía/.test(fijo.text), "el nombre del paciente tampoco: es por conversación");
  assert.equal(variable.cache_control, undefined);
  assert.match(variable.text, /Hoy es /);
  assert.match(variable.text, /Lucía/);
});

test("dos pacientes de la misma clínica comparten el bloque cacheado byte a byte", async () => {
  await ai.generateAiReply(INPUT, CONFIG, FAQS);
  await ai.generateAiReply({ ...INPUT, threadId: "t2", patient: { id: "p2", phone: "52155", firstName: "Ana" } }, CONFIG, FAQS);
  assert.equal(estado.cuerpos[0].system[0].text, estado.cuerpos[1].system[0].text);
});

test("los demás usos de chat() mandan el mismo cuerpo que antes (sin thinking, system en texto)", async () => {
  await claude.chat({ messages: [{ role: "user", content: "hola" }], system: "Eres útil." });
  const cuerpo = estado.cuerpos[0];
  assert.equal(cuerpo.model, "claude-sonnet-4-6");
  assert.equal(cuerpo.system, "Eres útil.");
  assert.equal("thinking" in cuerpo, false);
  assert.equal(estado.senales[0], undefined);
});

test("#8: si Claude no contesta a tiempo la petición se aborta y NO se cobra", { timeout: 20_000 }, async () => {
  estado.modo = "cuelga";
  const t0 = Date.now();
  const r = await ai.generateAiReply(INPUT, CONFIG, FAQS);
  const ms = Date.now() - t0;
  assert.equal(r, null, "el motor deriva a una persona");
  assert.equal(estado.senales[0]?.aborted, true, "el fetch se abortó de verdad");
  assert.equal(estado.cobros.length, 0, "no se cobra lo que no se envió");
  assert.equal(estado.reservasLiberadas, 1, "la reserva de saldo se suelta");
  assert.ok(ms >= ai.AI_TIMEOUT_MS - 50 && ms < ai.AI_TIMEOUT_MS + 2_000, `cortó a los ${ms} ms`);
});

test("chat() abortado devuelve un error explícito", async () => {
  estado.modo = "cuelga";
  const ctrl = new AbortController();
  const p = claude.chat({ messages: [{ role: "user", content: "hola" }], signal: ctrl.signal });
  ctrl.abort();
  assert.deepEqual(await p, { text: "", error: "claude_aborted" });
});

test("una respuesta normal sí se cobra, con lectura y escritura de caché por separado", async () => {
  estado.uso = { input_tokens: 40, output_tokens: 25, cache_creation_input_tokens: 2_000, cache_read_input_tokens: 0 };
  await ai.generateAiReply(INPUT, CONFIG, FAQS);
  estado.uso = { input_tokens: 40, output_tokens: 25, cache_creation_input_tokens: 0, cache_read_input_tokens: 2_000 };
  await ai.generateAiReply(INPUT, CONFIG, FAQS);
  assert.equal(estado.cobros.length, 2);
  assert.equal(estado.cobros[0].model, "claude-sonnet-5");
  assert.equal(estado.cobros[0].cacheWriteTokens, 2_000);
  assert.equal(estado.cobros[0].cacheTokens, 0);
  assert.equal(estado.cobros[1].cacheTokens, 2_000);
  assert.equal(estado.cobros[1].cacheWriteTokens, 0);
});

test("el precio de claude-sonnet-5 está en la tabla (no cae al de respaldo)", () => {
  const p = pricing.ANTHROPIC_MODEL_PRICES["claude-sonnet-5"];
  assert.deepEqual(p, { inputUsdPerMtok: 2, outputUsdPerMtok: 10, cacheWriteUsdPerMtok: 2.5, cacheReadUsdPerMtok: 0.2 });
});

test("si el modelo pide una persona, se distingue de un fallo", async () => {
  estado.texto = "__HANDOFF__";
  const r = await ai.generateAiReply(INPUT, CONFIG, FAQS);
  assert.deepEqual(r, { intent: "HANDOFF", handoff: true });
});

/* ── «Así hablamos» (ws1-t11) ───────────────────────────────────────── */

test("los ejemplos de tono van en la parte cacheada, después de la persona y antes de las FAQs", async () => {
  const { bloqueEjemplosDeTono } = await import("../aprende/tono");
  estado.tono = bloqueEjemplosDeTono(["¡Hola, [nombre]! Con gusto te ayudamos 😊", "Claro que sí, te esperamos."]);
  await ai.generateAiReply(INPUT, CONFIG, FAQS);
  assert.deepEqual(estado.tonoPedidoPara, ["clinica_prueba"], "se piden los de la clínica del turno");
  const [fijo, variable] = estado.cuerpos[0].system;
  const iPersona = fijo.text.indexOf("PERSONA-DE-LA-CLINICA");
  const iTono = fijo.text.indexOf("EJEMPLOS DE TONO DE LA CLÍNICA");
  const iFaqs = fijo.text.indexOf("De 9 a 18");
  assert.ok(iPersona >= 0 && iTono > iPersona && iFaqs > iTono, `orden persona(${iPersona}) < tono(${iTono}) < FAQs(${iFaqs})`);
  assert.match(fijo.text, /Con gusto te ayudamos/);
  assert.deepEqual(fijo.cache_control, { type: "ephemeral" });
  assert.ok(!variable.text.includes("EJEMPLOS DE TONO"));
});

test("sin ejemplos (o sin el SQL de t11) el prompt queda igual que antes", async () => {
  estado.tono = "";
  await ai.generateAiReply(INPUT, CONFIG, FAQS);
  const conVacio = estado.cuerpos[0].system[0].text;
  assert.ok(!conVacio.includes("EJEMPLOS DE TONO"));
  const { buildSystemBlocks } = await import("../ai-prompt");
  const sinParametro = buildSystemBlocks(INPUT, CONFIG, FAQS, new Date())[0].text;
  assert.equal(conVacio, sinParametro, "mismo bloque fijo byte a byte: no rompe la caché existente");
});

test("si no se va a llamar a la IA (mensaje vacío), no se consultan los ejemplos de tono", async () => {
  // La consulta va después de los cortes (vacío, IA apagada, sin saldo).
  await ai.generateAiReply({ ...INPUT, incomingText: "   " }, CONFIG, FAQS);
  assert.equal(estado.tonoPedidoPara.length, 0);
});
