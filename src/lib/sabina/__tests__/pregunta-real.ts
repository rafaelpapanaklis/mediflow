/**
 * CUATRO PREGUNTAS A SABINA CONTRA LA API REAL DE ANTHROPIC — lo corre Rafael, a mano.
 *
 *   read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY
 *   SABINA_LLAMADA_REAL=1 npm run sabina:pregunta-real
 *
 * ⚠️ GASTA DINERO (poco: cuatro preguntas directas con Haiku, del orden de
 * centavos de dólar). Sin `SABINA_LLAMADA_REAL=1` y sin clave, las cuatro pruebas
 * se SALTAN y no sale ni una petición.
 *
 * Qué es real y qué no:
 *  · REAL: el motor (`ejecutarSabina`), `llamarAnthropic` —el mismo `fetch` que
 *    usará producción—, el modelo, el catálogo de diez herramientas, los
 *    permisos y los where-builders.
 *  · NO real: la base. Las herramientas leen del doble con dos clínicas de
 *    `tools/__tests__/siembra.ts`. No hace falta `.env`, no se toca Supabase y
 *    no se cobra a ningún monedero (el endpoint no interviene).
 *
 * Qué mirar en la salida: que conteste con el número que trae la herramienta
 * (sale impreso al lado), que diga «no tienes acceso a facturación» a la
 * recepcionista, que «¿quién me debe?» salga en lista (una línea por paciente) y
 * «¿cuántas citas?» en una frase, y los tokens reales por modelo. Las comprobaciones son
 * blandas —el texto de un modelo no se compara al carácter—: lo que no cuadra
 * sale como ⚠️ y la prueba falla solo si no hubo respuesta o no consultó nada.
 */
import "../engine-sin-server-only";
import "../tools/__tests__/preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { adminNorte, base, recepcionNorte } from "../tools/__tests__/siembra";
import { ejecutarSabina } from "../engine";
import { SABINA_TOOLS } from "../engine-catalog";
import { ejecutarHerramienta } from "../tools";
import { parseSabinaMarkdown } from "@/components/sabina/sabina-core";

const AUTORIZADO = process.env.SABINA_LLAMADA_REAL === "1" && !!process.env.ANTHROPIC_API_KEY;
const saltar = AUTORIZADO ? false : "sin SABINA_LLAMADA_REAL=1 y ANTHROPIC_API_KEY no se llama a la API (gasta dinero)";

function imprimir(titulo: string, salida: Awaited<ReturnType<typeof ejecutarSabina>>, esperado?: string) {
  console.log(`\n━━ ${titulo}`);
  if (esperado) console.log(`   la herramienta, directa: ${esperado}`);
  console.log(`   Sabina: ${salida.respuesta.replace(/\n/g, "\n           ")}`);
  console.log(`   herramientas: ${salida.herramientasUsadas.join(", ") || "(ninguna)"}`);
  console.log(`   modelo: ${salida.modelo}${salida.escalado ? " (escaló)" : ""} · rondas: ${salida.rondas}`);
  for (const c of salida.consumo) console.log(`   tokens ${c.modelo}: entrada ${c.entrada} · salida ${c.salida}`);
  console.log(`   la pantalla lo pinta como: ${parseSabinaMarkdown(salida.respuesta).map((b) => b.kind).join(" + ")}`);
}

/** Líneas de lista («- …» o «1. …») de una respuesta. */
function lineasDeLista(respuesta: string): number {
  return respuesta.split("\n").filter((l) => /^\s*(?:[-•*]|\d{1,3}[.)])\s+/.test(l)).length;
}

/**
 * Lo del 14-sep-2026: «enlista los pacientes que deben» llegó en una tira con comas.
 * Blando, como el resto: avisa, no tumba — el texto de un modelo no se compara al carácter.
 */
function revisarLista(respuesta: string, deudores: number) {
  const n = lineasDeLista(respuesta);
  if (deudores > 1 && n < deudores) console.log(`   ⚠️ ${deudores} deudores y solo ${n} líneas de lista: ¿otra vez separados por comas?`);
  const montos = respuesta.match(/\$\s?[\d,]+(?:\.\d+)?/g) ?? [];
  const formas = new Set(montos.map((m) => (m.includes(".") ? "con centavos" : "sin centavos")));
  if (formas.size > 1) console.log(`   ⚠️ cantidades con formas distintas: ${montos.join(" · ")}`);
}

test("«¿Cuántas citas tengo hoy?» — administradora", { skip: saltar }, async () => {
  const db = base();
  const ctx = adminNorte(db);
  const directo = await ejecutarHerramienta("citas_del_dia", ctx, {});
  const salida = await ejecutarSabina({ ctx, pregunta: "¿Cuántas citas tengo hoy?", tools: SABINA_TOOLS });
  imprimir("citas de hoy", salida, directo.ok ? (directo as { resumen: string }).resumen : JSON.stringify(directo));

  assert.equal(salida.fallo, false, "el modelo no contestó");
  assert.ok(salida.herramientasUsadas.includes("citas_del_dia"), "contestó sin consultar la agenda");
  if (directo.ok) {
    const numero = (directo as { resumen: string }).resumen.match(/\d+/)?.[0];
    if (numero && !salida.respuesta.includes(numero)) console.log(`   ⚠️ la respuesta no menciona ${numero}`);
  }
  // Y al revés: «¿cuántas?» se contesta con el número, no con la agenda entera.
  if (lineasDeLista(salida.respuesta) > 0) console.log("   ⚠️ preguntó cuántas y contestó con una lista");
});

test("«¿Cuánto facturé este mes?» — recepcionista SIN billing.view", { skip: saltar }, async () => {
  const db = base();
  const ctx = { ...recepcionNorte(db), permissionsOverride: ["agenda.view", "patients.view"] };
  const salida = await ejecutarSabina({ ctx, pregunta: "¿Cuánto facturé este mes?", tools: SABINA_TOOLS });
  imprimir("facturación sin permiso", salida);

  assert.equal(salida.fallo, false, "el modelo no contestó");
  assert.match(salida.respuesta, /no tienes acceso a facturaci[oó]n/i);
  if (/\$\s?\d/.test(salida.respuesta)) console.log("   ⚠️ la respuesta trae una cifra en pesos sin tener permiso");
});

test("«¿Quién me debe?» — administradora", { skip: saltar }, async () => {
  const db = base();
  const ctx = adminNorte(db);
  const directo = await ejecutarHerramienta("pacientes_con_deuda", ctx, {});
  const salida = await ejecutarSabina({ ctx, pregunta: "¿Quién me debe?", tools: SABINA_TOOLS });
  imprimir("deuda", salida, directo.ok ? (directo as { resumen: string }).resumen : JSON.stringify(directo));

  assert.equal(salida.fallo, false, "el modelo no contestó");
  assert.ok(salida.herramientasUsadas.length > 0, "contestó sin consultar nada");
  if (/SUR/.test(salida.respuesta)) console.log("   ⚠️ aparece un paciente de la otra clínica");
  if (directo.ok) revisarLista(salida.respuesta, (directo as { datos: { deudores: { filas: unknown[] } } }).datos.deudores.filas.length);
});

test("«Enlista los pacientes que deben» — administradora (las palabras de Rafael)", { skip: saltar }, async () => {
  const db = base();
  const ctx = adminNorte(db);
  const directo = await ejecutarHerramienta("pacientes_con_deuda", ctx, {});
  const salida = await ejecutarSabina({ ctx, pregunta: "enlista los pacientes que deben", tools: SABINA_TOOLS });
  imprimir("deuda en lista", salida, directo.ok ? (directo as { resumen: string }).resumen : JSON.stringify(directo));

  assert.equal(salida.fallo, false, "el modelo no contestó");
  assert.ok(salida.herramientasUsadas.includes("pacientes_con_deuda"), "contestó sin consultar la deuda");
  if (directo.ok) revisarLista(salida.respuesta, (directo as { datos: { deudores: { filas: unknown[] } } }).datos.deudores.filas.length);
});
