/**
 * Reglas puras del motor de Sabina.
 *
 *   npm run test:sabina-core
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  SABINA_MAX_TOOL_ROUNDS,
  clasificarDificultad,
  construirRastro,
  construirSystemPrompt,
  debeEscalar,
  fraseSinPermiso,
  garantizarAvisoSinPermiso,
  modeloPara,
  resultadoParaModelo,
  sanearArgumentos,
  validarLlamada,
  zodAJsonSchema,
} from "./engine-core";
import type { SabinaTool } from "./engine-types";

/* ── Qué modelo ─────────────────────────────────────────────────────── */

test("una pregunta de mostrador va con el modelo barato", () => {
  for (const pregunta of [
    "¿cuántas citas tengo hoy?",
    "¿quién me debe?",
    "dame los pacientes nuevos de septiembre",
    "busca al paciente Ramírez",
    "¿cuánto facturé este mes?",
  ]) {
    assert.equal(clasificarDificultad(pregunta), "directa", pregunta);
  }
  assert.equal(modeloPara("directa"), "claude-haiku-4-5");
});

test("una pregunta que pide razonar sube al modelo caro", () => {
  for (const pregunta of [
    "¿cómo expando mi clínica?",
    "¿por qué bajaron mis ingresos?",
    "¿qué me conviene hacer con los martes?",
    "analiza la ocupación del último trimestre",
    "¿debería contratar otro doctor?",
  ]) {
    assert.equal(clasificarDificultad(pregunta), "abierta", pregunta);
  }
  assert.notEqual(modeloPara("abierta"), modeloPara("directa"));
});

test("los acentos no cambian la clasificación", () => {
  assert.equal(clasificarDificultad("¿por qué bajaron?"), "abierta");
  assert.equal(clasificarDificultad("¿POR QUE BAJARON?"), "abierta");
  assert.equal(clasificarDificultad("porque bajaron mis ingresos"), "abierta");
});

test("ante la duda gana el barato: lo que no dispara señal es directa", () => {
  // Sin señal, sin dos interrogaciones y sin ser larga → barata.
  assert.equal(clasificarDificultad("dime las ausencias de la semana"), "directa");
  assert.equal(clasificarDificultad(""), "directa");
  assert.equal(clasificarDificultad("   "), "directa");
});

test("dos preguntas en un mensaje ya no son un dato", () => {
  assert.equal(clasificarDificultad("¿cuántas citas hay hoy? ¿y mañana?"), "abierta");
});

test("una pregunta muy larga se trata como abierta", () => {
  const larga = Array.from({ length: 30 }, (_, i) => `palabra${i}`).join(" ");
  assert.equal(clasificarDificultad(larga), "abierta");
});

/* ── La segunda pasada ──────────────────────────────────────────────── */

test("solo se escala si la pasada barata NO contestó", () => {
  const base = { dificultad: "directa" as const, yaEscalado: false, rondasAgotadas: true, huboHerramientas: true };
  // No contestó → se escala.
  assert.equal(debeEscalar({ ...base, respuesta: null }), true);
  // Contestó → NO se escala aunque se agotaran rondas: el ahorro ya está hecho.
  assert.equal(debeEscalar({ ...base, respuesta: "Tienes 8 citas hoy." }), false);
  // Ya se escaló una vez → nunca dos.
  assert.equal(debeEscalar({ ...base, respuesta: null, yaEscalado: true }), false);
  // Ya iba con el caro → no hay a dónde subir.
  assert.equal(debeEscalar({ ...base, dificultad: "abierta", respuesta: null }), false);
});

/* ── Nada se ejecuta a ciegas ───────────────────────────────────────── */

const herramientaDoble: SabinaTool<any, unknown> = {
  nombre: "citas_del_dia",
  descripcion: "Citas de una fecha.",
  parametros: z.object({ fecha: z.string().min(10) }),
  permiso: "agenda.view",
  ejecutar: async () => ({ ok: true, datos: [], resumen: "" }),
};

test("el clinicId nunca viaja dentro de un argumento del modelo", () => {
  const { limpio, retirados } = sanearArgumentos({
    fecha: "2026-09-10",
    clinicId: "otra-clinica",
    clinic_id: "otra-mas",
    userId: "otro-usuario",
  });
  assert.deepEqual(limpio, { fecha: "2026-09-10" });
  assert.equal(retirados.length, 3);
  assert.ok(!("clinicId" in limpio));
});

test("una herramienta inventada por el modelo no se ejecuta", () => {
  const v = validarLlamada([herramientaDoble], "consultar_expediente_completo", {});
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.motivo, "desconocida");
});

test("unos parámetros basura no llegan a la base", () => {
  const v = validarLlamada([herramientaDoble], "citas_del_dia", { fecha: 42 });
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.motivo, "parametros");
});

test("una llamada buena pasa, y pasa SIN el clinicId que coló el modelo", () => {
  const v = validarLlamada([herramientaDoble], "citas_del_dia", {
    fecha: "2026-09-10",
    clinicId: "otra-clinica",
  });
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.deepEqual(v.params, { fecha: "2026-09-10" });
    assert.deepEqual(v.retirados, ["clinicId"]);
  }
});

/* ── La regla 3: sin permiso SE DICE ────────────────────────────────── */

test("la frase de sin_permiso dice que falta ACCESO, no que falten datos", () => {
  const frase = fraseSinPermiso("billing.view");
  assert.match(frase, /no tienes acceso/i);
  assert.match(frase, /facturación/i);
  // Lo que el contrato prohíbe: sonar a que la clínica no facturó nada.
  assert.doesNotMatch(frase, /no tengo datos/i);
});

test("si el modelo se come el aviso, el motor lo añade igual", () => {
  const respuesta = garantizarAvisoSinPermiso(
    "Este mes tuviste 120 citas.",
    ["billing.view"],
  );
  assert.match(respuesta, /no tienes acceso a facturación/i);
  assert.match(respuesta, /120 citas/);
});

test("si el modelo YA avisó, no se repite el aviso", () => {
  const yaAvisada = "No tienes acceso a facturación, eso no te lo puedo contestar. Tuviste 120 citas.";
  const respuesta = garantizarAvisoSinPermiso(yaAvisada, ["billing.view"]);
  assert.equal(respuesta, yaAvisada);
});

test("sin permisos faltantes la respuesta no se toca", () => {
  assert.equal(garantizarAvisoSinPermiso("Tienes 8 citas hoy.", []), "Tienes 8 citas hoy.");
});

test("el resultado sin_permiso llega al modelo con la orden de decirlo", () => {
  const texto = resultadoParaModelo({ ok: false, motivo: "sin_permiso", permiso: "billing.view" });
  const json = JSON.parse(texto);
  assert.equal(json.motivo, "sin_permiso");
  assert.match(json.instruccion, /NO omitas/i);
  assert.match(json.instruccion, /no tienes acceso a facturación/i);
});

test("sin_datos le prohíbe al modelo rellenar el hueco", () => {
  const json = JSON.parse(resultadoParaModelo({ ok: false, motivo: "sin_datos" }));
  assert.match(json.instruccion, /NO estimes/i);
  assert.match(json.instruccion, /inventes|NO promedies/i);
});

/* ── El prompt del sistema ──────────────────────────────────────────── */

test("el prompt del sistema lleva las cuatro reglas que pidió Rafael", () => {
  const prompt = construirSystemPrompt({ dificultad: "abierta", hoy: "10 de septiembre de 2026" });
  assert.match(prompt, /no tienes acceso a facturación/i);   // regla 3
  assert.match(prompt, /No tienes ningún dato de la clínica en la cabeza/i); // regla 5
  assert.match(prompt, /Nunca inventes/i);                    // regla 5
  assert.match(prompt, /Lo medido/i);                         // regla 6
  assert.match(prompt, /como sugerencia/i);                   // regla 6
  assert.match(prompt, /Solo lees/i);                         // regla 4
  assert.match(prompt, /10 de septiembre de 2026/);
});

/* ── El rastro no filtra ────────────────────────────────────────────── */

test("el rastro registra quién preguntó, NUNCA qué preguntó", () => {
  const rastro = construirRastro({
    clinicId: "cl_1",
    userId: "us_1",
    conversacionId: "cv_1",
    modelo: "claude-haiku-4-5",
    dificultad: "directa",
    escalado: false,
    herramientas: ["citas_del_dia"],
    rondas: 2,
    tokensEntrada: 1200,
    tokensSalida: 300,
    ms: 1800,
    sinPermiso: [],
    // Basura que un refactor podría colar; la lista blanca la tiene que tirar.
    pregunta: "¿tiene VIH el paciente Juan Pérez?",
    respuesta: "Juan Pérez, expediente 40, diagnóstico...",
  } as any);

  const serializado = JSON.stringify(rastro);
  assert.doesNotMatch(serializado, /Juan Pérez/);
  assert.doesNotMatch(serializado, /VIH/);
  assert.equal((rastro as any).pregunta, undefined);
  assert.equal((rastro as any).respuesta, undefined);
  assert.equal(rastro.tokensEntrada, 1200);
  assert.deepEqual(rastro.herramientas, ["citas_del_dia"]);
});

/* ── zod → json schema ──────────────────────────────────────────────── */

test("el esquema que ve el modelo respeta obligatorios y opcionales", () => {
  const esquema = zodAJsonSchema(
    z.object({
      desde: z.string().describe("Fecha ISO"),
      dias: z.number().int().min(1).optional(),
      agrupar: z.enum(["dia", "semana", "mes"]).default("mes"),
    }),
  );
  assert.equal(esquema.type, "object");
  const props = esquema.properties as Record<string, any>;
  assert.equal(props.desde.type, "string");
  assert.equal(props.desde.description, "Fecha ISO");
  assert.equal(props.dias.type, "integer");
  assert.deepEqual(props.agrupar.enum, ["dia", "semana", "mes"]);
  // Solo `desde` es obligatorio: los otros dos son optional/default.
  assert.deepEqual(esquema.required, ["desde"]);
});

test("el tope de rondas es el mismo que el del bot de barbería", () => {
  assert.equal(SABINA_MAX_TOOL_ROUNDS, 4);
});
