// ═══════════════════════════════════════════════════════════════════════
// ACUSE AUTOMÁTICO ANTES de pegar sql/barber_wa_acuse.sql: nada truena.
//
// Corre contra una base local SIN esa tabla (si la tabla existe, se salta):
//   DATABASE_URL=postgresql://…@127.0.0.1:…/<base-sin-acuse> DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/wa-acuse-sin-tabla-integration.test.ts
// ═══════════════════════════════════════════════════════════════════════
import {
  borrarTodo,
  crearCita,
  crearCliente,
  crearTienda,
  entrante,
  enviados,
  instalarFetch,
  prisma,
  restaurarFetch,
  skip as skipBase,
  telefono,
  BASE_LOCAL,
} from "./_wa-arnes";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ingestBarberInbound } from "../whatsapp";
import { barberWaTemplate } from "../whatsapp-core";
import { BarberWaAckStorageError, getBarberWaAck, saveBarberWaAck } from "../wa-acuse";

/** Por qué se salta (lo decide before(), ya con la base a la vista). */
let motivo: string | null = null;

before(async () => {
  if (!BASE_LOCAL) return;
  if ((await getBarberWaAck("no-existe")).storageReady) motivo = "esta base YA tiene barber_wa_acuse";
  instalarFetch();
});

after(async () => {
  restaurarFetch();
  if (BASE_LOCAL) await borrarTodo();
});

test("sin la tabla: el ajuste se lee APAGADO y guardar avisa que falta el SQL", { skip: skipBase }, async (ctx) => {
  if (motivo) return void ctx.skip(motivo);
  const t = await crearTienda();
  assert.deepEqual(await getBarberWaAck(t.id), { settings: { enabled: false, message: null }, storageReady: false });
  await assert.rejects(() => saveBarberWaAck(t.id, { enabled: true }), BarberWaAckStorageError);
});

test("sin la tabla: el cliente contesta al recordatorio y la ingesta sigue como antes", { skip: skipBase }, async (ctx) => {
  if (motivo) return void ctx.skip(motivo);
  const t = await crearTienda();
  const phone = telefono();
  const c = await crearCliente(t, phone);
  const cita = await crearCita(t, { phone, enMinutos: 600, clientId: c.id });
  await prisma.barberMessage.create({
    data: {
      barbershopId: t.id, direction: "OUTBOUND", phone, status: "DELIVERED",
      templateName: barberWaTemplate("reminder").name, appointmentId: cita.id,
      createdAt: new Date(Date.now() - 3_600_000),
    },
  });
  const { value, msg } = entrante(t, phone, "¿puedo llegar tarde?");
  assert.equal(await ingestBarberInbound(value, msg), true);
  assert.equal(enviados().length, 0);
  const entrantes = await prisma.barberMessage.count({ where: { barbershopId: t.id, phone, direction: "INBOUND" } });
  assert.equal(entrantes, 1, "el mensaje quedó en la bandeja");
});
