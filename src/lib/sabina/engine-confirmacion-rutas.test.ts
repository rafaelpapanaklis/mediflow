/**
 * La confirmación de punta a punta, por los handlers de verdad:
 *
 *   pregunta → POST /api/sabina → tarjeta guardada (nada ejecutado)
 *            → POST /api/sabina/propuestas/:id/confirmar → se ejecuta UNA vez
 *
 *   npm run test:sabina-confirmacion-rutas
 *
 * Corren de verdad: los dos handlers, el motor, el adaptador de acciones, el
 * candado de solo lectura, `guardarPropuesta`/`confirmarPropuesta` y su lógica
 * de estados. Se sustituyen, como en `__tests__/punta-a-punta.test.ts`: la API
 * de Anthropic (fetch), la sesión, el monedero, el freno de ráfagas y el
 * historial; `@/lib/prisma` es el doble de `audit_logs`; y el catálogo lleva UNA
 * acción de prueba (hoy `ACCIONES_SABINA` está vacío: las de verdad las traen
 * ws1-t2 y ws1-t3).
 */
import "./engine-sin-server-only"; // PRIMERO
import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { definirAccion, herramientaDeAccion } from "./engine-acciones";
import { crearBaseDePropuestas } from "./engine-propuestas-doble";
import { ENTIDAD_PROPUESTA, EVENTO } from "./engine-propuestas-core";

const estado = {
  base: crearBaseDePropuestas(() => Date.now()),
  sesion: null as null | Record<string, unknown>,
  guion: [] as Array<Record<string, unknown>>,
  peticionesModelo: 0,
  preparaciones: 0,
  ejecuciones: 0,
  alEndpoint: [] as Array<{ metodo: string; ruta: string; cuerpo: unknown }>,
};

function sesion(userId = "us_recepcion") {
  return {
    userId,
    clinicId: "cl_mia",
    role: "RECEPTIONIST",
    permissionsOverride: [],
    clinic: { timezone: "America/Mexico_City", category: "DENTAL" },
    isAdmin: false,
  };
}

async function citasPost(req: Request) {
  estado.alEndpoint.push({ metodo: req.method, ruta: new URL(req.url).pathname, cuerpo: await req.json().catch(() => null) });
  return new Response(JSON.stringify({ appointment: { id: "ap_9" }, scheduleWarning: null }), { status: 201 });
}

const agendar = definirAccion({
  nombre: "agendar_cita",
  descripcion: "Prepara una cita nueva.",
  titulo: "Agendar cita",
  boton: "Sí, agendar",
  queHace: "agendar citas",
  permiso: "agenda.create",
  deshacer: { reversible: true, como: "Cancelando la cita desde la Agenda." },
  parametros: z.object({ paciente: z.string() }),
  datos: z.object({ patientId: z.string(), date: z.string(), startTime: z.string() }),
  preparar: async (_ctx, p) => {
    estado.preparaciones += 1;
    return {
      tipo: "propuesta",
      datos: { patientId: "pa_maria", date: "2026-09-18", startTime: "10:00" },
      tarjeta: {
        frase: `Agendar a ${p.paciente} el jueves 18 a las 10:00 con el Dr. Ruiz`,
        detalles: [{ etiqueta: "Paciente", valor: "María López (P0142)" }],
        avisos: ["El paciente no recibirá aviso."],
      },
    };
  },
  huella: async () => "libre",
  ejecutar: async (llave, _ctx, datos) => {
    estado.ejecuciones += 1;
    const r = await llave.llamar(citasPost, { metodo: "POST", ruta: "/api/appointments", cuerpo: datos });
    return r.status === 201 ? { ok: true, frase: "Agendé a María López el jueves 18 a las 10:00." } : { ok: false, tipo: "error", frase: "No." };
  },
});

let preguntar: (texto: string) => Promise<Response>;
let confirmarRuta: (id: string, headers?: Record<string, string>) => Promise<Response>;
let descartarRuta: (id: string) => Promise<Response>;
let leerConversacion: (id: string) => Promise<Response>;
let consultarRuta: (id: string) => Promise<Response>;

before(async () => {
  process.env.ANTHROPIC_API_KEY = "sk-prueba-no-es-real";
  globalThis.fetch = (async (url: unknown) => {
    assert.equal(String(url), "https://api.anthropic.com/v1/messages");
    estado.peticionesModelo += 1;
    const siguiente = estado.guion.shift();
    assert.ok(siguiente, "el modelo se llamó más veces que el guion");
    return new Response(JSON.stringify(siguiente), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  // Sin fila en sabina_user_permissions: Sabina con todo lo del usuario, lo de
  // siempre. El recorte del Super Admin se prueba en `test:sabina-permisos-equipo`.
  const sinAjustesSabina = { findFirst: async () => null };
  const prismaDoble = new Proxy({}, {
    get: (_t, k) => (k === "sabinaUserPermission" ? sinAjustesSabina : (estado.base.db as any)[k]),
  });
  mock.module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });
  mock.module("@/lib/auth/two-factor-identity", {
    namedExports: { personaTieneDosFactores: async () => false, dosFactoresDeLaPersona: async () => false },
  });
  const authReal = await import("@/lib/auth-context");
  mock.module("@/lib/auth-context", { namedExports: { ...authReal, getAuthContext: async () => estado.sesion } });
  mock.module("@/lib/failban", { namedExports: { persistentRateLimit: async () => null } });
  mock.module("@/lib/ai-billing/wallet", {
    namedExports: {
      canSpend: async () => true,
      chargeUsage: async () => ({ billedCents: 1, balanceAfterCents: 1, eventId: "ev" }),
      // La ruta reserva el costo de la pregunta antes de llamar (H6) y la suelta al final.
      reservarSaldo: async () => ({ id: "res", clinicId: "c", amountCents: 1 }),
      liberarReserva: async () => {},
      estimarCostoCents: async () => 1,
    },
  });
  mock.module("@/lib/ai-assistant/conversations", { namedExports: { isAiHistoryStorageMissing: () => false } });
  mock.module("@/lib/ai-assistant/api", {
    namedExports: {
      resolveAiScope: async () =>
        estado.sesion
          ? { response: null, scope: { clinicId: estado.sesion.clinicId, userId: estado.sesion.userId } }
          : { response: new Response(null, { status: 401 }), scope: null },
      aiHistoryErrorResponse: () => new Response(null, { status: 503 }),
    },
  });
  mock.module("@/lib/sabina/engine-historial", {
    namedExports: {
      leerConversacionSabina: async (_s: unknown, id: string) =>
        id === "conv_1"
          ? { conversation: { id, title: "agenda", updatedAt: 1 }, messages: [{ id: "m1", role: "user", content: "agenda", timestamp: 1 }] }
          : null,
      crearConversacionSabina: async () => "conv_1",
      anexarTurnosSabina: async () => true,
      listarConversacionesSabina: async () => [],
    },
  });
  mock.module("@/lib/sabina/engine-catalog", {
    namedExports: {
      ACCIONES_SABINA: [agendar],
      SABINA_TOOLS: [herramientaDeAccion(agendar)],
      AI_FEATURE_SABINA: "sabina",
    },
  });

  const { NextRequest } = await import("next/server");
  const sabina = await import("@/app/api/sabina/route");
  const confirmar = await import("@/app/api/sabina/propuestas/[id]/confirmar/route");
  const descartar = await import("@/app/api/sabina/propuestas/[id]/descartar/route");
  const conversacion = await import("@/app/api/sabina/conversations/[id]/route");
  const consulta = await import("@/app/api/sabina/propuestas/[id]/route");
  consultarRuta = (id) => consulta.GET(new NextRequest(`http://app.test/api/sabina/propuestas/${id}`), { params: { id } });

  preguntar = (texto) =>
    sabina.POST(
      new NextRequest("http://app.test/api/sabina", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pregunta: texto }),
      }),
    );
  const mismaPagina = { host: "app.test", origin: "http://app.test", "content-type": "application/json", cookie: "sb=1" };
  confirmarRuta = (id, headers = mismaPagina) =>
    confirmar.POST(
      new NextRequest(`http://app.test/api/sabina/propuestas/${id}/confirmar`, { method: "POST", headers, body: "{}" }),
      { params: { id } },
    );
  descartarRuta = (id) =>
    descartar.POST(
      new NextRequest(`http://app.test/api/sabina/propuestas/${id}/descartar`, { method: "POST", headers: mismaPagina, body: "{}" }),
      { params: { id } },
    );
  leerConversacion = (id) => conversacion.GET(new NextRequest(`http://app.test/api/sabina/conversations/${id}`), { params: { id } });
});

beforeEach(() => {
  estado.base = crearBaseDePropuestas(() => Date.now());
  estado.sesion = sesion();
  estado.guion = [];
  estado.peticionesModelo = 0;
  estado.preparaciones = 0;
  estado.ejecuciones = 0;
  estado.alEndpoint = [];
});

function guionAgendar() {
  estado.guion = [
    { content: [{ type: "tool_use", id: "tu_1", name: "agendar_cita", input: { paciente: "María López" } }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } },
    { content: [{ type: "text", text: "Te propongo agendar a María López el jueves 18 a las 10:00. Confírmalo en la tarjeta." }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } },
  ];
}

async function proponer(): Promise<any> {
  guionAgendar();
  const res = await preguntar("agenda a María López el jueves a las 10");
  assert.equal(res.status, 200);
  return res.json();
}

test("preguntar deja una tarjeta guardada y NO ejecuta nada", async () => {
  const json = await proponer();
  assert.equal(estado.preparaciones, 1);
  assert.equal(estado.ejecuciones, 0);
  assert.equal(estado.alEndpoint.length, 0);
  assert.equal(json.propuestas.length, 1);
  const p = json.propuestas[0];
  assert.equal(p.estado, "pendiente");
  assert.equal(p.boton, "Sí, agendar");
  assert.match(p.tarjeta.frase, /María López/);
  assert.ok(!("datos" in p) && !("huella" in p), "a la pantalla no viajan los ids ni la huella");
  assert.equal(typeof json.ahora, "number");
  const filas = estado.base.filas.filter((f) => f.entityType === ENTIDAD_PROPUESTA);
  assert.deepEqual(filas.map((f) => f.action), [EVENTO.proponer]);
  assert.equal(filas[0].changes.conversacionId, "conv_1");
  assert.equal(filas[0].changes.pedido, "agenda a María López el jueves a las 10");
});

test("confirmar por el botón ejecuta UNA vez; el segundo toque no repite", async () => {
  const { propuestas } = await proponer();
  const id = propuestas[0].id;

  const r1 = await confirmarRuta(id);
  assert.equal(r1.status, 200);
  const j1 = await r1.json();
  assert.equal(j1.propuesta.estado, "hecha");
  assert.equal(j1.propuesta.resultado.frase, "Agendé a María López el jueves 18 a las 10:00.");
  assert.deepEqual(estado.alEndpoint, [{ metodo: "POST", ruta: "/api/appointments", cuerpo: { patientId: "pa_maria", date: "2026-09-18", startTime: "10:00" } }]);

  const r2 = await confirmarRuta(id);
  assert.equal(r2.status, 409);
  assert.equal((await r2.json()).propuesta.estado, "hecha");
  assert.equal(estado.ejecuciones, 1);
});

test("desde otra página, o sin JSON, la confirmación no entra", async () => {
  const { propuestas } = await proponer();
  const id = propuestas[0].id;
  assert.equal((await confirmarRuta(id, { host: "app.test", origin: "https://evil.example", "content-type": "application/json" })).status, 403);
  assert.equal((await confirmarRuta(id, { host: "app.test", "content-type": "application/json" })).status, 403);
  assert.equal((await confirmarRuta(id, { host: "app.test", origin: "http://app.test", "content-type": "text/plain" })).status, 415);
  assert.equal(estado.ejecuciones, 0);
});

test("sin sesión, 401; con la sesión de OTRA persona, 404 — y en ningún caso se ejecuta", async () => {
  const { propuestas } = await proponer();
  const id = propuestas[0].id;
  estado.sesion = null;
  assert.equal((await confirmarRuta(id)).status, 401);
  estado.sesion = sesion("us_otra");
  assert.equal((await confirmarRuta(id)).status, 404);
  assert.equal(estado.ejecuciones, 0);
});

test("«Consultar qué pasó» (GET) no confirma: la propuesta sigue pendiente y nada se ejecuta", async () => {
  const { propuestas } = await proponer();
  const id = propuestas[0].id;
  const filas = estado.base.filas.length;
  const r = await consultarRuta(id);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).propuesta.estado, "pendiente");
  assert.equal(estado.base.filas.length, filas);
  assert.equal(estado.ejecuciones, 0);
  estado.sesion = sesion("us_otra");
  assert.equal((await consultarRuta(id)).status, 404);
});

test("descartar por el botón la deja muerta", async () => {
  const { propuestas } = await proponer();
  const id = propuestas[0].id;
  const r = await descartarRuta(id);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).propuesta.estado, "descartada");
  assert.equal((await confirmarRuta(id)).status, 409);
  assert.equal(estado.ejecuciones, 0);
});

test("una segunda pregunta que propone otra cosa deja la primera sustituida", async () => {
  const primera = (await proponer()).propuestas[0];
  const segunda = (await proponer()).propuestas[0];
  assert.notEqual(primera.id, segunda.id);
  assert.equal((await confirmarRuta(primera.id)).status, 409);
  assert.equal((await confirmarRuta(segunda.id)).status, 200);
  assert.equal(estado.ejecuciones, 1);
});

test("al reabrir la conversación vuelven las tarjetas con su estado", async () => {
  const { propuestas } = await proponer();
  await confirmarRuta(propuestas[0].id);
  const r = await leerConversacion("conv_1");
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.deepEqual(json.propuestas.map((p: any) => p.estado), ["hecha"]);
  assert.equal(json.messages.length, 1);
});

test("sin el permiso agenda.create, Sabina lo dice y no queda tarjeta", async () => {
  estado.sesion = { ...sesion(), permissionsOverride: ["agenda.view"] };
  estado.guion = [
    { content: [{ type: "tool_use", id: "tu_1", name: "agendar_cita", input: { paciente: "María" } }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } },
    { content: [{ type: "text", text: "Uy." }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } },
  ];
  const res = await preguntar("agenda a María");
  const json = await res.json();
  assert.match(json.respuesta, /No tienes permiso para agendar citas/);
  assert.equal(json.propuestas, undefined);
  assert.equal(estado.preparaciones, 0);
  assert.equal(estado.base.filas.length, 0);
});
