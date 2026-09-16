/**
 * La pista de «dónde estoy», del lado del navegador (ws1-t1).
 *
 *   npm run test:sabina-contexto-pantalla
 *
 * Es un módulo puro a propósito, y esta prueba es la razón: lo que decide qué
 * sale de la pantalla hacia el prompt tiene que poder comprobarse sin montar
 * medio panel.
 *
 * Lo que se vigila:
 *  · que de una ruta salga la pantalla que toca y NADA más;
 *  · que un segmento que no es un id de paciente no se mande como si lo fuera;
 *  · que la consulta abierta sirva de respaldo pero nunca pise a la ficha;
 *  · que toda pantalla que se manda esté en la lista cerrada que valida el
 *    servidor (si se separan, el cartel del cajón promete una cosa y el prompt
 *    dice otra).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contextoDePantalla,
  esPantallaConocida,
  ETIQUETA_PANTALLA,
} from "../contexto-pantalla";

/** Un `URLSearchParams` de mentira, para no depender del navegador. */
function buscar(qs: string) {
  return new URLSearchParams(qs);
}

const ID_ANA = "ckpaciente0001";

test("la ficha de un paciente manda pantalla e id", () => {
  assert.deepEqual(contextoDePantalla(`/dashboard/patients/${ID_ANA}`), {
    pantalla: "ficha-paciente",
    pacienteId: ID_ANA,
  });
});

test("la pestaña abierta de la ficha NO viaja: no cambia ninguna respuesta", () => {
  const c = contextoDePantalla(`/dashboard/patients/${ID_ANA}`, buscar("tab=odontograma&charge=1"));
  assert.deepEqual(c, { pantalla: "ficha-paciente", pacienteId: ID_ANA });
});

test("la lista de pacientes no manda ningún id", () => {
  assert.deepEqual(contextoDePantalla("/dashboard/patients"), { pantalla: "pacientes" });
  assert.deepEqual(contextoDePantalla("/dashboard/patients/"), { pantalla: "pacientes" });
});

test("un segmento que no es un id no se manda como si lo fuera", () => {
  // «new» es la pantalla de alta, no un paciente.
  assert.deepEqual(contextoDePantalla("/dashboard/patients/new"), { pantalla: "pacientes" });
  // Demasiado corto para ser un id de la base.
  assert.deepEqual(contextoDePantalla("/dashboard/patients/x"), { pantalla: "pacientes" });
});

test("la agenda manda su día, y solo si es una fecha de verdad", () => {
  assert.deepEqual(contextoDePantalla("/dashboard/agenda", buscar("date=2026-09-16")), {
    pantalla: "agenda",
    fecha: "2026-09-16",
  });
  assert.deepEqual(contextoDePantalla("/dashboard/agenda", buscar("date=mañana")), { pantalla: "agenda" });
  // El doctor filtrado o la cita resaltada no son asunto de Sabina.
  assert.deepEqual(contextoDePantalla("/dashboard/agenda", buscar("highlight=cita-123&doctorId=u-1")), {
    pantalla: "agenda",
  });
});

test("las radiografías mandan su paciente, por ruta o por parámetro", () => {
  assert.deepEqual(contextoDePantalla(`/dashboard/xrays/${ID_ANA}`), {
    pantalla: "radiografias",
    pacienteId: ID_ANA,
  });
  assert.deepEqual(contextoDePantalla("/dashboard/xrays", buscar(`patient=${ID_ANA}`)), {
    pantalla: "radiografias",
    pacienteId: ID_ANA,
  });
});

test("caja, facturación e inicio se reconocen; el resto del panel no manda nada", () => {
  assert.deepEqual(contextoDePantalla("/dashboard/caja"), { pantalla: "caja" });
  assert.deepEqual(contextoDePantalla("/dashboard/billing"), { pantalla: "facturacion" });
  assert.deepEqual(contextoDePantalla("/dashboard"), { pantalla: "inicio" });
  // Sin entrada en la lista: la pregunta cuesta lo que costaba antes.
  assert.deepEqual(contextoDePantalla("/dashboard/settings/planes"), {});
  assert.deepEqual(contextoDePantalla("/dashboard/inventory"), {});
  assert.deepEqual(contextoDePantalla("/admin/settings"), {});
  assert.deepEqual(contextoDePantalla(""), {});
  assert.deepEqual(contextoDePantalla(null), {});
});

test("el paciente del sillón sirve de respaldo, pero nunca pisa al de la ficha", () => {
  const enSillon = { patientId: "ckpaciente0002" };
  // En la agenda no hay paciente en la URL: manda el del sillón.
  assert.deepEqual(contextoDePantalla("/dashboard/agenda", null, enSillon), {
    pantalla: "agenda",
    pacienteId: "ckpaciente0002",
  });
  // Con otra ficha abierta, manda la ficha.
  assert.deepEqual(contextoDePantalla(`/dashboard/patients/${ID_ANA}`, null, enSillon), {
    pantalla: "ficha-paciente",
    pacienteId: ID_ANA,
  });
  // Sin consulta abierta, nada.
  assert.deepEqual(contextoDePantalla("/dashboard/caja", null, { patientId: null }), { pantalla: "caja" });
});

test("toda pantalla que se manda está en la lista cerrada que valida el servidor", () => {
  const rutas = [
    "/dashboard",
    "/dashboard/patients",
    `/dashboard/patients/${ID_ANA}`,
    "/dashboard/agenda",
    "/dashboard/caja",
    "/dashboard/billing",
    "/dashboard/xrays",
    `/dashboard/xrays/${ID_ANA}`,
  ];
  for (const ruta of rutas) {
    const c = contextoDePantalla(ruta);
    assert.ok(esPantallaConocida(c.pantalla), `${ruta} manda una pantalla que el servidor va a tirar`);
  }
  // Y todas las etiquetas están escritas: un hueco sería un «undefined» en el prompt.
  for (const [id, etiqueta] of Object.entries(ETIQUETA_PANTALLA)) {
    assert.ok(etiqueta && etiqueta.length > 2, `${id} no tiene nombre en español`);
  }
});
