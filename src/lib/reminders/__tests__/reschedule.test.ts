// Reagendar: qué recordatorios se cancelan y cuáles se recrean (M-22).
//   npm run test:reminders-reschedule
//
// Puro, sin BD. Lo que se prueba aquí es exactamente lo que fallaba: el aviso
// en cola lleva la hora vieja congelada en el texto y, mientras exista, bloquea
// el dedup del encolador — así que no es que llegue tarde, es que no llega.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planReminderReschedule,
  isPendingReminderStatus,
  type ExistingApptReminder,
} from "../reschedule";

const NOW = new Date("2026-08-11T10:00:00.000Z");
/** Cita dentro de 3 días: caben holgados el aviso de 24 h y el de 2 h. */
const NEW_START = new Date("2026-08-14T17:00:00.000Z");

const WA_ONLY = { enabled: true, offsets: [1440, 120], channel: "whatsapp" as const };

function plan(over: Partial<Parameters<typeof planReminderReschedule>[0]> = {}) {
  return planReminderReschedule({
    existing: [],
    newStartsAt: NEW_START,
    now: NOW,
    settings: WA_ONLY,
    hasPhone: true,
    hasEmail: true,
    ...over,
  });
}

/* ─────────────── el legacy 'ACTIVE' ─────────────── */

test("'ACTIVE' cuenta como pendiente: es el legacy del schema", () => {
  // TRAMPA: la columna es TEXT y hay filas de mayo con 'ACTIVE' que significan
  // pendiente. Filtrar solo por 'PENDING' dejaría vivas justo las más viejas y
  // el bug seguiría para ellas.
  assert.equal(isPendingReminderStatus("ACTIVE"), true);
  assert.equal(isPendingReminderStatus("PENDING"), true);
  assert.equal(isPendingReminderStatus("SENT"), false);
  assert.equal(isPendingReminderStatus("FAILED"), false);
  assert.equal(isPendingReminderStatus("CANCELLED"), false);
  assert.equal(isPendingReminderStatus(null), false);
  assert.equal(isPendingReminderStatus(undefined), false);
  assert.equal(isPendingReminderStatus(""), false);
});

test("una fila legacy 'ACTIVE' se cancela igual que una 'PENDING'", () => {
  const existing: ExistingApptReminder[] = [
    { id: "viejo-activo", status: "ACTIVE" },
    { id: "nuevo-pendiente", status: "PENDING" },
  ];
  const p = plan({ existing });
  assert.deepEqual(p.cancelIds.sort(), ["nuevo-pendiente", "viejo-activo"]);
  assert.deepEqual(p.keepIds, []);
});

test("se tolera otra caja o espacios en el status", () => {
  const p = plan({ existing: [{ id: "a", status: " active " }] });
  assert.deepEqual(p.cancelIds, ["a"]);
});

/* ─────────────── los enviados son historial ─────────────── */

test("los SENT no se tocan", () => {
  // Además de ser historial, son las filas contra las que el webhook empareja
  // un "CONFIRMAR"/"CANCELAR": borrarlas dejaba sin efecto la respuesta del
  // paciente a un recordatorio que YA había recibido.
  const existing: ExistingApptReminder[] = [
    { id: "ya-salio", status: "SENT" },
    { id: "en-cola", status: "PENDING" },
  ];
  const p = plan({ existing });
  assert.deepEqual(p.cancelIds, ["en-cola"]);
  assert.deepEqual(p.keepIds, ["ya-salio"]);
});

test("FAILED y CANCELLED tampoco se reescriben", () => {
  const existing: ExistingApptReminder[] = [
    { id: "fallo", status: "FAILED" },
    { id: "cancelado", status: "CANCELLED" },
  ];
  const p = plan({ existing });
  assert.deepEqual(p.cancelIds, []);
  assert.deepEqual(p.keepIds.sort(), ["cancelado", "fallo"]);
});

/* ─────────────── recreación ─────────────── */

test("se recrea un aviso por cada momento configurado, con la hora NUEVA", () => {
  const p = plan();
  assert.equal(p.create.length, 2);
  const de24h = p.create.find((c) => c.offsetMin === 1440)!;
  const de2h = p.create.find((c) => c.offsetMin === 120)!;
  assert.deepEqual(de24h.scheduledFor, new Date("2026-08-13T17:00:00.000Z"));
  assert.deepEqual(de2h.scheduledFor, new Date("2026-08-14T15:00:00.000Z"));
  assert.ok(p.create.every((c) => c.channel === "whatsapp"));
});

test("un momento que YA pasó no se recrea", () => {
  // Cita movida a dentro de 3 h con avisos de 24 h y 2 h: el de 24 h ya no
  // tiene sentido. Encolarlo con scheduledFor=ahora mandaría "te recordamos tu
  // cita de mañana" tres horas antes.
  const p = plan({ newStartsAt: new Date("2026-08-11T13:00:00.000Z") });
  assert.deepEqual(
    p.create.map((c) => c.offsetMin),
    [120],
  );
});

test("si todos los momentos pasaron no se crea nada, pero SÍ se cancela", () => {
  const p = plan({
    existing: [{ id: "en-cola", status: "PENDING" }],
    newStartsAt: new Date("2026-08-11T10:30:00.000Z"),
  });
  assert.deepEqual(p.cancelIds, ["en-cola"]);
  assert.deepEqual(p.create, []);
});

test("con los recordatorios apagados se cancela y no se recrea nada", () => {
  const p = plan({
    existing: [{ id: "en-cola", status: "PENDING" }],
    settings: { enabled: false, offsets: [1440], channel: "whatsapp" },
  });
  assert.deepEqual(p.cancelIds, ["en-cola"]);
  assert.deepEqual(p.create, []);
});

/* ─────────────── canales ─────────────── */

test("canal 'both' crea WhatsApp y email por cada momento", () => {
  const p = plan({ settings: { enabled: true, offsets: [1440], channel: "both" } });
  assert.deepEqual(p.create.map((c) => c.channel).sort(), ["email", "whatsapp"]);
});

test("sin teléfono no se crea el de WhatsApp; sin correo, no el de email", () => {
  const soloEmail = plan({
    settings: { enabled: true, offsets: [1440], channel: "both" },
    hasPhone: false,
  });
  assert.deepEqual(soloEmail.create.map((c) => c.channel), ["email"]);

  const soloWa = plan({
    settings: { enabled: true, offsets: [1440], channel: "both" },
    hasEmail: false,
  });
  assert.deepEqual(soloWa.create.map((c) => c.channel), ["whatsapp"]);

  const ninguno = plan({
    settings: { enabled: true, offsets: [1440], channel: "both" },
    hasPhone: false,
    hasEmail: false,
  });
  assert.deepEqual(ninguno.create, []);
});

/* ─────────────── preferencias del paciente ─────────────── */

test("si el paciente eligió una anticipación que la clínica ofrece, recibe SOLO esa", () => {
  const p = plan({ pref: { leadMinutes: 120, channel: "both" } });
  assert.deepEqual(p.create.map((c) => c.offsetMin), [120]);
});

test("si eligió una anticipación que la clínica NO ofrece, no se filtra nada", () => {
  const p = plan({ pref: { leadMinutes: 240, channel: "both" } });
  assert.deepEqual(p.create.map((c) => c.offsetMin).sort((a, b) => b - a), [1440, 120]);
});

test("el canal del paciente se cruza con el de la clínica", () => {
  const p = plan({
    settings: { enabled: true, offsets: [1440], channel: "both" },
    pref: { leadMinutes: 1440, channel: "email" },
  });
  assert.deepEqual(p.create.map((c) => c.channel), ["email"]);
});

test("si el cruce dejaría al paciente sin ningún canal, se ignora su preferencia", () => {
  // La clínica solo manda WhatsApp y el paciente pidió solo email: quedarse sin
  // aviso es peor que recibirlo por el canal que hay.
  const p = plan({
    settings: { enabled: true, offsets: [1440], channel: "whatsapp" },
    pref: { leadMinutes: 1440, channel: "email" },
  });
  assert.deepEqual(p.create.map((c) => c.channel), ["whatsapp"]);
});

/* ─────────────── varios ─────────────── */

test("offsets repetidos en la config no generan dos avisos iguales", () => {
  const p = plan({ settings: { enabled: true, offsets: [1440, 1440], channel: "whatsapp" } });
  assert.equal(p.create.length, 1);
});

test("sin recordatorios previos no hay nada que cancelar, pero sí que crear", () => {
  const p = plan({ existing: [] });
  assert.deepEqual(p.cancelIds, []);
  assert.equal(p.create.length, 2);
});

test("el caso completo del bug: pendiente con hora vieja + enviado, cita movida", () => {
  const p = plan({
    existing: [
      { id: "enviado-hora-vieja", status: "SENT" },
      { id: "en-cola-hora-vieja", status: "PENDING" },
      { id: "en-cola-legacy", status: "ACTIVE" },
    ],
  });
  // Los dos que no han salido se cancelan (llevan la hora anterior dentro).
  assert.deepEqual(p.cancelIds.sort(), ["en-cola-hora-vieja", "en-cola-legacy"]);
  // El que ya salió se conserva: es historial y ancla la respuesta del paciente.
  assert.deepEqual(p.keepIds, ["enviado-hora-vieja"]);
  // Y se encolan los de la hora nueva.
  assert.equal(p.create.length, 2);
});
