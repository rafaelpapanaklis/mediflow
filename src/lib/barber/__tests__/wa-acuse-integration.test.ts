// ═══════════════════════════════════════════════════════════════════════
// ACUSE AUTOMÁTICO opcional, de punta a punta por el webhook, con Postgres
// REAL y Meta simulado (_wa-arnes.ts).
//
// 🔴 Crea y borra barberías: solo corre con DATABASE_URL local, y necesita
// sql/barber_wa_acuse.sql cargado en esa base (si falta, se salta).
//
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/wa-acuse-integration.test.ts
// ═══════════════════════════════════════════════════════════════════════
import {
  borrarTodo,
  crearCita,
  crearCliente,
  crearTienda,
  ecoDelCelular,
  entrante,
  entranteVoz,
  enviados,
  instalarFetch,
  limpiar,
  mensajes,
  modelQueue,
  prisma,
  restaurarFetch,
  say,
  setModelDelay,
  skip as skipBase,
  telefono,
  BASE_LOCAL,
  type Tienda,
} from "./_wa-arnes";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ingestBarberEchoes, ingestBarberInbound, sendBarberManualMessage } from "../whatsapp";
import { barberWaTemplate } from "../whatsapp-core";
import { BARBER_WA_ACK_DEFAULT_TEXT, BARBER_WA_ACK_MARK } from "../wa-acuse-core";
import { getBarberWaAck, saveBarberWaAck } from "../wa-acuse";
import { saveBarberBotSettings } from "../bot";

const REMINDER = barberWaTemplate("reminder").name;

let tablaLista = false;
/** Por qué se salta (lo decide before(), ya con la base a la vista). */
let motivo: string | null = null;

before(async () => {
  if (!BASE_LOCAL) return;
  tablaLista = (await getBarberWaAck("no-existe")).storageReady;
  if (!tablaLista) motivo = "falta cargar sql/barber_wa_acuse.sql en la base local";
  // Llaves de mentira: el arnés contesta por Claude (nada sale a la red).
  process.env.BARBER_ANTHROPIC_API_KEY = "sk-prueba-guionada";
  delete process.env.BARBER_BOT_AI_MODEL;
  delete process.env.BARBER_BOT_AI_THINKING;
  instalarFetch();
});

after(async () => {
  restaurarFetch();
  if (BASE_LOCAL) await borrarTodo();
});

beforeEach(() => limpiar());

/** Una visita con su recordatorio ya ENTREGADO hace `haceMin` minutos. */
async function conRecordatorio(t: Tienda, phone: string, haceMin = 60) {
  const cliente = await crearCliente(t, phone);
  const cita = await crearCita(t, { phone, enMinutos: 20 * 60, status: "PENDING", clientId: cliente.id });
  await prisma.barberMessage.create({
    data: {
      barbershopId: t.id,
      direction: "OUTBOUND",
      phone,
      templateName: REMINDER,
      body: "Recordatorio de tu visita",
      status: "DELIVERED",
      appointmentId: cita.id,
      clientId: cliente.id,
      createdAt: new Date(Date.now() - haceMin * 60_000),
    },
  });
  return cita;
}

async function escribe(t: Tienda, phone: string, texto: string) {
  const { value, msg } = entrante(t, phone, texto);
  return ingestBarberInbound(value, msg);
}

/** Textos que de verdad le llegaron al cliente (Graph /messages). */
function textosEnviados(phone: string): string[] {
  return enviados()
    .filter((c) => String(c.body?.to ?? "").endsWith(phone))
    .map((c) => c.body?.text?.body ?? c.body?.interactive?.body?.text ?? `[${c.body?.type}]`);
}

async function acusesDe(t: Tienda, phone: string) {
  return prisma.barberMessage.findMany({
    where: { barbershopId: t.id, phone, templateName: BARBER_WA_ACK_MARK },
    orderBy: { createdAt: "asc" },
  });
}

async function encender(t: Tienda, message: string | null = null) {
  await saveBarberWaAck(t.id, { enabled: true, message });
}

test("APAGADO (el default): el cliente contesta al recordatorio con una frase y no sale nada", { skip: skipBase }, async (ctx) => {
  if (motivo) return void ctx.skip(motivo);
  const t = await crearTienda();
  const phone = telefono();
  await conRecordatorio(t, phone);
  await escribe(t, phone, "¿Puedo llegar 10 minutos tarde?");
  assert.deepEqual(textosEnviados(phone), []);
  assert.equal((await acusesDe(t, phone)).length, 0);
});

test("ENCENDIDO: sale el texto de fábrica UNA vez, queda en la bandeja y gasta del cupo", { skip: skipBase }, async (ctx) => {
  if (motivo) return void ctx.skip(motivo);
  const t = await crearTienda({ plan: "BASICO" });
  const phone = telefono();
  await conRecordatorio(t, phone);
  await encender(t);
  const antes = (await prisma.barbershop.findUniqueOrThrow({ where: { id: t.id } })).messagesUsedPeriod;

  await escribe(t, phone, "¿Puedo llegar 10 minutos tarde?");
  assert.deepEqual(textosEnviados(phone), [BARBER_WA_ACK_DEFAULT_TEXT]);
  const filas = await acusesDe(t, phone);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].status, "SENT");
  assert.equal(filas[0].body, BARBER_WA_ACK_DEFAULT_TEXT);
  const despues = (await prisma.barbershop.findUniqueOrThrow({ where: { id: t.id } })).messagesUsedPeriod;
  assert.equal(despues, antes + 1, "cuenta como un mensaje del cupo");

  // Segunda frase el mismo día: ya no.
  await escribe(t, phone, "Es que hay tráfico");
  assert.equal(textosEnviados(phone).length, 1);
  assert.equal((await acusesDe(t, phone)).length, 1);
});

test("el texto lo escribe la barbería", { skip: skipBase }, async (ctx) => {
  if (motivo) return void ctx.skip(motivo);
  const t = await crearTienda();
  const phone = telefono();
  await conRecordatorio(t, phone);
  await encender(t, "¡Te leímos! Ahorita te contesta Beto.");
  await escribe(t, phone, "oye una pregunta");
  assert.deepEqual(textosEnviados(phone), ["¡Te leímos! Ahorita te contesta Beto."]);
});

test("CONFIRMAR lo atiende el recordatorio (no hay acuse), y un CONFIRMAR DESPUÉS del acuse sigue confirmando", { skip: skipBase }, async (ctx) => {
  if (motivo) return void ctx.skip(motivo);
  const t = await crearTienda();
  await encender(t);

  const a = telefono();
  await conRecordatorio(t, a);
  await escribe(t, a, "CONFIRMAR");
  assert.equal((await acusesDe(t, a)).length, 0);
  assert.match(textosEnviados(a)[0] ?? "", /confirmada/);

  const b = telefono();
  const cita = await conRecordatorio(t, b);
  await escribe(t, b, "¿me pueden hacer también la barba?");
  assert.deepEqual(textosEnviados(b), [BARBER_WA_ACK_DEFAULT_TEXT]);
  await escribe(t, b, "confirmar");
  assert.equal((await prisma.barberAppointment.findUniqueOrThrow({ where: { id: cita.id } })).status, "CONFIRMED");
});

test("si alguien de la barbería ya contestó (panel o celular), no sale", { skip: skipBase }, async (ctx) => {
  if (motivo) return void ctx.skip(motivo);
  const t = await crearTienda();
  await encender(t);

  // Desde el panel: el cliente escribió antes (ventana abierta) y le contestaron.
  const a = telefono();
  await conRecordatorio(t, a, 120);
  await prisma.barberMessage.create({
    data: { barbershopId: t.id, direction: "INBOUND", phone: a, body: "hola", status: "DELIVERED", createdAt: new Date(Date.now() - 90 * 60_000) },
  });
  const manual = await sendBarberManualMessage({ barbershopId: t.id, phone: a, body: "¡Hola! ¿En qué te ayudo?" });
  assert.ok(manual.ok, JSON.stringify(manual));
  limpiar();
  await escribe(t, a, "quería saber si llevan tarjeta");
  assert.deepEqual(textosEnviados(a), []);

  // Desde el celular de la barbería (eco de coexistence).
  const b = telefono();
  await conRecordatorio(t, b, 120);
  const eco = ecoDelCelular(t, b, { texto: "Claro, aquí te esperamos" });
  await ingestBarberEchoes(eco.entry[0].changes[0].value);
  limpiar();
  await escribe(t, b, "¿y si llego antes?");
  assert.deepEqual(textosEnviados(b), []);
  assert.equal((await acusesDe(t, b)).length, 0);
});

test("sin recordatorio reciente no es «respuesta al recordatorio»", { skip: skipBase }, async (ctx) => {
  if (motivo) return void ctx.skip(motivo);
  const t = await crearTienda();
  await encender(t);

  const sinNada = telefono();
  await crearCliente(t, sinNada);
  await escribe(t, sinNada, "hola, ¿tienen lugar hoy?");
  assert.deepEqual(textosEnviados(sinNada), []);

  const viejo = telefono();
  await conRecordatorio(t, viejo, 49 * 60);
  await escribe(t, viejo, "hola otra vez");
  assert.deepEqual(textosEnviados(viejo), []);
});

test("sin cupo no sale", { skip: skipBase }, async (ctx) => {
  if (motivo) return void ctx.skip(motivo);
  const t = await crearTienda({ plan: "BASICO" });
  await encender(t);
  await prisma.barbershop.update({ where: { id: t.id }, data: { messagesUsedPeriod: 200, messagesPeriodStart: new Date() } });
  const phone = telefono();
  await conRecordatorio(t, phone);
  await escribe(t, phone, "¿Puedo llevar a mi hijo?");
  assert.deepEqual(textosEnviados(phone), []);
});

test("una nota de voz no es «una frase»: no sale", { skip: skipBase }, async (ctx) => {
  if (motivo) return void ctx.skip(motivo);
  const t = await crearTienda();
  await encender(t);
  const phone = telefono();
  await conRecordatorio(t, phone);
  const { value, msg } = entranteVoz(t, phone);
  await ingestBarberInbound(value, msg);
  assert.equal((await acusesDe(t, phone)).length, 0);
});

test("si el BOT contestó, no sale el acuse (no se habla encima)", { skip: skipBase }, async (ctx) => {
  if (motivo) return void ctx.skip(motivo);
  const t = await crearTienda(); // Profesional: trae el bot
  await encender(t);
  await saveBarberBotSettings(t.id, { enabled: true, aiDailyCapMxn: 50, hours: { mode: "always" } });
  const phone = telefono();
  await conRecordatorio(t, phone);
  modelQueue.push(say("¡Claro! Te esperamos 10 minutos."));
  await escribe(t, phone, "¿Puedo llegar 10 minutos tarde?");
  assert.deepEqual(textosEnviados(phone), ["¡Claro! Te esperamos 10 minutos."]);
  assert.equal((await acusesDe(t, phone)).length, 0);
});

test("bot pensando y llega OTRA frase: ese turno lo cede al bot y tampoco sale el acuse", { skip: skipBase }, async (ctx) => {
  if (motivo) return void ctx.skip(motivo);
  const t = await crearTienda();
  await encender(t);
  await saveBarberBotSettings(t.id, { enabled: true, aiDailyCapMxn: 50, hours: { mode: "always" } });
  const phone = telefono();
  await conRecordatorio(t, phone);
  modelQueue.push(say("¡Claro! Te esperamos."));
  setModelDelay(1500);
  try {
    const m1 = entrante(t, phone, "¿Puedo llegar 10 minutos tarde?");
    const p1 = ingestBarberInbound(m1.value, m1.msg);
    // El segundo llega mientras el bot todavía está pensando el primero.
    await new Promise((r) => setTimeout(r, 400));
    const m2 = entrante(t, phone, "es que hay tráfico");
    await Promise.all([p1, ingestBarberInbound(m2.value, m2.msg)]);
  } finally {
    setModelDelay(0);
  }
  assert.equal((await acusesDe(t, phone)).length, 0, textosEnviados(phone).join(" | "));
  assert.ok(textosEnviados(phone).every((x) => x !== BARBER_WA_ACK_DEFAULT_TEXT));
});

test("bot encendido pero SIN poder contestar (sin llave de IA): el cliente sí recibe el acuse", { skip: skipBase }, async (ctx) => {
  if (motivo) return void ctx.skip(motivo);
  const t = await crearTienda();
  await encender(t);
  await saveBarberBotSettings(t.id, { enabled: true, aiDailyCapMxn: 50, hours: { mode: "always" } });
  const phone = telefono();
  await conRecordatorio(t, phone);
  const llave = process.env.BARBER_ANTHROPIC_API_KEY;
  delete process.env.BARBER_ANTHROPIC_API_KEY;
  try {
    await escribe(t, phone, "¿Puedo llegar 10 minutos tarde?");
  } finally {
    process.env.BARBER_ANTHROPIC_API_KEY = llave;
  }
  assert.deepEqual(textosEnviados(phone), [BARBER_WA_ACK_DEFAULT_TEXT]);
});

test("dos frases A LA VEZ: un solo acuse", { skip: skipBase }, async (ctx) => {
  if (motivo) return void ctx.skip(motivo);
  const t = await crearTienda();
  await encender(t);
  const phone = telefono();
  await conRecordatorio(t, phone);
  const m1 = entrante(t, phone, "hola");
  const m2 = entrante(t, phone, "una pregunta");
  const m3 = entrante(t, phone, "¿están abiertos?");
  await Promise.all([m1, m2, m3].map((m) => ingestBarberInbound(m.value, m.msg)));
  assert.equal((await acusesDe(t, phone)).length, 1);
  assert.equal(textosEnviados(phone).length, 1);
});

test("el acuse sale en la bandeja como un mensaje normal, no como «plantilla»", { skip: skipBase }, async (ctx) => {
  if (motivo) return void ctx.skip(motivo);
  const t = await crearTienda();
  await encender(t);
  const phone = telefono();
  await conRecordatorio(t, phone);
  await escribe(t, phone, "una duda");
  const { listBarberThreadMessages } = await import("../whatsapp");
  const hilo = (await listBarberThreadMessages(t.id, phone)).messages;
  const acuse = hilo.find((m: any) => m.body === BARBER_WA_ACK_DEFAULT_TEXT) as any;
  assert.ok(acuse, "el acuse está en la bandeja");
  assert.equal(acuse.templateName, null);
  assert.equal(acuse.direction, "OUTBOUND");
  void mensajes;
});
