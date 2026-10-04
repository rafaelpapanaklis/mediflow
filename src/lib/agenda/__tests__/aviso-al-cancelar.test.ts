// ws1-t1 (ronda de arreglos de la auditoría de uso, C-86) — «Cancelar cita» desde la ficha.
// Con el código de antes: la ficha cancelaba con `window.confirm` («Quedara en estado CANCELLED…») por DELETE,
// sin casilla «Avisar al paciente» ni la pregunta del dinero, y la pantalla decía «Cita cancelada» aunque el
// servidor contestara `apagadoPorClinica`. No existía `aviso-al-cancelar`, y /api/clinic/me no decía nada del
// aviso de cancelación.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  campoDelAvisoCancelar,
  estadoDelAvisoCancelar,
  lineaSinAvisoAlCancelar,
  resumenTrasCancelar,
} from "../aviso-al-cancelar";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("el ajuste de la clínica: conectada y encendido → encendido; apagado → apagado; sin WhatsApp → sinWhatsApp", () => {
  assert.equal(estadoDelAvisoCancelar({ clinic: { waConnected: true, waNotifyOnCancel: true } }), "encendido");
  assert.equal(estadoDelAvisoCancelar({ clinic: { waConnected: true, waNotifyOnCancel: false } }), "apagado");
  assert.equal(estadoDelAvisoCancelar({ clinic: { waConnected: false, waNotifyOnCancel: true } }), "sinWhatsApp");
  assert.equal(estadoDelAvisoCancelar({ clinic: { waConnected: true } }), null);
  assert.equal(estadoDelAvisoCancelar(null), null);
});

test("desmarcada viaja notifyPatient:false; en cualquier otro caso el cuerpo queda como siempre", () => {
  assert.deepEqual(campoDelAvisoCancelar("encendido", false), { notifyPatient: false });
  assert.deepEqual(campoDelAvisoCancelar("encendido", true), {});
  assert.deepEqual(campoDelAvisoCancelar("apagado", false), {});
  assert.deepEqual(campoDelAvisoCancelar("sinWhatsApp", false), {});
  assert.deepEqual(campoDelAvisoCancelar(null, false), {});
});

test("sin aviso posible, el diálogo lo dice donde iría la casilla", () => {
  assert.match(lineaSinAvisoAlCancelar("apagado")!, /al paciente no le llega nada/);
  assert.match(lineaSinAvisoAlCancelar("sinWhatsApp")!, /no tiene WhatsApp conectado/);
  assert.equal(lineaSinAvisoAlCancelar("encendido"), null);
  assert.equal(lineaSinAvisoAlCancelar(null), null);
});

test("🔴→🟢 tras cancelar con el aviso apagado, el mensaje dice que NO se avisó (antes: solo «Cita cancelada»)", () => {
  const r = resumenTrasCancelar({ whatsapp: { enviado: false, motivo: "apagadoPorClinica" } }, false);
  assert.equal(r.tono, "info");
  assert.match(r.texto, /^Cita cancelada\. No se le avisó al paciente/);
});

test("el mensaje junta cita, dinero y aviso", () => {
  assert.deepEqual(resumenTrasCancelar({ whatsapp: { enviado: true } }, false), {
    tono: "ok",
    texto: "Cita cancelada. Se le avisó al paciente por WhatsApp.",
  });
  assert.match(resumenTrasCancelar({ whatsapp: null }, true).texto, /así lo elegiste/);
  const conDinero = resumenTrasCancelar({ dineroCita: { decision: "a_favor", monto: 300, motivo: null }, whatsapp: null }, false);
  assert.match(conDinero.texto, /\$300\.00 quedaron a favor del paciente/);
  const fallo = resumenTrasCancelar({ whatsapp: { enviado: false, motivo: "noPhone" } }, false);
  assert.equal(fallo.tono, "error");
  assert.match(fallo.texto, /NO salió: el paciente no tiene un teléfono válido/);
  // Una cita que ya pasó no es noticia.
  assert.equal(resumenTrasCancelar({ whatsapp: { enviado: false, motivo: "citaPasada" } }, false).texto, "Cita cancelada.");
});

test("🔴→🟢 la ficha ya no cancela con el confirm del navegador: usa el diálogo de la Agenda", () => {
  const ficha = sinComentarios(leer("app/dashboard/patients/[id]/patient-detail-client.tsx"));
  const desde = ficha.indexOf("async function handleCancelAppointment");
  const cuerpo = ficha.slice(desde, ficha.indexOf("\n  }\n", desde));
  assert.ok(!/window\.confirm/.test(cuerpo), "nada de confirm() del navegador");
  assert.ok(!/method: "DELETE"/.test(cuerpo), "cancela por PATCH /status, que sabe del dinero y del aviso");
  assert.match(cuerpo, /cancelarCita\.preguntar\(/);
  assert.match(cuerpo, /cancelarCitaEnServidor\(/);
  assert.match(ficha, /\{cancelarCita\.elemento\}/);
});

test("las tres puertas de cancelar usan el mismo diálogo", () => {
  for (const f of [
    "components/dashboard/agenda-nueva/panel-cita.tsx",
    "components/dashboard/citas-expediente/ventana-cita.tsx",
    "app/dashboard/patients/[id]/patient-detail-client.tsx",
  ]) {
    const t = leer(f);
    assert.match(t, /useCancelarCita\(\)/, `${f} no usa el diálogo común`);
    assert.match(t, /cancelarCitaEnServidor\(/, `${f} no cancela con la función común`);
  }
});

test("el diálogo pregunta el ajuste del aviso y /api/clinic/me lo da", () => {
  const dialogo = leer("components/dashboard/agenda/cancelar-cita.tsx");
  assert.match(dialogo, /pedirJson\("\/api\/clinic\/me"\)/);
  assert.match(dialogo, /data-aviso-cancelar="casilla"/);
  const me = leer("app/api/clinic/me/route.ts");
  assert.match(me, /waNotifyOnCancel = eventos\.alCancelar/);
  assert.match(me, /waNotifyOnCancel \}/);
});

// ws1-t1 (N-51, tercera ronda): el diálogo decía «no tiene WhatsApp conectado» y el toast «el aviso de
// cancelación está apagado»: dos razones para lo mismo.
test("🔴→🟢 N-51: sin WhatsApp, el mensaje final da la misma razón que el diálogo", () => {
  const r = resumenTrasCancelar({ whatsapp: { enviado: false, motivo: "apagadoPorClinica" } }, false, "sinWhatsApp");
  assert.match(r.texto, /No se le avisó al paciente: la clínica no tiene WhatsApp conectado/);
  assert.ok(!/aviso de cancelación está apagado/.test(r.texto));
  // Con WhatsApp y el interruptor apagado, sigue diciendo que está apagado.
  assert.match(resumenTrasCancelar({ whatsapp: { enviado: false, motivo: "apagadoPorClinica" } }, false, "apagado").texto, /aviso de cancelación está apagado/);
  const dialogo = readFileSync(join(SRC, "components/dashboard/agenda/cancelar-cita.tsx"), "utf8");
  assert.match(dialogo, /resumenTrasCancelar\(cuerpo, !!r\.avisoCallado, r\.estadoAviso\)/);
  assert.match(dialogo, /estadoAviso: pregunta\.aviso,/);
});
