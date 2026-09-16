/**
 * El bucle de Sabina, con herramientas DOBLES (no las de ws1-t1) y sin red:
 * `ejecutarSabina` recibe la llamada al modelo por parámetro.
 *
 *   npm run test:sabina-motor
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import "./engine-sin-server-only"; // PRIMERO: engine.ts arrastra "server-only"
import { ejecutarSabina, type LlamarModelo, type TurnoModelo } from "./engine";
import { SABINA_MAX_TOOL_ROUNDS, SABINA_MAX_TURNOS_HISTORIAL } from "./engine-core";
import type { SabinaCtx, SabinaTool } from "./engine-types";

/* ── Utilería ───────────────────────────────────────────────────────── */

/**
 * La sesión con EXACTAMENTE los permisos que se le den (override reemplaza).
 * Es la misma forma que arma `crearSabinaCtx` en el endpoint: el permiso lo
 * comprueba el runner de las herramientas contra este rol y este override.
 */
function ctxCon(...permisos: string[]): SabinaCtx {
  return {
    clinicId: "cl_mia",
    userId: "us_1",
    role: "DOCTOR",
    permissionsOverride: permisos,
    timezone: "America/Mexico_City",
  };
}

/** Turno del modelo que pide una herramienta. */
function pide(nombre: string, input: unknown, id = "tu_1"): TurnoModelo {
  return {
    bloques: [{ type: "tool_use", id, name: nombre, input }],
    stopReason: "tool_use",
    tokensEntrada: 100,
    tokensSalida: 20,
    error: null,
  };
}

/** Turno del modelo que contesta con texto. */
function contesta(texto: string): TurnoModelo {
  return {
    bloques: [{ type: "text", text: texto }],
    stopReason: "end_turn",
    tokensEntrada: 150,
    tokensSalida: 40,
    error: null,
  };
}

/** Encadena turnos predefinidos y apunta con qué modelo se pidió cada uno. */
function guion(turnos: TurnoModelo[]) {
  const modelos: string[] = [];
  const enviados: unknown[][] = [];
  const apagadas: boolean[] = [];
  let i = 0;
  const llamar: LlamarModelo = async (args) => {
    modelos.push(args.modelo);
    enviados.push(args.tools as unknown[]);
    apagadas.push(Boolean(args.sinHerramientas));
    return turnos[Math.min(i++, turnos.length - 1)];
  };
  return { llamar, modelos, enviados, apagadas, llamadas: () => i };
}

/* ── Las herramientas dobles ────────────────────────────────────────── */

function dobleAgenda(registro: { llamadas: unknown[] }): SabinaTool<any, unknown> {
  return {
    nombre: "citas_del_dia",
    descripcion: "Citas de una fecha, con estado y doctor.",
    parametros: z.object({ fecha: z.string().min(10) }),
    permiso: "agenda.view",
    ejecutar: async (c, p) => {
      registro.llamadas.push({ ctx: c, params: p });
      return [{ hora: "09:00" }];
    },
    resumir: () => "8 citas hoy",
    vacio: () => false,
  };
}

function dobleFacturacion(registro: { llamadas: unknown[] }): SabinaTool<any, unknown> {
  return {
    nombre: "ingresos_por_periodo",
    descripcion: "Ingresos agrupados por día/semana/mes.",
    parametros: z.object({}),
    permiso: "billing.view",
    ejecutar: async (c, p) => {
      registro.llamadas.push({ ctx: c, params: p });
      return { total: 90000 };
    },
    resumir: () => "90 mil este mes",
    vacio: () => false,
  };
}

/* ── Que ejecute la correcta ────────────────────────────────────────── */

test("ejecuta la herramienta que pidió el modelo y contesta con lo que trajo", async () => {
  const reg = { llamadas: [] as unknown[] };
  const g = guion([pide("citas_del_dia", { fecha: "2026-09-10" }), contesta("Tienes 8 citas hoy.")]);

  const salida = await ejecutarSabina({
    ctx: ctxCon("agenda.view"),
    pregunta: "¿cuántas citas tengo hoy?",
    tools: [dobleAgenda(reg)],
    llamar: g.llamar,
  });

  assert.equal(salida.respuesta, "Tienes 8 citas hoy.");
  assert.deepEqual(salida.herramientasUsadas, ["citas_del_dia"]);
  assert.equal(reg.llamadas.length, 1);
  assert.equal(salida.fallo, false);
});

test("el clinicId que ve la herramienta sale de la sesión, no del modelo", async () => {
  const reg = { llamadas: [] as unknown[] };
  // El modelo intenta colar OTRA clínica dentro del argumento.
  const g = guion([
    pide("citas_del_dia", { fecha: "2026-09-10", clinicId: "cl_de_otro" }),
    contesta("Listo."),
  ]);

  await ejecutarSabina({
    ctx: ctxCon("agenda.view"),
    pregunta: "¿cuántas citas tengo hoy?",
    tools: [dobleAgenda(reg)],
    llamar: g.llamar,
  });

  const llamada = reg.llamadas[0] as { ctx: { clinicId: string }; params: Record<string, unknown> };
  assert.equal(llamada.ctx.clinicId, "cl_mia");
  assert.equal(llamada.params.clinicId, undefined);
  assert.deepEqual(llamada.params, { fecha: "2026-09-10" });
});

/* ── Que valide antes de ejecutar ───────────────────────────────────── */

test("con parámetros basura la herramienta NO se ejecuta", async () => {
  const reg = { llamadas: [] as unknown[] };
  const g = guion([pide("citas_del_dia", { fecha: 42 }), contesta("No pude consultarlo.")]);

  const salida = await ejecutarSabina({
    ctx: ctxCon("agenda.view"),
    pregunta: "¿cuántas citas tengo hoy?",
    tools: [dobleAgenda(reg)],
    llamar: g.llamar,
  });

  assert.equal(reg.llamadas.length, 0, "la herramienta no debió ejecutarse");
  assert.deepEqual(salida.herramientasUsadas, []);
});

test("una herramienta inventada no ejecuta nada y el bucle sigue vivo", async () => {
  const reg = { llamadas: [] as unknown[] };
  const g = guion([
    pide("borrar_pacientes", { todo: true }),
    contesta("Eso no lo puedo consultar."),
  ]);

  const salida = await ejecutarSabina({
    ctx: ctxCon("agenda.view", "patients.delete"),
    pregunta: "borra los pacientes",
    tools: [dobleAgenda(reg)],
    llamar: g.llamar,
  });

  assert.equal(reg.llamadas.length, 0);
  assert.equal(salida.respuesta, "Eso no lo puedo consultar.");
});

/* ── El permiso ─────────────────────────────────────────────────────── */

test("sin permiso la herramienta NO se ejecuta y la respuesta lo dice", async () => {
  const reg = { llamadas: [] as unknown[] };
  // El modelo omite el aviso a propósito: la red de seguridad debe añadirlo.
  const g = guion([
    pide("ingresos_por_periodo", {}),
    contesta("Este mes tuviste 120 citas."),
  ]);

  const salida = await ejecutarSabina({
    ctx: ctxCon("agenda.view"), // NO tiene billing.view
    pregunta: "¿cómo va el mes?",
    tools: [dobleFacturacion(reg)],
    llamar: g.llamar,
  });

  assert.equal(reg.llamadas.length, 0, "una consulta sin permiso no puede tocar la base");
  assert.deepEqual(salida.sinPermiso, ["billing.view"]);
  assert.match(salida.respuesta, /no tienes acceso a facturación/i);
  // Y lo que el contrato prohíbe: que suene a que no hubo ingresos.
  assert.doesNotMatch(salida.respuesta, /no tengo datos de facturación/i);
});

test("con permiso, la misma herramienta sí se ejecuta", async () => {
  const reg = { llamadas: [] as unknown[] };
  const g = guion([pide("ingresos_por_periodo", {}), contesta("Llevas $90,000 este mes.")]);

  const salida = await ejecutarSabina({
    ctx: ctxCon("billing.view"),
    pregunta: "¿cuánto llevo este mes?",
    tools: [dobleFacturacion(reg)],
    llamar: g.llamar,
  });

  assert.equal(reg.llamadas.length, 1);
  assert.deepEqual(salida.sinPermiso, []);
  assert.equal(salida.respuesta, "Llevas $90,000 este mes.");
});

/* ── El tope de rondas ──────────────────────────────────────────────── */

test("un modelo que solo pide herramientas no da vueltas para siempre", async () => {
  const reg = { llamadas: [] as unknown[] };
  // SIEMPRE pide otra herramienta: sin tope, esto no termina nunca.
  const g = guion([pide("citas_del_dia", { fecha: "2026-09-10" })]);

  const salida = await ejecutarSabina({
    ctx: ctxCon("agenda.view"),
    pregunta: "¿cuántas citas tengo hoy?",
    tools: [dobleAgenda(reg)],
    llamar: g.llamar,
  });

  // Tope ABSOLUTO, escrito a mano y no derivado de la constante: si alguien
  // sube SABINA_MAX_TOOL_ROUNDS, esta prueba tiene que enterarse. Con 4 rondas
  // son 5 llamadas por pasada y 2 pasadas como mucho → 10.
  assert.ok(g.llamadas() <= 10, `llamadas=${g.llamadas()}`);
  assert.ok(salida.rondas <= 10, `rondas=${salida.rondas}`);
});

test("en la última ronda se le apagan las herramientas al modelo, pero el catálogo sigue viajando", async () => {
  const reg = { llamadas: [] as unknown[] };
  const g = guion([pide("citas_del_dia", { fecha: "2026-09-10" })]);

  await ejecutarSabina({
    ctx: ctxCon("agenda.view"),
    pregunta: "¿cuántas citas tengo hoy?",
    tools: [dobleAgenda(reg)],
    llamar: g.llamar,
  });

  // La ronda número SABINA_MAX_TOOL_ROUNDS (índice 4) tiene que cerrar con
  // palabras. Antes eso se conseguía mandando la lista de herramientas vacía;
  // ahora el catálogo viaja igual —si no, se rompe el prefijo cacheado justo en
  // la llamada con más historial encima— y lo que las apaga es
  // `tool_choice: none` (ver engine-cache.ts).
  assert.equal(g.apagadas[SABINA_MAX_TOOL_ROUNDS], true, "la última ronda tiene que pedir las herramientas apagadas");
  assert.deepEqual(
    g.enviados[SABINA_MAX_TOOL_ROUNDS],
    g.enviados[0],
    "la última ronda cambió el catálogo: perdería el caché del prefijo",
  );
  assert.ok((g.enviados[0] ?? []).length > 0);
  // Y las rondas anteriores NO van apagadas: el modelo tiene que poder consultar.
  assert.deepEqual(g.apagadas.slice(0, SABINA_MAX_TOOL_ROUNDS), [false, false, false, false]);
});

/* ── La segunda pasada ──────────────────────────────────────────────── */

test("si la pasada barata no cierra, se sube al caro UNA vez", async () => {
  const reg = { llamadas: [] as unknown[] };
  const turnos = [
    ...Array.from({ length: SABINA_MAX_TOOL_ROUNDS }, () => pide("citas_del_dia", { fecha: "2026-09-10" })),
    contesta(""), // la barata se queda sin texto
    contesta("Con lo que vi: tienes 8 citas hoy."),
  ];
  const g = guion(turnos);

  const salida = await ejecutarSabina({
    ctx: ctxCon("agenda.view"),
    pregunta: "¿cuántas citas tengo hoy?",
    tools: [dobleAgenda(reg)],
    llamar: g.llamar,
  });

  assert.equal(salida.escalado, true);
  assert.equal(g.modelos[0], "claude-haiku-4-5");
  assert.equal(salida.modelo, "claude-sonnet-4-6");
  assert.ok(g.modelos.includes("claude-sonnet-4-6"));
});

test("si la barata contesta, NO se gasta el modelo caro", async () => {
  const reg = { llamadas: [] as unknown[] };
  const g = guion([pide("citas_del_dia", { fecha: "2026-09-10" }), contesta("Tienes 8 citas hoy.")]);

  const salida = await ejecutarSabina({
    ctx: ctxCon("agenda.view"),
    pregunta: "¿cuántas citas tengo hoy?",
    tools: [dobleAgenda(reg)],
    llamar: g.llamar,
  });

  assert.equal(salida.escalado, false);
  assert.equal(salida.modelo, "claude-haiku-4-5");
  assert.ok(!g.modelos.includes("claude-sonnet-4-6"));
});

/* ── Cuando el modelo falla ─────────────────────────────────────────── */

test("si el modelo no responde, sale marcado como fallo (→ 503, no 500)", async () => {
  const g = guion([
    { bloques: [], stopReason: null, tokensEntrada: 0, tokensSalida: 0, error: "claude_529: overloaded" },
  ]);

  const salida = await ejecutarSabina({
    ctx: ctxCon("agenda.view"),
    pregunta: "¿cuántas citas tengo hoy?",
    tools: [dobleAgenda({ llamadas: [] })],
    llamar: g.llamar,
  });

  assert.equal(salida.fallo, true);
  assert.equal(salida.respuesta, "");
});

test("una herramienta que revienta no tumba el turno", async () => {
  const rota: SabinaTool<any, unknown> = {
    nombre: "ingresos_por_periodo",
    descripcion: "x",
    parametros: z.object({}),
    permiso: "billing.view",
    ejecutar: async () => {
      throw new Error("pooler saturado");
    },
    resumir: () => "",
    vacio: () => false,
  };
  const g = guion([pide("ingresos_por_periodo", {}), contesta("No pude consultar los ingresos.")]);

  const salida = await ejecutarSabina({
    ctx: ctxCon("billing.view"),
    pregunta: "¿cuánto llevo?",
    tools: [rota],
    llamar: g.llamar,
  });

  assert.equal(salida.fallo, false);
  assert.match(salida.respuesta, /No pude consultar/);
});

/* ── El dinero ──────────────────────────────────────────────────────── */

test("los tokens se suman de TODAS las rondas, no solo de la última", async () => {
  const reg = { llamadas: [] as unknown[] };
  const g = guion([pide("citas_del_dia", { fecha: "2026-09-10" }), contesta("Tienes 8 citas hoy.")]);

  const salida = await ejecutarSabina({
    ctx: ctxCon("agenda.view"),
    pregunta: "¿cuántas citas tengo hoy?",
    tools: [dobleAgenda(reg)],
    llamar: g.llamar,
  });

  // Ronda 1 (100/20) + ronda 2 (150/40).
  assert.equal(salida.tokens.entrada, 250);
  assert.equal(salida.tokens.salida, 60);
  assert.equal(salida.rondas, 2);
});

test("el presupuesto de tiempo corta el turno", async () => {
  const reg = { llamadas: [] as unknown[] };
  let t = 0;
  const g = guion([pide("citas_del_dia", { fecha: "2026-09-10" })]);
  const llamar: LlamarModelo = async (args) => {
    t += 9_000; // cada llamada se come 9 s
    return g.llamar(args);
  };

  const salida = await ejecutarSabina({
    ctx: ctxCon("agenda.view"),
    pregunta: "¿cuántas citas tengo hoy?",
    tools: [dobleAgenda(reg)],
    llamar,
    ahora: () => t,
    presupuestoMs: 20_000,
  });

  // Con 20 s de presupuesto y 9 s por llamada no caben más de 3 rondas.
  assert.ok(salida.rondas <= 3, `rondas=${salida.rondas}`);
});

/* ── El historial que se reenvía ────────────────────────────────────── */

test("un hilo largo no se reenvía entero: solo los últimos turnos, empezando por el doctor", async () => {
  // 500 turnos es lo que devuelve getConversation como mucho. Reenviarlos en
  // cada ronda lo paga el monedero de la clínica, hasta 10 veces por pregunta.
  const historial = Array.from({ length: 500 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `turno ${i}`,
  }));
  const g = guion([contesta("Listo.")]);
  let enviados: any[] = [];
  const llamar: LlamarModelo = async (args) => {
    enviados = args.messages as any[];
    return g.llamar(args);
  };

  await ejecutarSabina({
    ctx: ctxCon("agenda.view"),
    pregunta: "¿y hoy?",
    historial,
    tools: [dobleAgenda({ llamadas: [] })],
    llamar,
  });

  assert.ok(enviados.length <= SABINA_MAX_TURNOS_HISTORIAL + 1, `mensajes=${enviados.length}`);
  assert.equal(enviados[0].role, "user", "la API exige que el primer mensaje sea del usuario");
  assert.equal(enviados[enviados.length - 2].content, "turno 499", "se perdió el turno más reciente");
  assert.equal(enviados[enviados.length - 1].content, "¿y hoy?");
});
