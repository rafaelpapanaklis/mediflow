// ═══════════════════════════════════════════════════════════════════════
// Un token de WhatsApp que NO se puede descifrar no tumba nada.
//
// 15-nov-2026: en panel.108 /barber/whatsapp reventó entera («No se pudo
// mostrar esta pantalla») porque la barbería de prueba tenía un token
// cifrado con la llave de PRODUCCIÓN y panel.108 tiene otra
// DATA_ENCRYPTION_KEY: decryptField lanza «Unsupported state or unable to
// authenticate data». Aquí se reproduce igual: se cifra con la llave A y se
// lee con la llave B.
//
// 🔴 Solo con DATABASE_URL local (crea y borra barberías).
//   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=$DATABASE_URL \
//     npx tsx --test src/lib/barber/__tests__/wa-token-ilegible-integration.test.ts
// ═══════════════════════════════════════════════════════════════════════
import {
  borrarTodo,
  crearCita,
  crearCliente,
  crearTienda,
  enviados,
  entrante,
  graph,
  instalarFetch,
  limpiar,
  prisma,
  restaurarFetch,
  skip,
  telefono,
  BASE_LOCAL,
  type Tienda,
} from "./_wa-arnes";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { encryptField } from "@/lib/crypto/envelope";
import {
  drainBarberOutbox,
  getBarberWaConnection,
  getBarberWaQuota,
  ingestBarberInbound,
  listBarberTemplates,
  provisionBarberTemplates,
  readBarberWaSecret,
  resolveSenderCredentials,
  runBarberWaDispatch,
  scheduleBarberReminders,
  sendBarberManualMessage,
  sendBarberPortalCode,
} from "../whatsapp";
import { barberiaTieneWhatsApp } from "../wa-conectado";
import { getBarberBotPanelState, saveBarberBotSettings } from "../bot";

const LLAVE_PROD = "a".repeat(64);
const LLAVE_108 = "b".repeat(64);
const llaveAntes = process.env.DATA_ENCRYPTION_KEY;

let T: Tienda;
const errores: string[] = [];
const errorReal = console.error;

before(async () => {
  if (!BASE_LOCAL) return;
  instalarFetch();
  T = await crearTienda();
  // El token se cifró en PRODUCCIÓN…
  process.env.DATA_ENCRYPTION_KEY = LLAVE_PROD;
  await prisma.barbershop.update({ where: { id: T.id }, data: { whatsappToken: encryptField("token-real-de-meta") } });
  await saveBarberBotSettings(T.id, { enabled: true, aiDailyCapMxn: 50, hours: { mode: "always" } });
  // …y se lee en panel.108, con OTRA llave.
  process.env.DATA_ENCRYPTION_KEY = LLAVE_108;
  console.error = (...a: unknown[]) => void errores.push(a.map(String).join(" "));
});

after(async () => {
  console.error = errorReal;
  if (llaveAntes === undefined) delete process.env.DATA_ENCRYPTION_KEY;
  else process.env.DATA_ENCRYPTION_KEY = llaveAntes;
  restaurarFetch();
  if (BASE_LOCAL) await borrarTodo();
});

beforeEach(() => limpiar());

const fila = async () => (await prisma.barbershop.findUniqueOrThrow({ where: { id: T.id } })) as any;

test("descifrar con la llave equivocada NO lanza: «sin credenciales», y el log lo dice sin el token", { skip }, async () => {
  const row = await fila();
  assert.equal(resolveSenderCredentials(row), null);
  assert.deepEqual(readBarberWaSecret(row.whatsappToken, `prueba-${T.id}`), { ok: false });
  const linea = errores.find((e) => e.includes("no se pudo descifrar el token de WhatsApp"));
  assert.ok(linea, errores.join("\n"));
  assert.doesNotMatch(linea!, /token-real-de-meta/);
  assert.doesNotMatch(linea!, /v1:/);
});

test("la pantalla: conexión en «hay que volver a conectar», con su aviso, y sin preguntarle a Meta", { skip }, async () => {
  const c = await getBarberWaConnection(T.id);
  assert.equal(c.state, "ERROR");
  assert.equal(c.problemCode, "TOKEN_UNREADABLE");
  assert.match(String(c.problem), /Vuelve a conectar/);
  assert.equal(graph.length, 0, "sin token no hay a quién preguntar");
  // El resto de lo que pinta la página también responde.
  const q = await getBarberWaQuota(T.id);
  assert.ok(typeof q.used === "number");
  const tpl = await listBarberTemplates(T.id);
  assert.equal(tpl.ok, false);
  assert.match(String(tpl.reason), /Vuelve a conectar/);
  assert.ok(tpl.templates.length > 0 && tpl.templates.every((x) => x.status === "MISSING"));
  const alta = await provisionBarberTemplates(T.id);
  assert.equal(alta.ok, false);
  const bot = await getBarberBotPanelState(T.id, "America/Mexico_City");
  assert.ok(bot, "la pantalla del bot se pinta");
});

test("envío, despacho del cron, recordatorios y código de «mi cuenta»: siguen sin tronar y no mandan nada", { skip }, async () => {
  const phone = telefono();
  const cli = await crearCliente(T, phone);
  await crearCita(T, { phone, enMinutos: 20 * 60, clientId: cli.id, status: "CONFIRMED" });
  await prisma.barberMessage.create({
    data: { barbershopId: T.id, direction: "OUTBOUND", phone, body: "aviso", status: "PENDING", templateName: null },
  });

  assert.deepEqual(await drainBarberOutbox(T.id), { sent: 0, failed: 0, skipped: 0 });
  assert.equal(
    await prisma.barberMessage.count({ where: { barbershopId: T.id, phone, status: "PENDING" } }) >= 1,
    true,
    "lo pendiente se queda esperando a que se vuelva a conectar",
  );
  const r = await runBarberWaDispatch(T.id);
  assert.equal(typeof r.shops, "number");
  assert.deepEqual(await scheduleBarberReminders(T.id), { queued: 0 });
  const manual = await sendBarberManualMessage({ barbershopId: T.id, phone, body: "hola" });
  assert.equal(manual.ok, false);
  assert.equal(await sendBarberPortalCode({ barbershopId: T.id, phone, code: "123456" }), false);
  assert.equal(enviados().length, 0);
});

test("un mensaje entrante se guarda (ni la ingesta ni el bot truenan)", { skip }, async () => {
  const phone = telefono();
  const { value, msg } = entrante(T, phone, "hola, ¿tienen lugar?");
  assert.equal(await ingestBarberInbound(value, msg), true);
  assert.equal(await prisma.barberMessage.count({ where: { barbershopId: T.id, phone, direction: "INBOUND" } }), 1);
  assert.equal(enviados().length, 0);
});

test("la reserva no promete WhatsApp con un token que no se puede leer", { skip }, async () => {
  assert.equal(await barberiaTieneWhatsApp(T.id), false);
});

test("contraprueba: con la llave correcta todo vuelve a la normalidad", { skip }, async () => {
  process.env.DATA_ENCRYPTION_KEY = LLAVE_PROD;
  try {
    const creds = resolveSenderCredentials(await fila());
    assert.equal(creds?.accessToken, "token-real-de-meta");
    assert.equal(await barberiaTieneWhatsApp(T.id), true);
    const c = await getBarberWaConnection(T.id);
    assert.notEqual(c.problemCode, "TOKEN_UNREADABLE");
  } finally {
    process.env.DATA_ENCRYPTION_KEY = LLAVE_108;
  }
});

test("el log no se llena: como mucho una línea cada 10 min por barbería", { skip }, async () => {
  const antes = errores.filter((e) => e.includes(`(${T.id})`) && e.includes("no se pudo descifrar")).length;
  for (let i = 0; i < 20; i++) resolveSenderCredentials(await fila());
  const despues = errores.filter((e) => e.includes(`(${T.id})`) && e.includes("no se pudo descifrar")).length;
  assert.equal(despues, antes);
  assert.ok(antes <= 1);
});
