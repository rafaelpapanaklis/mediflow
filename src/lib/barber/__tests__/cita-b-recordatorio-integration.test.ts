// Cita «B», punto 3: «Mandar recordatorio ahora» desde la cita (ws6-t5).
//
// Por el MISMO motor que el automático (plantilla, ventana de 24 h, cupo,
// candado) y sin duplicar con él. Meta simulada con _wa-arnes.ts.
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/cita-b-recordatorio-integration.test.ts
import {
  borrarTodo,
  crearCita,
  crearTienda,
  enviados,
  instalarFetch,
  limpiar,
  mensajes,
  onGraph,
  prisma,
  restaurarFetch,
  skip,
  telefono,
  BASE_LOCAL,
  type Tienda,
} from "./_wa-arnes";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { REMIND_NOW_DEDUPE_MS, scheduleBarberReminders, sendBarberReminderNow } from "../whatsapp";
import { barberWaTemplate } from "../whatsapp-core";
import { isInvalidatedReminder } from "../agenda";

const REMINDER = barberWaTemplate("reminder").name;

let A: Tienda; // con WhatsApp
let SIN: Tienda; // sin WhatsApp conectado

before(async () => {
  if (!BASE_LOCAL) return;
  instalarFetch();
  A = await crearTienda({ name: "Barbería El Corte" });
  SIN = await crearTienda({ name: "Sin WhatsApp", conectada: false });
});

after(async () => {
  restaurarFetch();
  if (!BASE_LOCAL) return;
  await borrarTodo();
});

beforeEach(() => {
  limpiar();
  onGraph(null);
});

test("3 · recordatorio ahora: sale por la plantilla de siempre, una vez; el automático no manda otro", { skip }, async () => {
  const phone = telefono();
  const cita = await crearCita(A, { phone, enMinutos: 5 * 60, conBarbero: true });

  const r1 = await sendBarberReminderNow({ barbershopId: A.id, appointmentId: cita.id });
  assert.equal(r1.status, "sent", JSON.stringify(r1));
  assert.equal(enviados().length, 1);
  const [fila] = await mensajes(A, phone);
  assert.equal(fila.templateName, REMINDER, "la fila es un recordatorio de los de siempre");
  assert.equal(fila.appointmentId, cita.id);

  // Otra vez enseguida: no manda otro y dice cuándo salió.
  const r2 = await sendBarberReminderNow({ barbershopId: A.id, appointmentId: cita.id });
  assert.equal(r2.status, "skipped");
  assert.equal(r2.code, "RECENT");
  assert.match(r2.reason ?? "", /Ya le salió un recordatorio a las/);
  assert.equal(enviados().length, 1);

  // El automático tampoco: esa cita ya tiene su recordatorio.
  assert.deepEqual(await scheduleBarberReminders(A.id), { queued: 0 });
  assert.equal((await mensajes(A, phone)).length, 1);
  assert.ok(REMIND_NOW_DEDUPE_MS >= 60 * 60 * 1000);
});

test("3 · si el automático ya lo tiene en cola, «ahora» no encola otro", { skip }, async () => {
  const phone = telefono();
  const cita = await crearCita(A, { phone, enMinutos: 6 * 60 });
  assert.equal((await scheduleBarberReminders(A.id)).queued >= 1, true);
  const r = await sendBarberReminderNow({ barbershopId: A.id, appointmentId: cita.id });
  assert.equal(r.code, "ALREADY_QUEUED");
  assert.equal((await mensajes(A, phone)).length, 1);
});

test("3 · nunca en citas pasadas, canceladas, sin aceptar, lejanas o sin teléfono; sin WhatsApp, lo dice", { skip }, async () => {
  const casos: Array<[string, Parameters<typeof crearCita>[1], string]> = [
    ["pasada", { phone: telefono(), enMinutos: -30 }, "PAST"],
    ["cancelada", { phone: telefono(), enMinutos: 120, status: "CANCELLED" }, "CLOSED"],
    ["no llegó", { phone: telefono(), enMinutos: 120, status: "NO_SHOW" }, "CLOSED"],
    ["solicitud en línea sin aceptar", { phone: telefono(), enMinutos: 120, source: "PUBLIC" }, "REQUEST_PENDING"],
    ["dentro de 3 días", { phone: telefono(), enMinutos: 3 * 24 * 60 }, "TOO_EARLY"],
    ["sin teléfono", { phone: "", enMinutos: 120 }, "NO_PHONE"],
  ];
  for (const [nombre, args, code] of casos) {
    const cita = await crearCita(A, args);
    const r = await sendBarberReminderNow({ barbershopId: A.id, appointmentId: cita.id });
    assert.equal(r.status, "skipped", nombre);
    assert.equal(r.code, code, nombre);
  }
  assert.equal(enviados().length, 0, "no salió nada");

  const sinWa = await crearCita(SIN, { phone: telefono(), enMinutos: 120 });
  const r = await sendBarberReminderNow({ barbershopId: SIN.id, appointmentId: sinWa.id });
  assert.equal(r.code, "NOT_CONNECTED");
  assert.match(r.reason ?? "", /No hay WhatsApp conectado/);

  // La cita de otra barbería no existe para esta.
  assert.equal((await sendBarberReminderNow({ barbershopId: A.id, appointmentId: sinWa.id })).code, "NOT_FOUND");
});

test("3 · si Meta lo rechaza, dice por qué y deja la puerta abierta al automático", { skip }, async () => {
  const phone = telefono();
  const cita = await crearCita(A, { phone, enMinutos: 4 * 60 });
  onGraph((call) =>
    call.url.endsWith("/messages")
      ? { status: 400, json: { error: { code: 131026, message: "(#131026) Message undeliverable" } } }
      : null,
  );
  const r = await sendBarberReminderNow({ barbershopId: A.id, appointmentId: cita.id });
  assert.equal(r.status, "skipped");
  assert.ok(r.reason);
  const [fila] = await mensajes(A, phone);
  assert.equal(fila.status, "FAILED");
  assert.ok(isInvalidatedReminder(fila.errorMessage), "marcada como invalidada");
  onGraph(null);
  assert.equal((await scheduleBarberReminders(A.id)).queued >= 1, true, "el automático puede volver a intentarlo");
});
