/**
 * Reglas puras del motor de Sabina.
 *
 *   npm run test:sabina-core
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  FRASE_SIN_TARJETA,
  SABINA_MAX_TOOL_ROUNDS,
  clasificarDificultad,
  construirRastro,
  construirSystemPrompt,
  debeEscalar,
  fraseSinPermiso,
  garantizarAvisoSinPermiso,
  garantizarSinTarjetaFantasma,
  hoyParaPrompt,
  mandaAConfirmarTarjeta,
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
  ejecutar: async () => [],
  resumir: () => "",
  vacio: () => false,
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

test("una fecha con regex llega con su pattern, también detrás de un refine", () => {
  const esquema = zodAJsonSchema(
    z.object({
      fecha: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine((s) => s !== "0000-00-00")
        .optional(),
    }),
  );
  const fecha = (esquema.properties as Record<string, any>).fecha;
  assert.equal(fecha.type, "string");
  assert.equal(fecha.pattern, "^\\d{4}-\\d{2}-\\d{2}$");
});

/* ── El «hoy» del prompt ────────────────────────────────────────────── */

test("el «hoy» es el de la clínica aunque el servidor (UTC) ya vaya en mañana", () => {
  // 02:00 UTC del 12 = 20:00 del 11 en Ciudad de México.
  const instante = new Date("2026-09-12T02:00:00Z");
  assert.match(hoyParaPrompt(instante, "America/Mexico_City"), /11 de septiembre de 2026 \(2026-09-11\)$/);
  assert.match(hoyParaPrompt(instante, "UTC"), /\(2026-09-12\)$/);
});

test("una zona ilegible no tumba el turno: cae a la de México", () => {
  const instante = new Date("2026-09-12T02:00:00Z");
  assert.match(hoyParaPrompt(instante, "Marte/Olympus"), /\(2026-09-11\)$/);
  assert.match(hoyParaPrompt(instante, ""), /\(2026-09-11\)$/);
});

test("el tope de rondas es el mismo que el del bot de barbería", () => {
  assert.equal(SABINA_MAX_TOOL_ROUNDS, 4);
});

/* ── La tarjeta que no existe (el fallo en vivo del 14-sep-2026) ────── */

test("detecta cuando la respuesta manda a confirmar en una tarjeta o botón", () => {
  for (const texto of [
    "Para agendarla, confírmala con el botón «Sí, agendar» de la tarjeta.",
    "Te dejé la cita del domingo lista: confírmala en la tarjeta.",
    "No hay problema, confírmala en la tarjeta.",
    "Dale a «Sí, dar de alta» y queda.",
    "Toca el botón de la tarjeta para agendarla.",
  ]) {
    assert.equal(mandaAConfirmarTarjeta(texto, false), true, texto);
  }
  // Con una acción en el turno cabe menos duda: también sin la orden explícita sobre la tarjeta.
  for (const texto of [
    "Listo, revisa la tarjeta de abajo.",
    "Te preparé la cita; confirma la propuesta.",
    "Ya está lista para que la confirmes.",
  ]) {
    assert.equal(mandaAConfirmarTarjeta(texto, true), true, texto);
    assert.equal(mandaAConfirmarTarjeta(texto, false), false, `sin acción no se da por mentira: ${texto}`);
  }
});

test("no confunde la tarjeta del cobro, una cita confirmada ni la frase honesta", () => {
  for (const texto of [
    "Este mes cobraste $12,000 con tarjeta y $8,000 en efectivo.",
    "Tienes 3 citas confirmadas; 2 se pagaron con tarjeta de crédito.",
    "Los ingresos de tarjeta están abajo, detallados por semana.",
    "Revisa la tarjeta de ingresos del inicio: ahí está el total.",
    "¿Me confirmas el motivo de la cita?",
    "Todavía no preparé ninguna propuesta, así que no hay ninguna tarjeta que confirmar.",
    "¿Te agendo a Juan el martes a las 10? Dime «sí, agéndala» y la preparo.",
    "",
  ]) {
    assert.equal(mandaAConfirmarTarjeta(texto, true), false, texto);
  }
  // Sin acción en el turno, explicar un botón del panel no es una tarjeta de Sabina.
  assert.equal(mandaAConfirmarTarjeta("Para confirmar una cita, ábrela en la agenda y toca el botón Confirmar.", false), false);
});

test("la red sustituye la respuesta solo si no hay tarjeta de verdad, y dice el porqué de la acción", () => {
  const mentira = "Confírmala en la tarjeta.";
  const base = { huboPropuesta: false, tarjetaPendiente: false, huboAccion: true, ultimaAccion: null };

  assert.equal(garantizarSinTarjetaFantasma(mentira, { ...base, huboPropuesta: true }), mentira, "hay tarjeta en este turno");
  assert.equal(garantizarSinTarjetaFantasma(mentira, { ...base, tarjetaPendiente: true }), mentira, "hay una tarjeta esperando en pantalla");
  assert.equal(garantizarSinTarjetaFantasma("Tienes 3 citas.", base), "Tienes 3 citas.");

  assert.match(garantizarSinTarjetaFantasma(mentira, base), new RegExp(FRASE_SIN_TARJETA.slice(0, 30)));
  assert.equal(
    garantizarSinTarjetaFantasma(mentira, { ...base, ultimaAccion: { estado: "falta_aclarar", pregunta: "¿Cuál es el motivo de la cita?" } }),
    "¿Cuál es el motivo de la cita?",
  );
  const cerrado = garantizarSinTarjetaFantasma(mentira, {
    ...base,
    ultimaAccion: { estado: "no_se_puede", frase: "La clínica está cerrada el domingo 20 de septiembre." },
  });
  assert.match(cerrado, /^La clínica está cerrada el domingo 20 de septiembre\. Por eso no preparé ninguna propuesta/);
  assert.equal(mandaAConfirmarTarjeta(cerrado, true), false, "la frase honesta no vuelve a disparar la red");
  assert.match(garantizarSinTarjetaFantasma(mentira, { ...base, ultimaAccion: { estado: "error" } }), /falló la consulta/);
});

test("el prompt dice si hay tarjeta en pantalla; un «sí» ya no se manda a una tarjeta a ciegas", () => {
  const sin = construirSystemPrompt({ dificultad: "directa", hoy: "hoy", acciones: ["agendar citas"] });
  assert.match(sin, /NO hay ninguna tarjeta en pantalla/);
  assert.match(sin, /llama a la herramienta de acción/);
  assert.doesNotMatch(sin, /diles que usen el botón/);
  assert.match(sin, /"sí" escrito en el chat NO confirma nada/);

  const con = construirSystemPrompt({ dificultad: "directa", hoy: "hoy", acciones: ["agendar citas"], tarjetaPendiente: "Agendar a Ana el jueves" });
  assert.match(con, /UNA propuesta sin confirmar: «Agendar a Ana el jueves»/);
  assert.match(con, /diles que usen el botón de su tarjeta/);
  assert.doesNotMatch(con, /NO hay ninguna tarjeta en pantalla/);
});

/* ── Cómo escribe: listas cuando toca, y no más caro ───────────────────── */

test("el prompt pide lista para «quiénes/cuáles» y frase para «cuántos», en las dos dificultades", () => {
  for (const dificultad of ["directa", "abierta"] as const) {
    const prompt = construirSystemPrompt({ dificultad, hoy: "hoy" });
    assert.match(prompt, /Si piden quiénes o cuáles y son varios, uno por línea con "- "/, dificultad);
    assert.match(prompt, /cópialas tal cual/, dificultad);
    assert.match(prompt, /Si piden cuántos o cuánto, o es uno solo, una frase/, dificultad);
    assert.match(prompt, /Sin tablas: se lee en el teléfono/, dificultad);
  }
  // «Dos o tres líneas» a secas era lo que apretaba ocho deudores en una línea con comas.
  const directa = construirSystemPrompt({ dificultad: "directa", hoy: "hoy" });
  assert.match(directa, /Dos o tres líneas, más la lista si la hay/);
  assert.doesNotMatch(directa, /Dos o tres líneas\. /);
});

test("la sección «CÓMO ESCRIBES» no engorda: se paga en cada llamada al modelo", () => {
  // Medido el 14-sep-2026: 410 caracteres (directa) y 428 (abierta), +197 y +173
  // sobre la versión anterior. Si alguien la alarga, que sea a propósito.
  for (const [dificultad, tope] of [["directa", 420], ["abierta", 440]] as const) {
    const prompt = construirSystemPrompt({ dificultad, hoy: "hoy" });
    const seccion = prompt.slice(prompt.indexOf("CÓMO ESCRIBES"));
    assert.ok(seccion.length <= tope, `${dificultad}: ${seccion.length} caracteres`);
  }
});
