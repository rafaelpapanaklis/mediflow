/**
 * SABINA DE PUNTA A PUNTA — la primera vez que alguien le pregunta algo.
 *
 *   npm run test:sabina-punta-a-punta
 *
 * Lo que corre DE VERDAD: el handler `POST /api/sabina`, el motor
 * (`ejecutarSabina` con su `llamarAnthropic`), el catálogo de las diez
 * herramientas y sus consultas, evaluadas contra el doble de base con DOS
 * clínicas de `tools/__tests__/doble-base.ts`. `hasPermission`,
 * `buildAppointmentWhere` y compañía son los reales.
 *
 * Lo que se sustituye, y por qué:
 *  · `fetch` global → un doble de la API de Anthropic. Recibe el cuerpo HTTP
 *    que mandaría el motor (modelo, tools, messages) y contesta con la forma
 *    de `/v1/messages`. No hay clave real y NO sale ni una petición a la red.
 *  · `getAuthContext` → la sesión de la persona de la prueba. El resto de
 *    `@/lib/auth-context` (los where-builders) es el real.
 *  · `@/lib/prisma` → el doble de base.
 *  · El dinero (`canSpend`, `chargeUsage`, `recordUsageNoCharge`, el cupo) y el
 *    historial → registradores, para comprobar QUÉ se cobra sin tocar la base.
 *  · `persistentRateLimit` → siempre deja pasar.
 */
import "../engine-sin-server-only"; // PRIMERO: engine.ts arrastra "server-only"
import { before, beforeEach, test, mock } from "node:test";
import assert from "node:assert/strict";

import { CL_NORTE, TZ_NORTE, U_ADMIN_N, U_RECEP_N, adminNorte, base } from "../tools/__tests__/siembra";
import type { BaseDoble } from "../tools/__tests__/doble-base";

/* ── Estado que leen los dobles ─────────────────────────────────────── */

interface Sesion {
  userId: string;
  clinicId: string;
  role: string;
  permissionsOverride: string[];
  clinic: { timezone: string; category: string };
  isAdmin: boolean;
}

const estado = {
  db: null as BaseDoble | null,
  sesion: null as Sesion | null,
  saldo: true,
  cobros: [] as Array<Record<string, unknown>>,
  noCobros: [] as Array<Record<string, unknown>>,
  cupo: [] as unknown[][],
  /** Cada petición HTTP que el motor mandó a Anthropic, ya parseada. */
  peticiones: [] as Array<{ model: string; system: string; tools?: any[]; messages: any[] }>,
  /** Guion del doble de Anthropic: recibe la petición y devuelve el cuerpo de /v1/messages. */
  guion: null as null | ((p: { model: string; messages: any[]; n: number }) => Record<string, unknown>),
  historial: [] as Array<{ op: string; scope: unknown; id?: string }>,
  /** Si se pone, guardar la conversación lanza este error (p. ej. un timeout del pooler). */
  falloHistorial: null as null | Error,
};

function sesionAdminNorte(): Sesion {
  return {
    userId: U_ADMIN_N,
    clinicId: CL_NORTE,
    role: "ADMIN",
    permissionsOverride: [],
    clinic: { timezone: TZ_NORTE, category: "DENTAL" },
    isAdmin: true,
  };
}

/** Respuesta de /v1/messages que pide UNA herramienta. */
function pideHerramienta(nombre: string, input: unknown, uso = { input_tokens: 1000, output_tokens: 40 }) {
  return {
    content: [{ type: "tool_use", id: `tu_${nombre}`, name: nombre, input }],
    stop_reason: "tool_use",
    usage: uso,
  };
}

/** Respuesta de /v1/messages que contesta con texto. */
function contesta(texto: string, uso = { input_tokens: 1200, output_tokens: 90 }) {
  return { content: [{ type: "text", text: texto }], stop_reason: "end_turn", usage: uso };
}

/** El `tool_result` que el motor le devolvió al modelo en la última petición. */
function ultimoToolResult(messages: any[]): any {
  const ultimo = messages[messages.length - 1];
  const bloque = Array.isArray(ultimo?.content) ? ultimo.content.find((b: any) => b.type === "tool_result") : null;
  return bloque ? JSON.parse(bloque.content) : null;
}

let POST: (req: any) => Promise<Response>;
let NextRequestCtor: any;
let herramientas: typeof import("../tools/index");

before(async () => {
  process.env.ANTHROPIC_API_KEY = "sk-prueba-no-es-real";
  delete process.env.SABINA_MODELO_DIRECTA;
  delete process.env.SABINA_MODELO_ABIERTA;

  globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
    assert.equal(String(url), "https://api.anthropic.com/v1/messages", "el motor solo debe hablar con Anthropic");
    const cuerpo = JSON.parse(init?.body ?? "{}");
    estado.peticiones.push(cuerpo);
    assert.ok(estado.guion, "una prueba llamó al modelo sin guion");
    const respuesta = estado.guion({ model: cuerpo.model, messages: cuerpo.messages, n: estado.peticiones.length });
    return new Response(JSON.stringify(respuesta), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  mock.module("@/lib/auth/two-factor-identity", {
    namedExports: { personaTieneDosFactores: async () => false, dosFactoresDeLaPersona: async () => false },
  });
  const prismaDoble = new Proxy({}, { get: (_t, clave) => (estado.db as any)?.[clave] });
  mock.module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });

  // Los where-builders reales; solo la sesión es de la prueba.
  const authReal = await import("@/lib/auth-context");
  mock.module("@/lib/auth-context", {
    namedExports: { ...authReal, getAuthContext: async () => estado.sesion },
  });

  mock.module("@/lib/failban", { namedExports: { persistentRateLimit: async () => null } });
  mock.module("@/lib/ai-tokens", {
    namedExports: {
      aiTokenLimitError: async () => null,
      addAiTokens: async (...args: unknown[]) => {
        estado.cupo.push(args);
      },
    },
  });
  mock.module("@/lib/ai-billing/wallet", {
    namedExports: {
      canSpend: async () => estado.saldo,
      chargeUsage: async (input: Record<string, unknown>) => {
        estado.cobros.push(input);
        return { billedCents: 1, balanceAfterCents: 100, eventId: `ev_${estado.cobros.length}` };
      },
    },
  });
  mock.module("@/lib/ai-billing/record-usage", {
    namedExports: {
      recordUsageNoCharge: async (input: Record<string, unknown>) => {
        estado.noCobros.push(input);
      },
    },
  });

  class AiScopeError extends Error {}
  mock.module("@/lib/ai-assistant/conversations", {
    namedExports: {
      AiScopeError,
      isAiHistoryStorageMissing: () => false,
      getConversation: async (scope: unknown, id: string) => {
        estado.historial.push({ op: "asistente.get", scope, id });
        return null;
      },
      appendMessages: async (scope: unknown, id: string) => {
        estado.historial.push({ op: "asistente.append", scope, id });
        return null;
      },
      createConversation: async (scope: unknown) => {
        estado.historial.push({ op: "asistente.create", scope });
        return { conversation: { id: "conv-del-asistente" }, messages: [] };
      },
      listConversations: async () => [],
    },
  });
  // El historial propio de Sabina. Antes de la integración este módulo no
  // existía: si no se puede registrar el doble, las pruebas del historial
  // fallan por su lado y el resto sigue corriendo.
  try {
    mock.module("@/lib/sabina/engine-historial", {
      namedExports: {
        listarConversacionesSabina: async (scope: unknown) => {
          estado.historial.push({ op: "sabina.listar", scope });
          return [{ id: "conv-sabina", title: "¿Cuántas citas tengo hoy?", updatedAt: 1_757_700_000_000 }];
        },
        leerConversacionSabina: async (scope: unknown, id: string) => {
          estado.historial.push({ op: "sabina.leer", scope, id });
          if (id !== "conv-sabina") return null;
          return {
            conversation: { id, title: "¿Cuántas citas tengo hoy?", group: "admin", updatedAt: 1, createdAt: 1, messageCount: 2 },
            messages: [
              { id: "m1", role: "user", content: "¿Cuántas citas tengo hoy?", timestamp: 1 },
              { id: "m2", role: "assistant", content: "Tienes 3.", timestamp: 2 },
            ],
          };
        },
        crearConversacionSabina: async (scope: unknown) => {
          if (estado.falloHistorial) throw estado.falloHistorial;
          estado.historial.push({ op: "sabina.crear", scope });
          return "conv-sabina";
        },
        anexarTurnosSabina: async (scope: unknown, id: string) => {
          estado.historial.push({ op: "sabina.anexar", scope, id });
          return id === "conv-sabina";
        },
      },
    });
  } catch {
    /* ver arriba */
  }

  ({ NextRequest: NextRequestCtor } = await import("next/server"));
  herramientas = await import("../tools/index");
  ({ POST } = await import("@/app/api/sabina/route"));
});

beforeEach(() => {
  estado.db = base();
  estado.sesion = sesionAdminNorte();
  estado.saldo = true;
  estado.cobros = [];
  estado.noCobros = [];
  estado.cupo = [];
  estado.peticiones = [];
  estado.guion = null;
  estado.historial = [];
  estado.falloHistorial = null;
});

function preguntar(pregunta: string, extra: Record<string, unknown> = {}) {
  return POST(
    new NextRequestCtor("http://localhost/api/sabina", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pregunta, ...extra }),
    }),
  );
}

/* ══════════════════════════════════════════════════════════════════════
 * 1 · El catálogo llega al modelo
 * ══════════════════════════════════════════════════════════════════════ */

const LAS_DIEZ = [
  "agenda_ocupacion",
  "ausencias",
  "buscar_paciente",
  "citas_del_dia",
  "ingresos_por_periodo",
  "pacientes_con_deuda",
  "pacientes_inactivos",
  "pacientes_nuevos",
  "resumen_clinica",
  "tratamientos_por_ingreso",
];

/** Las de agenda y pacientes (ws1-t2, ws1-t3): proponer_horarios lee; las otras cuatro solo proponen. */
const LAS_NUEVAS = ["agendar_cita", "cancelar_cita", "proponer_horarios", "reagendar_cita", "registrar_paciente"];

/** Las tres de CLÍNICO (ws1-t4): todas de solo lectura. */
const LAS_DE_CLINICO = ["recetas", "estudios_del_paciente", "analisis_y_notas_de_estudio"];

test("el modelo recibe las diez de consulta, las cinco de agenda y pacientes, y las tres de clínico, con su esquema", async () => {
  estado.guion = () => contesta("Hola.");
  const res = await preguntar("hola");
  assert.equal(res.status, 200);

  const tools = estado.peticiones[0]?.tools ?? [];
  assert.deepEqual(tools.map((t: any) => t.name).sort(), [...LAS_DIEZ, ...LAS_NUEVAS, ...LAS_DE_CLINICO].sort());

  const { SABINA_TOOLS } = await import("../engine-catalog");
  for (const t of tools) {
    const tool = SABINA_TOOLS.find((h) => h.nombre === t.name)!;
    assert.equal(t.input_schema.type, "object", t.name);
    assert.ok(t.description.length > 40, `${t.name}: sin descripción para el modelo`);
    // Cada parámetro del zod aparece en el esquema, y ninguno es clinicId.
    const claves = Object.keys((tool.parametros as any).shape ?? {});
    assert.deepEqual(Object.keys(t.input_schema.properties).sort(), claves.sort(), t.name);
    assert.ok(!("clinicId" in t.input_schema.properties), t.name);
  }
});

test("las fechas llegan al modelo con su formato AAAA-MM-DD, no como texto libre", async () => {
  estado.guion = () => contesta("Hola.");
  await preguntar("hola");

  const citas = estado.peticiones[0].tools!.find((t: any) => t.name === "citas_del_dia");
  const ingresos = estado.peticiones[0].tools!.find((t: any) => t.name === "ingresos_por_periodo");
  for (const prop of [citas.input_schema.properties.fecha, ingresos.input_schema.properties.desde]) {
    assert.equal(prop.type, "string");
    assert.ok(prop.pattern && new RegExp(prop.pattern).test("2026-09-12"), JSON.stringify(prop));
    assert.ok(!new RegExp(prop.pattern).test("12/09/2026"), JSON.stringify(prop));
  }
});

test("el «hoy» del prompt es el de la clínica, y va en AAAA-MM-DD", async (t) => {
  // 20:00 UTC del 12: en México (default) sigue siendo 12, en UTC también; en
  // Tokio ya es 13. Solo la zona de la SESIÓN da 13.
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-12T20:00:00Z") });
  estado.sesion = { ...sesionAdminNorte(), clinic: { timezone: "Asia/Tokyo", category: "DENTAL" } };
  estado.guion = () => contesta("Hola.");
  await preguntar("hola");
  assert.match(estado.peticiones[0].system, /\(2026-09-13\)/, "el prompt no trae la fecha de la clínica");
});

/* ══════════════════════════════════════════════════════════════════════
 * 2 · Una pregunta de verdad, contestada con el dato de la base
 * ══════════════════════════════════════════════════════════════════════ */

test("«¿cuántas citas tengo hoy?» — de la pregunta al JSON, con el número real", async () => {
  // Lo que la herramienta contesta si se le llama DIRECTO, sin motor.
  const directo = await herramientas.ejecutarHerramienta("citas_del_dia", adminNorte(estado.db!), {});
  assert.equal(directo.ok, true, JSON.stringify(directo));
  const resumenDirecto = (directo as { resumen: string }).resumen;

  estado.guion = ({ n, messages }) => {
    if (n === 1) return pideHerramienta("citas_del_dia", {});
    const resultado = ultimoToolResult(messages);
    assert.equal(resultado?.ok, true, `la herramienta no contestó bien: ${JSON.stringify(resultado)}`);
    return contesta(`Según la agenda: ${resultado.resumen}`);
  };

  const res = await preguntar("¿Cuántas citas tengo hoy?");
  assert.equal(res.status, 200);
  const json = await res.json();

  assert.deepEqual(Object.keys(json).sort(), ["conversacionId", "herramientasUsadas", "modelo", "respuesta", "tokens"]);
  assert.equal(json.respuesta, `Según la agenda: ${resumenDirecto}`);
  assert.deepEqual(json.herramientasUsadas, ["citas_del_dia"]);
  assert.equal(json.modelo, "claude-haiku-4-5");
  assert.deepEqual(json.tokens, { entrada: 2200, salida: 130 });
  assert.equal(json.conversacionId, "conv-sabina");
});

test("sin permiso de facturación, lo DICE — con la herramienta real y el permiso real", async () => {
  estado.sesion = {
    ...sesionAdminNorte(),
    userId: U_RECEP_N,
    role: "RECEPTIONIST",
    permissionsOverride: ["agenda.view", "patients.view"],
    isAdmin: false,
  };
  let resultado: any = null;
  estado.guion = ({ n, messages }) => {
    if (n === 1) return pideHerramienta("ingresos_por_periodo", {});
    resultado = ultimoToolResult(messages);
    // El modelo «se come» el aviso: la red del motor tiene que ponerlo.
    return contesta("Este mes la clínica va bien.");
  };

  const res = await preguntar("¿Cuánto facturé este mes?");
  assert.equal(res.status, 200);
  const json = await res.json();

  assert.equal(resultado?.motivo, "sin_permiso", JSON.stringify(resultado));
  assert.match(json.respuesta, /No tienes acceso a facturación/);
  assert.doesNotMatch(json.respuesta, /no tengo datos/i);
});

test("«¿cómo va la clínica?» sin facturación: el resumen omite dinero y la respuesta LO DICE", async () => {
  estado.sesion = {
    ...sesionAdminNorte(),
    userId: U_RECEP_N,
    role: "RECEPTIONIST",
    permissionsOverride: ["today.view", "agenda.view", "patients.view"],
    isAdmin: false,
  };
  let resultado: any = null;
  estado.guion = ({ n, messages }) => {
    if (n === 1) return pideHerramienta("resumen_clinica", {});
    resultado = ultimoToolResult(messages);
    // Haiku contesta con lo que sí vino y se calla lo omitido.
    return contesta("Hoy tienes citas y pacientes nuevos este mes.");
  };

  const res = await preguntar("¿Cómo va la clínica?");
  const json = await res.json();
  assert.equal(resultado?.ok, true, JSON.stringify(resultado));
  assert.ok(resultado.datos.omitidas.some((o: any) => o.permiso === "billing.view"), JSON.stringify(resultado.datos.omitidas));
  assert.match(json.respuesta, /No tienes acceso a facturación/);
});

test("una clínica no ve los datos de otra aunque el modelo cuele su clinicId", async () => {
  let resultado: any = null;
  estado.guion = ({ n, messages }) => {
    if (n === 1) return pideHerramienta("buscar_paciente", { termino: "a", clinicId: "cl-sur" });
    resultado = ultimoToolResult(messages);
    return contesta("Listo.");
  };
  const res = await preguntar("busca pacientes con a");
  assert.equal(res.status, 200);
  // No vale pasar en vacío: la búsqueda tiene que haber encontrado a los de SU clínica.
  assert.equal(resultado?.ok, true, JSON.stringify(resultado));
  assert.ok(resultado.datos.resultados.filas.length > 0, JSON.stringify(resultado));
  // Los pacientes del sur se apellidan «SUR» y su folio empieza por S: «Sofia», «Saul»… también llevan «a».
  const texto = JSON.stringify(resultado);
  assert.ok(!texto.includes("SUR") && !texto.includes("S000"), `se coló un paciente de la otra clínica: ${texto}`);
});

/* ══════════════════════════════════════════════════════════════════════
 * 3 · El dinero: del monedero, con su AiUsageEvent, y al precio de cada modelo
 * ══════════════════════════════════════════════════════════════════════ */

test("cobra del monedero con chargeUsage (feature sabina), no como IA incluida en el plan", async () => {
  estado.guion = ({ n }) => (n === 1 ? pideHerramienta("citas_del_dia", {}) : contesta("Tienes citas."));
  const res = await preguntar("¿Cuántas citas tengo hoy?");
  assert.equal(res.status, 200);

  assert.equal(estado.noCobros.length, 0, "Sabina no debe registrarse como IA absorbida por el plan");
  // Y no se cobra dos veces: lo que paga el monedero no se descuenta además del cupo del plan.
  assert.deepEqual(estado.cupo, [], "Sabina gastó el cupo del plan además de cobrar al monedero");
  assert.deepEqual(estado.cobros, [
    { clinicId: CL_NORTE, feature: "sabina", model: "claude-haiku-4-5", inputTokens: 2200, outputTokens: 130 },
  ]);
});

test("si escala al modelo caro, cada modelo se cobra con SUS tokens (un AiUsageEvent por modelo)", async () => {
  // La pasada barata pide herramientas hasta agotar las rondas y no contesta;
  // la cara cierra. Tokens distintos por modelo para poder separarlos.
  estado.guion = ({ model }) => {
    if (model === "claude-haiku-4-5") {
      const pedidas = estado.peticiones.filter((p) => p.model === model).length;
      return pedidas <= 4
        ? pideHerramienta("citas_del_dia", {}, { input_tokens: 100, output_tokens: 10 })
        : contesta("", { input_tokens: 100, output_tokens: 10 });
    }
    return contesta("Con lo que vi: tienes citas.", { input_tokens: 5000, output_tokens: 300 });
  };

  const res = await preguntar("¿Cuántas citas tengo hoy?");
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.modelo, "claude-sonnet-4-6");

  const porModelo = Object.fromEntries(estado.cobros.map((c) => [c.model, [c.inputTokens, c.outputTokens]]));
  assert.deepEqual(porModelo, {
    "claude-haiku-4-5": [500, 50],
    "claude-sonnet-4-6": [5000, 300],
  });
});

test("sin saldo → 402, sin llamar al modelo y sin cobrar nada", async () => {
  estado.saldo = false;
  estado.guion = () => contesta("no debería llegar aquí");
  const res = await preguntar("¿Cuántas citas tengo hoy?");
  assert.equal(res.status, 402);
  const json = await res.json();
  assert.equal(json.sinSaldo, true);
  assert.equal(estado.peticiones.length, 0);
  assert.equal(estado.cobros.length, 0);
});

test("sin sesión → 401", async () => {
  estado.sesion = null;
  const res = await preguntar("hola");
  assert.equal(res.status, 401);
});

test("si Anthropic cae, 503 — y lo gastado hasta ahí se cobra igual", async () => {
  estado.guion = ({ n }) => (n === 1 ? pideHerramienta("citas_del_dia", {}) : ({ __error: true } as any));
  const fetchBueno = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
    const r = await fetchBueno(url as string, init as RequestInit);
    const cuerpo = await r.clone().json();
    return cuerpo.__error ? new Response("overloaded", { status: 529 }) : r;
  }) as typeof fetch;
  try {
    const res = await preguntar("¿Cuántas citas tengo hoy?");
    assert.equal(res.status, 503);
    assert.equal(estado.cobros.length, 1);
    assert.equal(estado.cobros[0].inputTokens, 1000);
  } finally {
    globalThis.fetch = fetchBueno;
  }
});

test("si guardar el historial falla DESPUÉS de cobrar, el doctor recibe su respuesta (no un 503 reintentable)", async () => {
  estado.falloHistorial = Object.assign(new Error("Timed out fetching a new connection from the pool"), { code: "P2024" });
  estado.guion = () => contesta("Tienes 3 citas.");
  const res = await preguntar("¿Cuántas citas tengo hoy?");
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.respuesta, "Tienes 3 citas.");
  assert.equal(estado.cobros.length, 1);
});

/* ══════════════════════════════════════════════════════════════════════
 * 4 · El historial: lo que la pantalla llama existe y tiene su forma
 * ══════════════════════════════════════════════════════════════════════ */

test("POST guarda en el historial de SABINA, con el scope de la sesión", async () => {
  estado.guion = () => contesta("Hola.");
  await preguntar("hola");
  const ops = estado.historial.map((h) => h.op);
  assert.ok(ops.includes("sabina.crear"), `ops: ${ops.join(", ")}`);
  assert.ok(!ops.some((o) => o.startsWith("asistente.")), `tocó el historial del Asistente IA: ${ops.join(", ")}`);
  assert.deepEqual(estado.historial.find((h) => h.op === "sabina.crear")!.scope, {
    clinicId: CL_NORTE,
    userId: U_ADMIN_N,
  });
});

test("un conversacionId del Asistente IA no se usa como hilo de Sabina", async () => {
  estado.guion = () => contesta("Hola.");
  const res = await preguntar("hola", { conversacionId: "conv-del-asistente" });
  const json = await res.json();
  assert.equal(json.conversacionId, "conv-sabina");
  // El modelo no recibió turnos previos de esa conversación.
  assert.equal(estado.peticiones[0].messages.length, 1);
});

test("GET /api/sabina/conversations — la forma que lee la barra de historial", async () => {
  const { GET } = await import("@/app/api/sabina/conversations/route");
  const res = await GET(new NextRequestCtor("http://localhost/api/sabina/conversations"));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(Array.isArray(json.conversations));
  const fila = json.conversations[0];
  assert.equal(typeof fila.id, "string");
  assert.equal(typeof fila.title, "string");
  assert.equal(typeof fila.updatedAt, "number");
  assert.deepEqual(estado.historial[0].scope, { clinicId: CL_NORTE, userId: U_ADMIN_N });
});

test("GET /api/sabina/conversations/:id — turnos con la forma de la pantalla, 404 si no es de Sabina", async () => {
  const { GET } = await import("@/app/api/sabina/conversations/[id]/route");

  const res = await GET(new NextRequestCtor("http://localhost/api/sabina/conversations/conv-sabina"), {
    params: { id: "conv-sabina" },
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.conversation.id, "conv-sabina");
  for (const m of json.messages) {
    assert.equal(typeof m.content, "string");
    assert.ok(m.role === "user" || m.role === "assistant");
    assert.equal(typeof m.timestamp, "number");
  }

  const ajena = await GET(new NextRequestCtor("http://localhost/api/sabina/conversations/conv-del-asistente"), {
    params: { id: "conv-del-asistente" },
  });
  assert.equal(ajena.status, 404);

  estado.sesion = null;
  const sinSesion = await GET(new NextRequestCtor("http://localhost/api/sabina/conversations/conv-sabina"), {
    params: { id: "conv-sabina" },
  });
  assert.equal(sinSesion.status, 401);
});
