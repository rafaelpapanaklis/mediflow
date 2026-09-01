// Qué promete la ficha vs. qué manda el cron.
//   npm run test:reminders-promise
//
// Puro, sin BD. La tarjeta "Reglas automáticas" del expediente prometía a todo
// el mundo un "recordatorio por WhatsApp 24h antes (si la clínica tiene
// WhatsApp activado)". El paréntesis miraba la CONEXIÓN de WhatsApp, no el
// interruptor de los recordatorios: en una clínica con reminderSettings
// enabled:false y waReminderActive:false el aviso seguía prometiendo un mensaje
// que no sale nunca. Lo que se prueba aquí es que el veredicto que pinta la
// ficha corta donde corta el cron (src/lib/reminders/enqueue.ts) y no antes.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getEffectiveReminderSettings,
  DEFAULT_REMINDER_TEMPLATE,
  type ReminderSettings,
} from "../config";
import { resolveReminderOutcome, reminderOffsetHours } from "../promise";

const ON: ReminderSettings = {
  enabled: true,
  offsets: [1440],
  channel: "whatsapp",
  template: DEFAULT_REMINDER_TEMPLATE,
};

function outcome(over: Partial<Parameters<typeof resolveReminderOutcome>[0]> = {}) {
  return resolveReminderOutcome({
    settings: ON,
    waConnected: true,
    patientHasPhone: true,
    patientHasEmail: true,
    patientPrefs: null,
    ...over,
  });
}

/* ───────────── el caso reportado ───────────── */

test("recordatorios APAGADOS: no se promete nada aunque WhatsApp esté conectado", () => {
  // La clínica del reporte: reminderSettings enabled:false y waReminderActive
  // false. Antes la tarjeta solo miraba waConnected y prometía igual.
  const settings = getEffectiveReminderSettings({
    reminderSettings: { enabled: false, offsets: [1440], channel: "whatsapp" },
    waReminderActive: false,
  });
  assert.equal(settings.enabled, false);

  const r = outcome({ settings, waConnected: true });
  assert.equal(r.willSend, false);
  assert.equal(r.reason, "disabled");
  assert.deepEqual(r.channels, []);
});

test("waReminderActive en NULL significa ENCENDIDO, no apagado", () => {
  // TRAMPA del helper legacy: `waReminderActive ?? true`. Dar por hecho que
  // null es apagado dejaría la tarjeta diciendo "no le llega nada" a todas las
  // clínicas que nunca tocaron el toggle — que son las que SÍ reciben.
  const settings = getEffectiveReminderSettings({
    reminderSettings: null,
    waReminderActive: null,
    waReminder24h: null,
  });
  assert.equal(settings.enabled, true);
  assert.deepEqual(settings.offsets, [1440]);
  assert.equal(outcome({ settings }).willSend, true);
});

test("encendido pero sin ningún momento elegido: tampoco sale nada", () => {
  // El cron corta con `!enabled || offsets.length === 0`; el segundo término
  // es alcanzable desde el legacy (24h off, 1h off).
  const settings = getEffectiveReminderSettings({
    waReminderActive: true,
    waReminder24h: false,
    waReminder1h: false,
  });
  assert.equal(settings.enabled, false);
  assert.equal(outcome({ settings }).reason, "disabled");
});

/* ───────────── el canal ───────────── */

test("canal WhatsApp sin conexión de Meta: encendidos y aun así no sale nada", () => {
  const r = outcome({ waConnected: false });
  assert.equal(r.willSend, false);
  assert.equal(r.reason, "noChannel");
});

test('canal "both" sin WhatsApp conectado: sale el correo, y solo el correo', () => {
  const r = outcome({ settings: { ...ON, channel: "both" }, waConnected: false });
  assert.equal(r.willSend, true);
  assert.deepEqual(r.channels, ["email"]);
});

test("canal email: no depende de la conexión de WhatsApp", () => {
  const r = outcome({ settings: { ...ON, channel: "email" }, waConnected: false });
  assert.deepEqual(r.channels, ["email"]);
});

/* ───────────── el dato de contacto ───────────── */

test("sin teléfono no sale WhatsApp: el cron lo cuenta como skipped", () => {
  const r = outcome({ patientHasPhone: false });
  assert.equal(r.willSend, false);
  assert.equal(r.reason, "noContact");
  // `wanted` sobrevive para poder decir QUÉ dato falta.
  assert.deepEqual(r.wanted, ["whatsapp"]);
});

test('canal "both" sin correo: sigue saliendo por WhatsApp', () => {
  const r = outcome({ settings: { ...ON, channel: "both" }, patientHasEmail: false });
  assert.equal(r.willSend, true);
  assert.deepEqual(r.channels, ["whatsapp"]);
});

test('canal "both" sin teléfono NI correo: no sale nada y se nombran los dos', () => {
  const r = outcome({
    settings: { ...ON, channel: "both" },
    patientHasPhone: false,
    patientHasEmail: false,
  });
  assert.equal(r.reason, "noContact");
  assert.deepEqual(r.wanted, ["whatsapp", "email"]);
});

/* ───────────── el momento, que no siempre es 24 h ───────────── */

test("el momento sale de la config, no de un 24h escrito a mano", () => {
  const r = outcome({ settings: { ...ON, offsets: [2880, 120] } });
  assert.deepEqual(r.offsets, [2880, 120]);
  assert.equal(reminderOffsetHours(2880), 48);
  assert.equal(reminderOffsetHours(120), 2);
});

test("un momento que no son horas enteras se pinta en minutos, no en '0.5 h'", () => {
  assert.equal(reminderOffsetHours(30), null);
  assert.equal(reminderOffsetHours(0), null);
});

/* ───────────── el override del paciente (portal) ───────────── */

test("el paciente eligió 2 h: la ficha dice 2 h, no las 24 h de la clínica", () => {
  const r = outcome({
    settings: { ...ON, offsets: [1440, 120], channel: "both" },
    patientPrefs: { channel: "email", leadMinutes: 120 },
  });
  assert.deepEqual(r.offsets, [120]);
  assert.deepEqual(r.channels, ["email"]);
});

test("el override NO puede dejar al paciente sin ningún canal", () => {
  // Mismo `if (wa || em)` del cron: si el filtro vaciaría los dos canales, se
  // ignora entero y manda la config de la clínica.
  const r = outcome({
    settings: { ...ON, channel: "whatsapp" },
    patientPrefs: { channel: "email", leadMinutes: 1440 },
  });
  assert.equal(r.willSend, true);
  assert.deepEqual(r.channels, ["whatsapp"]);
});

test("un momento que la clínica NO ofrece no recorta nada: sigue recibiendo todos", () => {
  const r = outcome({
    settings: { ...ON, offsets: [2880, 240] },
    patientPrefs: { channel: "both", leadMinutes: 120 },
  });
  assert.deepEqual(r.offsets, [2880, 240]);
});

test("los recordatorios apagados ganan al override del paciente", () => {
  const r = outcome({
    settings: { ...ON, enabled: false },
    patientPrefs: { channel: "both", leadMinutes: 1440 },
  });
  assert.equal(r.reason, "disabled");
});
