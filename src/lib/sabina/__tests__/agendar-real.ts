/**
 * SABINA AGENDA — CUATRO PEDIDOS CONTRA LA API REAL DE ANTHROPIC. Lo corre Rafael, a mano.
 *
 *   read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY
 *   SABINA_LLAMADA_REAL=1 npm run sabina:agendar-real
 *
 * ⚠️ GASTA DINERO (poco: cuatro pedidos directos, del orden de centavos de dólar).
 * Sin `SABINA_LLAMADA_REAL=1` y sin clave, las cuatro pruebas se SALTAN y no
 * sale ni una petición.
 *
 * `test:sabina-actua` ya recorre el camino entero con un modelo de guion. Lo que
 * solo el modelo de verdad puede decir es si ENTIENDE las herramientas: si llama a
 * `agendar_cita` con los datos bien puestos, si pregunta en vez de elegir entre
 * dos María García, y si ante un «sí» escrito manda al botón en vez de decir que
 * ya quedó.
 *
 * Qué es real y qué no:
 *  · REAL: el motor, `llamarAnthropic`, el modelo, `SABINA_TOOLS` con las cinco
 *    herramientas nuevas, los adaptadores, los permisos y el candado.
 *  · NO real: la base (la siembra de agenda de ws1-t2, en memoria, que LANZA ante
 *    cualquier escritura) y la confirmación: aquí nadie pulsa el botón, así que
 *    no se escribe nada en ningún sitio.
 */
import "../engine-sin-server-only";
import "../tools/__tests__/preparar";
import { mock, test } from "node:test";
import assert from "node:assert/strict";

import { idsQueCasan } from "../tools/__tests__/busqueda-falsa";
import { DIA, U_DOC2, baseAgenda, drSalas, en, recepcion, type BaseAgenda } from "../tools/__tests__/agenda-siembra";

let pacientes: any[] = [];
mock.module("@/lib/patients/patient-search", {
  namedExports: { buildPatientSearchSql: (args: unknown) => ({ __busqueda: args }), findPatientIdsBySearch: async () => null },
});

const AUTORIZADO = process.env.SABINA_LLAMADA_REAL === "1" && !!process.env.ANTHROPIC_API_KEY;
const saltar = AUTORIZADO ? false : "sin SABINA_LLAMADA_REAL=1 y ANTHROPIC_API_KEY no se llama a la API (gasta dinero)";

function base(): BaseAgenda {
  const db = baseAgenda();
  pacientes = db.filas.patients;
  db.$queryRaw = async (q: any) => (q?.__busqueda ? idsQueCasan(pacientes, q.__busqueda).map((id) => ({ id })) : []);
  return db;
}

async function motor() {
  const { ejecutarSabina } = await import("../engine");
  const { SABINA_TOOLS } = await import("../engine-catalog");
  return { ejecutarSabina, SABINA_TOOLS };
}

function imprimir(titulo: string, salida: any) {
  console.log(`\n━━ ${titulo}`);
  console.log(`   Sabina: ${String(salida.respuesta).replace(/\n/g, "\n           ")}`);
  console.log(`   herramientas: ${salida.herramientasUsadas.join(", ") || "(ninguna)"}`);
  for (const p of salida.propuestas) console.log(`   TARJETA ${p.accion}: ${p.tarjeta.frase}`);
  console.log(`   modelo: ${salida.modelo}${salida.escalado ? " (escaló)" : ""} · rondas: ${salida.rondas}`);
  for (const c of salida.consumo) console.log(`   tokens ${c.modelo}: entrada ${c.entrada} · salida ${c.salida}`);
}

test("«Agéndame a Juan Pérez… a las 9 con la Dra. Rojas, limpieza» — recepción: sale UNA tarjeta con los datos bien", { skip: saltar }, async () => {
  const { ejecutarSabina, SABINA_TOOLS } = await motor();
  const db = base();
  const salida = await ejecutarSabina({
    ctx: recepcion(db),
    pregunta: `Agéndame a Juan Pérez el ${DIA} a las 9 de la mañana con la Dra. Nadia Rojas, es una limpieza.`,
    tools: SABINA_TOOLS,
  });
  imprimir("agendar", salida);
  assert.equal(salida.fallo, false, "el modelo no contestó");
  assert.deepEqual(db.espia.escrituras, [], "nada escribió");
  assert.equal(salida.propuestas.length, 1, "no dejó tarjeta");
  const cuerpo = (salida.propuestas[0].datos as any).peticion.cuerpo;
  assert.equal(cuerpo.patientId, "p-juan");
  assert.equal(cuerpo.doctorId, U_DOC2);
  assert.equal(cuerpo.startsAt, en(DIA, "09:00").toISOString());
  if (/ya (qued|est[aá] agendad)|listo/i.test(salida.respuesta)) console.log("   ⚠️ la respuesta suena a hecho");
});

test("«Agéndame a María García…» — hay dos: tiene que PREGUNTAR, sin tarjeta", { skip: saltar }, async () => {
  const { ejecutarSabina, SABINA_TOOLS } = await motor();
  const db = base();
  const salida = await ejecutarSabina({
    ctx: recepcion(db),
    pregunta: `Agéndame a María García el ${DIA} a las 10 con la Dra. Rojas para limpieza.`,
    tools: SABINA_TOOLS,
  });
  imprimir("dos María García", salida);
  assert.equal(salida.fallo, false);
  assert.equal(salida.propuestas.length, 0, "eligió una María García por su cuenta");
  assert.deepEqual(db.espia.escrituras, []);
  if (!/P0001|P0002|cu[aá]l/i.test(salida.respuesta)) console.log("   ⚠️ no se ve la pregunta de cuál");
});

test("«sí, confírmalo» escrito en el chat — no hay tarjeta nueva y manda al botón", { skip: saltar }, async () => {
  const { ejecutarSabina, SABINA_TOOLS } = await motor();
  const db = base();
  const salida = await ejecutarSabina({
    ctx: recepcion(db),
    historial: [
      { role: "user", content: `Agéndame a Juan Pérez el ${DIA} a las 9 con la Dra. Rojas, limpieza.` },
      { role: "assistant", content: "Te propongo agendar a Juan Pérez a las 9:00 con Nadia Rojas. Confírmalo en la tarjeta." },
    ],
    pregunta: "sí, confírmalo",
    tools: SABINA_TOOLS,
  });
  imprimir("«sí» escrito", salida);
  assert.equal(salida.fallo, false);
  assert.deepEqual(db.espia.escrituras, []);
  if (!/bot[oó]n|tarjeta/i.test(salida.respuesta)) console.log("   ⚠️ no manda a la tarjeta");
  if (/ya qued|listo, qued/i.test(salida.respuesta)) console.log("   ⚠️ dice que ya quedó");
});

test("«cancela la cita de Juan de las 10» — el Dr. Salas (DOCTOR): dice que su rol no permite", { skip: saltar }, async () => {
  const { ejecutarSabina, SABINA_TOOLS } = await motor();
  const db = base();
  const salida = await ejecutarSabina({ ctx: drSalas(db), pregunta: `Cancela la cita de Juan Pérez del ${DIA} a las 10.`, tools: SABINA_TOOLS });
  imprimir("doctor cancela", salida);
  assert.equal(salida.fallo, false);
  assert.equal(salida.propuestas.length, 0);
  assert.deepEqual(db.espia.escrituras, []);
  assert.match(salida.respuesta, /rol no permite cancelar|no (puedes|tienes permiso para) cancelar/i);
});
