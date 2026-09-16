/**
 * SABINA COBRA CADA MODELO A SU PRECIO — el monedero de verdad, no un registrador.
 *
 *   npm run test:sabina-cobro
 *
 * Por qué existe. Sabina cobra del monedero (`chargeUsage`) y el #242 cambió
 * cómo se calcula ese cobro: antes había UN precio (el de Sonnet 4.6) y Haiku
 * se cobraba al triple de lo que cuesta. `punta-a-punta.test.ts` sustituye el
 * monedero entero por un registrador —comprueba QUÉ modelo y cuántos tokens se
 * mandan a cobrar, no CUÁNTO se cobra—, así que esas pruebas pasan igual con
 * precio único que con precio por modelo. Si Sabina hubiera entrado sin el
 * #242, Haiku se habría cobrado a tarifa de Sonnet y ninguna prueba lo habría
 * dicho. Esta sí.
 *
 * Lo que corre DE VERDAD: `POST /api/sabina`, el motor, las herramientas,
 * `chargeUsage` (wallet.ts), `getPricingConfig` (pricing.ts) y la aritmética de
 * `pricing-core.ts`. Lo que se sustituye: `fetch` (doble de Anthropic: no sale
 * nada a la red), la sesión, `@/lib/prisma` (el doble de base de las
 * herramientas + las tres tablas del monedero en memoria), el rate limit, la
 * auto-recarga (Stripe) y el historial.
 */
import "../engine-sin-server-only"; // PRIMERO: engine.ts y wallet.ts arrastran "server-only"
import { before, beforeEach, test, mock } from "node:test";
import assert from "node:assert/strict";

import { CL_NORTE, TZ_NORTE, U_ADMIN_N, base } from "../tools/__tests__/siembra";
import type { BaseDoble } from "../tools/__tests__/doble-base";

/* ── El monedero en memoria ─────────────────────────────────────────── */

const estado = {
  db: null as BaseDoble | null,
  saldoCents: 100_000,
  eventos: [] as Array<Record<string, any>>,
  movimientos: [] as Array<Record<string, any>>,
  // El cuerpo COMPLETO de cada petición a Anthropic: desde el caché de prompt
  // las pruebas también miran `tools`, `system` y `tool_choice`.
  peticiones: [] as Array<{
    model: string;
    system?: any[];
    tools?: any[];
    tool_choice?: { type: string };
    messages?: any[];
  }>,
  guion: null as null | ((p: { model: string; n: number }) => Record<string, unknown>),
};

const monedero = {
  // Sin fila en sabina_user_permissions: Sabina con todo lo del usuario, lo de
  // siempre. El recorte del Super Admin se prueba en `test:sabina-permisos-equipo`.
  sabinaUserPermission: { findFirst: async () => null },
  aiPricingConfig: { findMany: async () => [] },
  aiWallet: {
    upsert: async () => ({
      clinicId: CL_NORTE, balanceCents: estado.saldoCents, status: "ACTIVE",
      autoRecharge: false, stripePaymentMethodId: null, autoRechargeThresholdCents: 0,
    }),
    findUnique: async () => ({ clinicId: CL_NORTE, balanceCents: estado.saldoCents, status: "ACTIVE" }),
    update: async ({ where, data }: any) => {
      assert.equal(where.clinicId, CL_NORTE, "el cobro fue a otra clínica");
      estado.saldoCents -= data.balanceCents.decrement;
      return { clinicId: CL_NORTE, balanceCents: estado.saldoCents, autoRecharge: false, autoRechargeThresholdCents: 0 };
    },
  },
  aiUsageEvent: {
    create: async ({ data }: any) => {
      estado.eventos.push(data);
      return { id: `ev_${estado.eventos.length}`, ...data };
    },
  },
  aiWalletTransaction: {
    create: async ({ data }: any) => {
      estado.movimientos.push(data);
      return data;
    },
  },
  $transaction: async (fn: (tx: unknown) => unknown) => fn(prismaDoble),
};

const prismaDoble: any = new Proxy(
  {},
  { get: (_t, clave) => (clave in monedero ? (monedero as any)[clave] : (estado.db as any)?.[clave]) },
);

function contesta(texto: string, uso: { input_tokens: number; output_tokens: number }) {
  return { content: [{ type: "text", text: texto }], stop_reason: "end_turn", usage: uso };
}
function pideHerramienta(nombre: string, uso: { input_tokens: number; output_tokens: number }) {
  return { content: [{ type: "tool_use", id: `tu_${nombre}`, name: nombre, input: {} }], stop_reason: "tool_use", usage: uso };
}

let POST: (req: any) => Promise<Response>;
let NextRequestCtor: any;

before(async () => {
  process.env.ANTHROPIC_API_KEY = "sk-prueba-no-es-real";
  delete process.env.SABINA_MODELO_DIRECTA;
  delete process.env.SABINA_MODELO_ABIERTA;

  globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
    assert.equal(String(url), "https://api.anthropic.com/v1/messages", "el motor solo debe hablar con Anthropic");
    const cuerpo = JSON.parse(init?.body ?? "{}");
    estado.peticiones.push(cuerpo);
    assert.ok(estado.guion, "una prueba llamó al modelo sin guion");
    const respuesta = estado.guion({ model: cuerpo.model, n: estado.peticiones.length });
    return new Response(JSON.stringify(respuesta), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  mock.module("@/lib/auth/two-factor-identity", {
    namedExports: { personaTieneDosFactores: async () => false, dosFactoresDeLaPersona: async () => false },
  });
  mock.module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });
  const authReal = await import("@/lib/auth-context");
  mock.module("@/lib/auth-context", {
    namedExports: {
      ...authReal,
      getAuthContext: async () => ({
        userId: U_ADMIN_N, clinicId: CL_NORTE, role: "ADMIN", permissionsOverride: [],
        clinic: { timezone: TZ_NORTE, category: "DENTAL" }, isAdmin: true,
      }),
    },
  });
  mock.module("@/lib/failban", { namedExports: { persistentRateLimit: async () => null } });
  mock.module("@/lib/ai-billing/recharge", { namedExports: { triggerAutoRechargeIfNeeded: async () => undefined } });
  mock.module("@/lib/ai-assistant/conversations", {
    namedExports: { isAiHistoryStorageMissing: () => false },
  });
  mock.module("@/lib/sabina/engine-historial", {
    namedExports: {
      leerConversacionSabina: async () => null,
      anexarTurnosSabina: async () => false,
      crearConversacionSabina: async () => "conv-sabina",
      listarConversacionesSabina: async () => [],
    },
  });

  ({ NextRequest: NextRequestCtor } = await import("next/server"));
  ({ POST } = await import("@/app/api/sabina/route"));
});

beforeEach(() => {
  estado.db = base();
  estado.saldoCents = 100_000;
  estado.eventos = [];
  estado.movimientos = [];
  estado.peticiones = [];
  estado.guion = null;
  delete process.env.SABINA_MODELO_DIRECTA;
  delete process.env.SABINA_MODELO_ABIERTA;
});

function preguntar(pregunta: string) {
  return POST(
    new NextRequestCtor("http://localhost/api/sabina", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pregunta }),
    }),
  );
}

/** Centavos MXN que cobra el monedero por un costo en micro-USD, con los @default (fx 19.5, fee 8 %). */
const centavos = (micros: number) => Math.round((micros / 1_000_000) * 19.5 * 1.08 * 100);

/* ══════════════════════════════════════════════════════════════════════ */

test("una pregunta directa se cobra a precio de HAIKU, no de Sonnet", async () => {
  estado.guion = () => contesta("Tienes 3 citas hoy.", { input_tokens: 400_000, output_tokens: 20_000 });
  const res = await preguntar("¿Cuántas citas tengo hoy?");
  assert.equal(res.status, 200);

  assert.equal(estado.eventos.length, 1);
  const ev = estado.eventos[0];
  assert.equal(ev.feature, "sabina");
  assert.equal(ev.model, "claude-haiku-4-5");
  // Haiku 4.5: 1 USD / Mtok de entrada, 5 de salida.
  const haiku = 400_000 * 1 + 20_000 * 5; // 500 000 micro-USD
  assert.equal(ev.costUsdMicros, haiku, `Haiku cobrado a ${ev.costUsdMicros} micro-USD; a tarifa de Sonnet serían ${400_000 * 3 + 20_000 * 15}`);
  assert.equal(ev.billedCents, centavos(haiku)); // 1053 ¢ = $10.53
  // Y eso es exactamente lo que baja el saldo, con su movimiento en el libro.
  assert.equal(estado.saldoCents, 100_000 - centavos(haiku));
  assert.deepEqual(
    estado.movimientos.map((m) => [m.type, m.amountCents, m.reference]),
    [["CHARGE", -centavos(haiku), "ev_1"]],
  );
});

test("si escala a Sonnet, cada modelo paga SU precio en su propio AiUsageEvent", async () => {
  // La pasada barata pide herramientas hasta agotar rondas sin contestar; la
  // cara cierra. Tokens distintos por modelo para poder separarlos.
  estado.guion = ({ model }) => {
    if (model === "claude-haiku-4-5") {
      const pedidas = estado.peticiones.filter((p) => p.model === model).length;
      return pedidas <= 4
        ? pideHerramienta("citas_del_dia", { input_tokens: 100_000, output_tokens: 2_000 })
        : contesta("", { input_tokens: 100_000, output_tokens: 2_000 });
    }
    return contesta("Con lo que vi: tienes citas.", { input_tokens: 50_000, output_tokens: 3_000 });
  };

  const res = await preguntar("¿Cuántas citas tengo hoy?");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).modelo, "claude-sonnet-4-6");

  const porModelo = Object.fromEntries(estado.eventos.map((e) => [e.model, e]));
  assert.deepEqual(Object.keys(porModelo).sort(), ["claude-haiku-4-5", "claude-sonnet-4-6"]);

  const haiku = 500_000 * 1 + 10_000 * 5; // 550 000
  const sonnet = 50_000 * 3 + 3_000 * 15; // 195 000
  assert.equal(porModelo["claude-haiku-4-5"].costUsdMicros, haiku, "la pasada de Haiku no se cobró a precio de Haiku");
  assert.equal(porModelo["claude-sonnet-4-6"].costUsdMicros, sonnet, "la pasada de Sonnet no se cobró a precio de Sonnet");
  assert.equal(estado.saldoCents, 100_000 - centavos(haiku) - centavos(sonnet));
});

test("un modelo de Sabina sin precio en la tabla se cobra como Sonnet 4.6, y queda registrado en cada cobro", async (t) => {
  const avisos: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { avisos.push(args); });
  // Rafael puede cambiar el modelo por variable de entorno sin redeploy de código.
  process.env.SABINA_MODELO_DIRECTA = "claude-haiku-9";
  estado.guion = () => contesta("Tienes 3 citas hoy.", { input_tokens: 400_000, output_tokens: 20_000 });

  for (let i = 0; i < 2; i++) assert.equal((await preguntar("¿Cuántas citas tengo hoy?")).status, 200);

  assert.equal(estado.eventos.length, 2);
  for (const ev of estado.eventos) {
    assert.equal(ev.model, "claude-haiku-9");
    assert.equal(ev.costUsdMicros, 400_000 * 3 + 20_000 * 15, "el respaldo tiene que ser Sonnet 4.6, no Opus ni Fable");
  }
  const respaldos = avisos.filter(([etiqueta]) => /PRECIO_DE_RESPALDO/.test(String(etiqueta)));
  assert.equal(respaldos.length, 2, "cada cobro con precio de respaldo tiene que dejar su registro");
  assert.equal((respaldos[0][1] as any).model, "claude-haiku-9");
});

test("en «Saldo de IA» el cargo dice «Sabina», no el slug crudo", async () => {
  const { aiBillingFeatureLabel } = await import("@/lib/ai-billing/types");
  const { AI_FEATURE_SABINA } = await import("../engine-catalog");
  assert.equal(aiBillingFeatureLabel(AI_FEATURE_SABINA), "Sabina");
});

/* ══════════════════════════════════════════════════════════════════════
   EL CACHÉ DE PROMPT (ws1-t2)

   El catálogo y el prompt viajan en cada llamada y son iguales para todas
   las clínicas, así que van marcados con `cache_control`. Eso parte la
   entrada en TRES contadores a tres precios distintos, y cobrarlos como si
   fueran uno solo le cobraría de MÁS a la clínica en cada caché frío —que
   es peor que no haber hecho nada—. Estas pruebas fijan el reparto.
   ══════════════════════════════════════════════════════════════════════ */

/** Una respuesta con los contadores de caché que devuelve Anthropic de verdad. */
function contestaConCache(
  texto: string,
  uso: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number },
) {
  return { content: [{ type: "text", text: texto }], stop_reason: "end_turn", usage: uso };
}

test("un token leído del caché cuesta 0,1× y uno escrito 1,25× — no se cobran como entrada normal", async () => {
  estado.guion = () =>
    contestaConCache("Tienes 3 citas hoy.", {
      input_tokens: 1_000,
      output_tokens: 20_000,
      cache_creation_input_tokens: 100_000,
      cache_read_input_tokens: 300_000,
    });

  assert.equal((await preguntar("¿Cuántas citas tengo hoy?")).status, 200);

  const ev = estado.eventos[0];
  // Haiku 4.5: entrada 1, salida 5, escritura 1.25, lectura 0.1 (USD/Mtok).
  const correcto = 1_000 * 1 + 20_000 * 5 + 300_000 * 0.1 + 100_000 * 1.25;
  assert.equal(ev.costUsdMicros, correcto, "el caché no se está cobrando a su precio");

  // Lo que pasaría metiéndolo todo en el saco de la entrada: se le cobra de más.
  const todoComoEntrada = (1_000 + 100_000 + 300_000) * 1 + 20_000 * 5;
  assert.ok(
    correcto < todoComoEntrada,
    `cobrar el caché como entrada normal costaría ${todoComoEntrada} en vez de ${correcto}`,
  );
  assert.equal(ev.billedCents, centavos(correcto));
  assert.equal(estado.saldoCents, 100_000 - centavos(correcto));

  // La columna `cacheTokens` guarda el TOTAL (lectura + escritura), como en
  // `record-usage.ts`: el reparto por precio ya está dentro de costUsdMicros,
  // así que esto no necesita ninguna columna nueva ni ningún SQL.
  assert.equal(ev.cacheTokens, 400_000);
  assert.equal(ev.inputTokens, 1_000, "inputTokens es SOLO lo que no salió del caché");
});

test("si Anthropic no manda los contadores de caché, se cobra exactamente como antes", async () => {
  // Formato nuevo, campos renombrados, caché apagado: Sabina contesta y cobra
  // bien igual, al precio de siempre. Nunca de más.
  estado.guion = () => contesta("Tienes 3 citas hoy.", { input_tokens: 400_000, output_tokens: 20_000 });

  assert.equal((await preguntar("¿Cuántas citas tengo hoy?")).status, 200);

  const ev = estado.eventos[0];
  assert.equal(ev.costUsdMicros, 400_000 * 1 + 20_000 * 5);
  assert.equal(ev.cacheTokens, 0);
});

test("contadores de caché con basura dentro no rompen ni inflan el cobro", async () => {
  estado.guion = () =>
    contestaConCache("Tienes 3 citas hoy.", {
      input_tokens: 400_000,
      output_tokens: 20_000,
      // Lo que podría llegar si la API cambiara: texto, negativo, ausente.
      cache_read_input_tokens: "muchos" as unknown as number,
      cache_creation_input_tokens: -5 as unknown as number,
    });

  assert.equal((await preguntar("¿Cuántas citas tengo hoy?")).status, 200);

  const ev = estado.eventos[0];
  assert.equal(ev.costUsdMicros, 400_000 * 1 + 20_000 * 5, "un contador ilegible tiene que caer a 0, no colarse en el cobro");
  assert.equal(ev.cacheTokens, 0);
});

test("cada llamada lleva el catálogo marcado, y la última lo conserva con tool_choice: none", async () => {
  // La barata agota las rondas sin contestar para llegar a la última vuelta.
  estado.guion = ({ model, n }) =>
    model === "claude-haiku-4-5" && n <= 4
      ? pideHerramienta("citas_del_dia", { input_tokens: 1_000, output_tokens: 100 })
      : contesta("Con lo que vi: tienes citas.", { input_tokens: 1_000, output_tokens: 100 });

  assert.equal((await preguntar("¿Cuántas citas tengo hoy?")).status, 200);
  assert.ok(estado.peticiones.length >= 5, `hicieron falta 5 llamadas y hubo ${estado.peticiones.length}`);

  for (const [i, p] of estado.peticiones.entries()) {
    // El corte 1: en la ÚLTIMA herramienta, y SOLO ahí. Es el prefijo que
    // comparten todas las clínicas.
    assert.ok(Array.isArray(p.tools) && p.tools.length > 0, `la llamada ${i + 1} viajó sin catálogo: rompe el prefijo`);
    const marcadas = p.tools.filter((t: any) => t.cache_control);
    assert.equal(marcadas.length, 1, `la llamada ${i + 1} tiene ${marcadas.length} herramientas marcadas`);
    assert.equal(marcadas[0].name, p.tools[p.tools.length - 1].name, "el marcador no está en la última herramienta");
    // El corte 2: al final del system, que ahora es un bloque de texto.
    assert.equal(p.system[0].type, "text");
    assert.deepEqual(p.system[0].cache_control, { type: "ephemeral" });
  }

  // El catálogo es el MISMO en todas: un solo nombre distinto rompería el caché.
  const catalogos = estado.peticiones.map((p: any) => p.tools.map((t: any) => t.name).join("|"));
  assert.equal(new Set(catalogos).size, 1, "el catálogo cambia entre llamadas: el prefijo no se reaprovecharía");
  // Y el prompt del sistema también, dentro de la misma pregunta.
  assert.equal(new Set(estado.peticiones.map((p: any) => p.system[0].text)).size, 1);

  // La última vuelta: herramientas puestas (prefijo intacto) y apagadas con
  // tool_choice, no con una lista vacía.
  const ultima = estado.peticiones[4];
  assert.deepEqual(ultima.tool_choice, { type: "none" }, "la última ronda tiene que apagar las herramientas con tool_choice");
  assert.equal(ultima.tools.length, estado.peticiones[0].tools.length, "la última ronda se quedó sin catálogo y perdió el caché");
  // Y las anteriores NO lo llevan: el modelo tiene que poder consultar.
  for (const p of estado.peticiones.slice(0, 4)) assert.equal(p.tool_choice, undefined);
});

test("SABINA_CACHE=0 es el freno de mano: ni un marcador sale, y Sabina contesta igual", async (t) => {
  process.env.SABINA_CACHE = "0";
  t.after(() => { delete process.env.SABINA_CACHE; });

  estado.guion = () => contesta("Tienes 3 citas hoy.", { input_tokens: 400_000, output_tokens: 20_000 });
  const res = await preguntar("¿Cuántas citas tengo hoy?");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).respuesta, "Tienes 3 citas hoy.");

  const p = estado.peticiones[0];
  assert.equal(p.tools.filter((t: any) => t.cache_control).length, 0);
  assert.equal(p.system[0].cache_control, undefined);
  // El catálogo y el prompt siguen viajando enteros: apagar el caché no le
  // quita al modelo ni una herramienta.
  assert.ok(p.tools.length > 0 && typeof p.system[0].text === "string" && p.system[0].text.length > 0);
});

test("el catálogo sale byte a byte igual en preguntas distintas: es lo que permite compartir el caché", async () => {
  // El invariante del que depende TODO el ahorro. `zodAJsonSchema` se ejecuta en
  // cada pregunta, y si algún día generara las claves en otro orden —un Set, un
  // Object.keys sin ordenar— el prefijo cambiaría en cada petición: Anthropic
  // escribiría una entrada nueva cada vez y no leería ninguna. Nada fallaría;
  // solo subiría la factura. Por eso se compara el JSON crudo y no los nombres.
  estado.guion = () => contesta("Tienes 3 citas hoy.", { input_tokens: 1_000, output_tokens: 100 });

  assert.equal((await preguntar("¿Cuántas citas tengo hoy?")).status, 200);
  assert.equal((await preguntar("¿quién me debe dinero?")).status, 200);
  assert.equal(estado.peticiones.length, 2);

  assert.equal(
    JSON.stringify(estado.peticiones[0].tools),
    JSON.stringify(estado.peticiones[1].tools),
    "el catálogo cambia entre preguntas: el caché no se reaprovecharía ni dentro de una clínica",
  );
});
