/**
 * TRES PREGUNTAS A SABINA CONTRA LA API REAL DE ANTHROPIC — lo corre Rafael, a mano.
 *
 *   read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY
 *   SABINA_LLAMADA_REAL=1 npm run sabina:pregunta-real
 *
 * ⚠️ GASTA DINERO (poco: tres preguntas directas con Haiku, del orden de
 * centavos de dólar). Sin `SABINA_LLAMADA_REAL=1` y sin clave, las tres pruebas
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
 * recepcionista, y los tokens reales por modelo. Las comprobaciones son
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

const AUTORIZADO = process.env.SABINA_LLAMADA_REAL === "1" && !!process.env.ANTHROPIC_API_KEY;
const saltar = AUTORIZADO ? false : "sin SABINA_LLAMADA_REAL=1 y ANTHROPIC_API_KEY no se llama a la API (gasta dinero)";

function imprimir(titulo: string, salida: Awaited<ReturnType<typeof ejecutarSabina>>, esperado?: string) {
  console.log(`\n━━ ${titulo}`);
  if (esperado) console.log(`   la herramienta, directa: ${esperado}`);
  console.log(`   Sabina: ${salida.respuesta.replace(/\n/g, "\n           ")}`);
  console.log(`   herramientas: ${salida.herramientasUsadas.join(", ") || "(ninguna)"}`);
  console.log(`   modelo: ${salida.modelo}${salida.escalado ? " (escaló)" : ""} · rondas: ${salida.rondas}`);
  for (const c of salida.consumo) console.log(`   tokens ${c.modelo}: entrada ${c.entrada} · salida ${c.salida}`);
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
});
