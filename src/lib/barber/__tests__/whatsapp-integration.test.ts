// Integración del WhatsApp de barber contra Postgres REAL.
//
// WhatsApp de barber se construyó en tres días y nunca se había usado: cero
// barberías conectadas, cero filas en barber_messages. Estas pruebas hacen
// lo que no se había hecho — pasar mensajes de verdad por TODO el camino
// (webhook → bandeja → recordatorio → cola → Meta) — con lo único que no se
// puede tener aquí simulado: Meta. Ver _wa-arnes.ts.
import {
  borrarTodo,
  crearCita,
  crearCliente,
  crearTienda,
  entrante,
  enviados,
  graph,
  graphDelay,
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
import {
  applyBarberDeliveryStatuses,
  barberWabaOwnsPhone,
  drainBarberOutbox,
  getBarberWaConnection,
  ingestBarberInbound,
  listBarberThreadMessages,
  notifyBarberWalkIn,
  runBarberWaDispatch,
  scheduleBarberReminders,
  sendBarberCampaign,
  sendBarberManualMessage,
} from "../whatsapp";
import {
  BARBER_WA_CLAIM_LOST_MESSAGE,
  BARBER_WA_OPT_OUT_REPLY,
  barberClientOptedOut,
  barberWaClaimMark,
  barberWaTemplate,
} from "../whatsapp-core";
import { BARBER_WALKIN_NOTIFY_TEMPLATE, isInvalidatedReminder, walkInNotifyBody } from "../agenda";

const REMINDER = barberWaTemplate("reminder").name;

let A: Tienda;
let B: Tienda;

before(async () => {
  if (!BASE_LOCAL) return;
  instalarFetch();
  A = await crearTienda({ name: "Barbería El Corte" });
  B = await crearTienda({ name: "Otra Barbería" });
});

after(async () => {
  restaurarFetch();
  if (!BASE_LOCAL) return;
  await borrarTodo();
});

beforeEach(() => limpiar());

/** Deja la cola de A vacía para que una prueba no vea filas de la anterior. */
async function vaciarCola(t: Tienda) {
  await prisma.barberMessage.deleteMany({ where: { barbershopId: t.id } });
  await prisma.barberAppointmentService.deleteMany({ where: { appointment: { barbershopId: t.id } } });
  await prisma.barberAppointment.deleteMany({ where: { barbershopId: t.id } });
}

/* ═══════════════ Recordatorios: programar ═══════════════ */

test("programa UN recordatorio por visita y fuera de la ventana sale como plantilla", { skip }, async () => {
  await vaciarCola(A);
  const phone = telefono();
  const cita = await crearCita(A, { phone, enMinutos: 5 * 60, conBarbero: true });
  // Fuera del rango: en 10 minutos (muy pronto) y en 3 días (muy lejos).
  await crearCita(A, { phone: telefono(), enMinutos: 10 });
  await crearCita(A, { phone: telefono(), enMinutos: 3 * 24 * 60 });

  assert.deepEqual(await scheduleBarberReminders(A.id), { queued: 1 });
  // Volver a correr no programa otro.
  assert.deepEqual(await scheduleBarberReminders(A.id), { queued: 0 });

  const drenado = await drainBarberOutbox(A.id);
  assert.deepEqual(drenado, { sent: 1, failed: 0, skipped: 0 });

  const [envio] = enviados();
  assert.equal(envio.body.type, "template", "el cliente no ha escrito: solo cabe la plantilla");
  assert.equal(envio.body.to, `52${phone}`, "sale al número con lada de México");
  assert.equal(envio.body.template.name, REMINDER);
  assert.equal(envio.body.template.language.code, "es_MX");
  const params = envio.body.template.components[0].parameters.map((p: any) => p.text);
  assert.equal(params.length, 6, "las seis variables que tiene la plantilla aprobada");
  assert.equal(params[0], "Luis");
  assert.equal(params[1], "Barbería El Corte");
  assert.equal(params[3], "Corte de caballero");
  assert.equal(params[4], "Beto");

  const [fila] = await mensajes(A, phone);
  assert.equal(fila.status, "SENT");
  assert.ok(fila.waMessageId?.startsWith("wamid.OUT"), "se guarda el id de Meta para los estados");
  assert.equal(fila.errorMessage, null, "la marca de reclamo se limpia al salir");
  assert.equal(fila.appointmentId, cita.id);
});

test("🔴 dos pasadas del cron A LA VEZ: un solo recordatorio programado y un solo envío", { skip }, async () => {
  await vaciarCola(A);
  const phones = [telefono(), telefono(), telefono(), telefono()];
  for (const phone of phones) await crearCita(A, { phone, enMinutos: 6 * 60 });

  // Programar encimado. La carrera real dura milisegundos, así que aquí se
  // FUERZA: mientras dura este candado de tabla (deja leer, no deja
  // insertar) todas las pasadas alcanzan a leer "no tiene recordatorio"
  // antes de que ninguna pueda escribir. Sin el candado por barbería, al
  // soltarlo insertan TODAS y cada visita queda con cuatro recordatorios
  // (comprobado quitándolo). Con él, solo una pasa a la vez.
  const barrera = prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`LOCK TABLE "barber_messages" IN SHARE MODE`);
      await new Promise((r) => setTimeout(r, 500));
    },
    { timeout: 10_000 },
  );
  await new Promise((r) => setTimeout(r, 80));
  const programadas = await Promise.all(
    Array.from({ length: 4 }, () => scheduleBarberReminders(A.id)),
  );
  await barrera;
  assert.equal(
    programadas.reduce((n, r) => n + r.queued, 0),
    phones.length,
    "entre las cuatro pasadas se programó UNO por visita",
  );
  assert.equal(
    await prisma.barberMessage.count({ where: { barbershopId: A.id, templateName: REMINDER } }),
    phones.length,
  );

  // Drenar encimado: cada envío tarda, así que las pasadas se pisan de verdad.
  graphDelay(60);
  const drenados = await Promise.all([
    drainBarberOutbox(A.id),
    drainBarberOutbox(A.id),
    drainBarberOutbox(A.id),
  ]);
  assert.equal(
    drenados.reduce((n, r) => n + r.sent, 0),
    phones.length,
    "cada recordatorio lo mandó UNA sola pasada",
  );
  assert.equal(enviados().length, phones.length, "Meta recibió exactamente uno por cliente");
  const destinos = enviados().map((c) => c.body.to).sort();
  assert.deepEqual(destinos, phones.map((p) => `52${p}`).sort(), "ninguno repetido");
});

test("🔴 una dirección en dos renglones ya no tumba el recordatorio (132018)", { skip }, async () => {
  const T = await crearTienda({ address: "Av. Juárez 120\n  Local 4\t(planta alta)" });
  const phone = telefono();
  await crearCita(T, { phone, enMinutos: 5 * 60 });
  await scheduleBarberReminders(T.id);
  await drainBarberOutbox(T.id);

  const params = enviados()[0].body.template.components[0].parameters.map((p: any) => p.text);
  for (const p of params) {
    assert.ok(!/[\n\r\t]/.test(p), `el parámetro «${p}» no lleva saltos ni tabulaciones`);
    assert.ok(!/ {2,}/.test(p), `el parámetro «${p}» no lleva espacios dobles`);
    assert.ok(p.length > 0, "ningún parámetro va vacío");
  }
  assert.equal(params[5], "Av. Juárez 120 Local 4 (planta alta), Centro");
});

test("con la ventana de 24 h abierta el recordatorio sale como TEXTO (gratis)", { skip }, async () => {
  await vaciarCola(A);
  const phone = telefono();
  await crearCita(A, { phone, enMinutos: 5 * 60 });
  // El cliente escribió hace un rato: ventana abierta.
  await prisma.barberMessage.create({
    data: { barbershopId: A.id, direction: "INBOUND", phone, body: "hola", status: "DELIVERED" },
  });
  await scheduleBarberReminders(A.id);
  await drainBarberOutbox(A.id);

  const [envio] = enviados();
  assert.equal(envio.body.type, "text");
  assert.match(envio.body.text.body, /te recordamos tu visita en Barbería El Corte/);
  assert.match(envio.body.text.body, /CONFIRMAR/);
});

/* ═══════════════ Recordatorios: lo que NO debe salir ═══════════════ */

test("🔴 un recordatorio que se quedó en cola y la visita ya pasó NO se manda", { skip }, async () => {
  await vaciarCola(A);
  const phone = telefono();
  const pasada = await crearCita(A, { phone, enMinutos: -90 });
  const cancelada = await crearCita(A, { phone: telefono(), enMinutos: 4 * 60, status: "CANCELLED" });
  for (const cita of [pasada, cancelada]) {
    await prisma.barberMessage.create({
      data: {
        barbershopId: A.id,
        direction: "OUTBOUND",
        phone: cita.clientPhone!,
        body: "Hola Luis, te recordamos tu visita…",
        templateName: REMINDER,
        status: "PENDING",
        appointmentId: cita.id,
      },
    });
  }

  const drenado = await drainBarberOutbox(A.id);
  assert.equal(drenado.sent, 0);
  assert.equal(enviados().length, 0, "a Meta no llegó nada");

  const filas = await prisma.barberMessage.findMany({
    where: { barbershopId: A.id, templateName: REMINDER },
  });
  for (const f of filas) {
    assert.equal(f.status, "FAILED");
    assert.ok(isInvalidatedReminder(f.errorMessage), "queda con la marca de invalidado, no como rechazo de Meta");
  }
  // …y la bandeja no lo enseña como un error.
  const hilo = await listBarberThreadMessages(A.id, phone);
  assert.equal(hilo.messages[0].error, null);
});

test("un envío que se interrumpió a la mitad NO se reintenta (no-duplicar pesa más)", { skip }, async () => {
  await vaciarCola(A);
  const phone = telefono();
  const cita = await crearCita(A, { phone, enMinutos: 5 * 60 });
  const base = {
    barbershopId: A.id,
    direction: "OUTBOUND" as const,
    phone,
    body: "…",
    templateName: REMINDER,
    status: "PENDING" as const,
    appointmentId: cita.id,
  };
  // Una fila reclamada hace 20 minutos (el proceso murió) y otra recién
  // reclamada (otra pasada la está mandando ahora mismo).
  const vieja = await prisma.barberMessage.create({
    data: { ...base, errorMessage: barberWaClaimMark(new Date(Date.now() - 20 * 60_000)) },
  });
  const viva = await prisma.barberMessage.create({
    data: { ...base, errorMessage: barberWaClaimMark() },
  });

  const drenado = await drainBarberOutbox(A.id);
  assert.equal(enviados().length, 0, "ninguna de las dos se manda");
  assert.equal(drenado.failed, 1);

  const v = await prisma.barberMessage.findUniqueOrThrow({ where: { id: vieja.id } });
  assert.equal(v.status, "FAILED");
  assert.equal(v.errorMessage, BARBER_WA_CLAIM_LOST_MESSAGE);
  const w = await prisma.barberMessage.findUniqueOrThrow({ where: { id: viva.id } });
  assert.equal(w.status, "PENDING", "la que está saliendo en otra pasada no se toca");
});

test("Meta rechaza la plantilla: la fila queda FAILED con el motivo REAL y no se reprograma", { skip }, async () => {
  await vaciarCola(A);
  const phone = telefono();
  await crearCita(A, { phone, enMinutos: 5 * 60 });
  await scheduleBarberReminders(A.id);

  onGraph((call) =>
    call.url.includes("/messages")
      ? {
          status: 400,
          json: { error: { code: 132001, message: "(#132001) Template name does not exist in the translation" } },
        }
      : null,
  );
  const drenado = await drainBarberOutbox(A.id);
  assert.deepEqual(drenado, { sent: 0, failed: 1, skipped: 0 });

  const [fila] = await mensajes(A, phone);
  assert.equal(fila.status, "FAILED");
  assert.match(fila.errorMessage ?? "", /#132001/);

  // Un fallo REAL de Meta no se reintenta cada pocos minutos.
  onGraph(null);
  assert.deepEqual(await scheduleBarberReminders(A.id), { queued: 0 });
});

test("sin cupo no sale nada y la cola espera; el despacho con el tiempo agotado se corta", { skip }, async () => {
  const T = await crearTienda({ plan: "BASICO" });
  const phone = telefono();
  await crearCita(T, { phone, enMinutos: 5 * 60 });
  await scheduleBarberReminders(T.id);

  // El plan Básico trae 200 mensajes: se dejan gastados.
  await prisma.barbershop.update({
    where: { id: T.id },
    data: { messagesUsedPeriod: 200, messagesPeriodStart: new Date() },
  });
  assert.deepEqual(await drainBarberOutbox(T.id), { sent: 0, failed: 0, skipped: 1 });
  assert.equal(enviados().length, 0);
  assert.equal((await mensajes(T, phone))[0].status, "PENDING", "no se falla: espera al periodo nuevo");

  // Con cupo otra vez, pero sin tiempo: la pasada avisa que quedó a medias.
  await prisma.barbershop.update({ where: { id: T.id }, data: { messagesUsedPeriod: 0 } });
  const corto = await runBarberWaDispatch(T.id, { budgetMs: 0 });
  assert.equal(corto.partial, true);
  assert.equal(corto.sent, 0);

  const completo = await runBarberWaDispatch(T.id);
  assert.equal(completo.partial, false);
  assert.equal(completo.sent, 1);
  const shop = await prisma.barbershop.findUniqueOrThrow({ where: { id: T.id } });
  assert.equal(shop.messagesUsedPeriod, 1, "el cupo cuenta lo que salió");
});

/* ═══════════════ El webhook: lo que contesta el cliente ═══════════════ */

/** Una visita con su recordatorio ya enviado. */
async function visitaRecordada(t: Tienda, phone: string, enMinutos = 5 * 60) {
  const cita = await crearCita(t, { phone, enMinutos });
  await prisma.barberMessage.create({
    data: {
      barbershopId: t.id,
      direction: "OUTBOUND",
      phone,
      body: "Hola Luis, te recordamos tu visita…",
      templateName: REMINDER,
      status: "DELIVERED",
      waMessageId: `wamid.REC.${cita.id}`,
      appointmentId: cita.id,
    },
  });
  return cita;
}

test("el cliente responde CONFIRMAR: la visita se confirma y se le contesta", { skip }, async () => {
  const phone = telefono();
  const cita = await visitaRecordada(A, phone);
  const { value, msg } = entrante(A, phone, "Confirmar");

  assert.equal(await ingestBarberInbound(value, msg), true);

  const despues = await prisma.barberAppointment.findUniqueOrThrow({ where: { id: cita.id } });
  assert.equal(despues.status, "CONFIRMED");
  const [respuesta] = enviados();
  assert.equal(respuesta.body.type, "text");
  assert.match(respuesta.body.text.body, /está confirmada/);
  // Palomitas azules: se marcó como leído el mensaje del cliente.
  assert.ok(graph.some((c) => c.body?.status === "read" && c.body?.message_id === msg.id));
});

test("el cliente responde CANCELAR: se cancela y sus recordatorios en cola se invalidan", { skip }, async () => {
  const phone = telefono();
  const cita = await visitaRecordada(A, phone);
  const enCola = await prisma.barberMessage.create({
    data: {
      barbershopId: A.id,
      direction: "OUTBOUND",
      phone,
      body: "…",
      templateName: barberWaTemplate("bookingConfirmed").name,
      status: "PENDING",
      appointmentId: cita.id,
    },
  });
  const { value, msg } = entrante(A, phone, "no voy a poder, cancela");
  await ingestBarberInbound(value, msg);

  const despues = await prisma.barberAppointment.findUniqueOrThrow({ where: { id: cita.id } });
  assert.equal(despues.status, "CANCELLED");
  const fila = await prisma.barberMessage.findUniqueOrThrow({ where: { id: enCola.id } });
  assert.equal(fila.status, "FAILED");
  assert.ok(isInvalidatedReminder(fila.errorMessage));
  assert.match(enviados()[0].body.text.body, /quedó cancelada/);
});

test("🔴 un «sí» suelto solo confirma si el recordatorio fue lo último que dijimos", { skip }, async () => {
  // Caso 1: recordatorio → "sí". Confirma.
  const p1 = telefono();
  const c1 = await visitaRecordada(A, p1);
  let m = entrante(A, p1, "Sí");
  await ingestBarberInbound(m.value, m.msg);
  assert.equal(
    (await prisma.barberAppointment.findUniqueOrThrow({ where: { id: c1.id } })).status,
    "CONFIRMED",
  );

  // Caso 2: recordatorio → después ya hubo conversación (alguien le preguntó
  // otra cosa) → "sí". NO es para el recordatorio: la visita no se toca.
  limpiar();
  const p2 = telefono();
  const c2 = await visitaRecordada(A, p2);
  await prisma.barberMessage.create({
    data: {
      barbershopId: A.id,
      direction: "OUTBOUND",
      phone: p2,
      body: "¿Te agendo también la barba el viernes a las 5?",
      status: "SENT",
    },
  });
  m = entrante(A, p2, "si");
  await ingestBarberInbound(m.value, m.msg);
  assert.equal(
    (await prisma.barberAppointment.findUniqueOrThrow({ where: { id: c2.id } })).status,
    "PENDING",
    "el «sí» era para la otra pregunta",
  );
  assert.equal(enviados().length, 0, "no se le contesta «tu visita está confirmada»");

  // …pero la palabra explícita vale siempre.
  m = entrante(A, p2, "CONFIRMAR");
  await ingestBarberInbound(m.value, m.msg);
  assert.equal(
    (await prisma.barberAppointment.findUniqueOrThrow({ where: { id: c2.id } })).status,
    "CONFIRMED",
  );
});

test("un teléfono compartido con dos visitas por confirmar: no se adivina", { skip }, async () => {
  const phone = telefono();
  const c1 = await visitaRecordada(A, phone, 4 * 60);
  const c2 = await visitaRecordada(A, phone, 6 * 60);
  const { value, msg } = entrante(A, phone, "confirmar");
  await ingestBarberInbound(value, msg);

  for (const c of [c1, c2]) {
    assert.equal(
      (await prisma.barberAppointment.findUniqueOrThrow({ where: { id: c.id } })).status,
      "PENDING",
    );
  }
  assert.match(enviados()[0].body.text.body, /más de una visita por confirmar/);
});

test("🔴 Meta reintenta el MISMO mensaje tres veces a la vez: una fila y una respuesta", { skip }, async () => {
  const phone = telefono();
  await visitaRecordada(A, phone);
  const { value, msg } = entrante(A, phone, "confirmar", `wamid.DUP.${phone}`);

  graphDelay(40);
  await Promise.all([
    ingestBarberInbound(value, msg),
    ingestBarberInbound(value, msg),
    ingestBarberInbound(value, msg),
  ]);

  const entrantes = (await mensajes(A, phone)).filter((r) => r.direction === "INBOUND");
  assert.equal(entrantes.length, 1, "el mensaje del cliente se guardó una sola vez");
  assert.equal(enviados().length, 1, "y se le contestó una sola vez");
});

test("un número que no es de ninguna barbería no se toma; y una barbería no ve lo de otra", { skip }, async () => {
  const phone = telefono();
  assert.equal(
    await ingestBarberInbound(
      { metadata: { phone_number_id: "numero-de-nadie" } },
      { from: `521${phone}`, id: "wamid.X", type: "text", text: { body: "hola" } },
    ),
    false,
  );
  assert.equal(await ingestBarberInbound({ metadata: {} }, { from: `521${phone}`, type: "text" }), false);

  // El mismo cliente le escribe a B: A no se entera.
  const citaEnA = await visitaRecordada(A, phone);
  const { value, msg } = entrante(B, phone, "cancelar");
  await ingestBarberInbound(value, msg);
  assert.equal(
    (await prisma.barberAppointment.findUniqueOrThrow({ where: { id: citaEnA.id } })).status,
    "PENDING",
    "cancelar en B no toca la visita de A",
  );
  assert.equal((await mensajes(B, phone)).filter((r) => r.direction === "INBOUND").length, 1);
  assert.equal((await mensajes(A, phone)).filter((r) => r.direction === "INBOUND").length, 0);
});

/* ═══════════════ Baja de promociones ═══════════════ */

test("🔴 el cliente responde BAJA: queda dado de baja y la campaña ya no le llega", { skip }, async () => {
  const phone = telefono();
  const cliente = await crearCliente(A, phone, "Memo Ruiz");
  const otro = await crearCliente(A, telefono(), "Paco Díaz");

  const { value, msg } = entrante(A, phone, "BAJA");
  await ingestBarberInbound(value, msg);
  assert.equal(enviados()[0].body.text.body, BARBER_WA_OPT_OUT_REPLY);
  const ficha = await prisma.barberClient.findUniqueOrThrow({ where: { id: cliente.id } });
  assert.equal(barberClientOptedOut(ficha.preferences), true);

  // La pantalla vieja de campañas manda los ids que le llegan: el emisor es
  // quien tiene que respetar la baja.
  limpiar();
  const r = await sendBarberCampaign({
    barbershopId: A.id,
    kind: "winback",
    promo: "Esta semana\ntu corte lleva barba de cortesía.",
    clientIds: [cliente.id, otro.id],
  });
  assert.equal(r.sent, 1);
  const [envio] = enviados();
  assert.equal(envio.body.to, `52${otro.phone}`, "solo le llega al que NO pidió la baja");
  assert.equal(envio.body.template.name, "dc_barber_te_extranamos");
  const params = envio.body.template.components[0].parameters.map((p: any) => p.text);
  assert.equal(params[2], "Esta semana tu corte lleva barba de cortesía.", "la promoción sale sin saltos de línea");
});

test("«baja» dentro de una frase normal no da de baja a nadie", { skip }, async () => {
  const phone = telefono();
  const cliente = await crearCliente(A, phone, "Toño");
  const { value, msg } = entrante(A, phone, "oye, ¿a qué hora baja la cortina hoy?");
  await ingestBarberInbound(value, msg);
  const ficha = await prisma.barberClient.findUniqueOrThrow({ where: { id: cliente.id } });
  assert.equal(barberClientOptedOut(ficha.preferences), false);
});

/* ═══════════════ Estados de entrega ═══════════════ */

test("los estados de Meta se aplican en orden y un rechazo NUNCA se pinta como entregado", { skip }, async () => {
  const phone = telefono();
  const base = { barbershopId: A.id, direction: "OUTBOUND" as const, phone, body: "…" };
  const ok = await prisma.barberMessage.create({ data: { ...base, status: "SENT", waMessageId: `w.ok.${phone}` } });
  const mal = await prisma.barberMessage.create({ data: { ...base, status: "SENT", waMessageId: `w.mal.${phone}` } });

  assert.equal(
    await applyBarberDeliveryStatuses(A.phoneNumberId, [
      { id: ok.waMessageId, status: "read" },
      { id: ok.waMessageId, status: "delivered" }, // llega tarde: no retrocede
      {
        id: mal.waMessageId,
        status: "failed",
        errors: [{ code: 131026, title: "Message undeliverable" }],
      },
      { id: mal.waMessageId, status: "delivered" }, // tarde: no pisa el fallo
      { id: "wamid.de.otra.cosa", status: "delivered" },
    ]),
    true,
  );
  assert.equal((await prisma.barberMessage.findUniqueOrThrow({ where: { id: ok.id } })).status, "READ");
  const fallo = await prisma.barberMessage.findUniqueOrThrow({ where: { id: mal.id } });
  assert.equal(fallo.status, "FAILED");
  assert.equal(fallo.errorMessage, "(#131026) Message undeliverable");

  // El estado de B no puede tocar una fila de A aunque traiga su wamid.
  await applyBarberDeliveryStatuses(B.phoneNumberId, [{ id: ok.waMessageId, status: "failed" }]);
  assert.equal((await prisma.barberMessage.findUniqueOrThrow({ where: { id: ok.id } })).status, "READ");
  assert.equal(await applyBarberDeliveryStatuses("numero-de-nadie", []), false);
});

/* ═══════════════ Bandeja ═══════════════ */

test("responder a mano: dentro de la ventana sale; fuera, se dice por qué no", { skip }, async () => {
  const phone = telefono();
  const cerrado = await sendBarberManualMessage({ barbershopId: A.id, phone, body: "Hola" });
  assert.equal(cerrado.ok, false);
  assert.equal((cerrado as any).code, "WINDOW_CLOSED");
  assert.equal(enviados().length, 0, "no se manda un texto que Meta va a rechazar");

  const { value, msg } = entrante(A, phone, "¿tienen lugar hoy?");
  await ingestBarberInbound(value, msg);
  limpiar();

  const abierto = await sendBarberManualMessage({ barbershopId: A.id, phone, body: "Sí, a las 5." });
  assert.equal(abierto.ok, true);
  assert.equal(enviados()[0].body.text.body, "Sí, a las 5.");
  const hilo = await listBarberThreadMessages(A.id, phone);
  const ultima = hilo.messages[hilo.messages.length - 1];
  assert.equal(ultima.status, "SENT");
  assert.equal(ultima.error, null, "la marca de reclamo no se enseña como error");
});

/* ═══════════════ Conexión ═══════════════ */

test("🔴 la pantalla delata una conexión que manda pero NO recibe, y la repara sola", { skip }, async () => {
  process.env.META_APP_ID = "app-dalecontrol";
  let suscritas: string[] = ["otra-app"];
  onGraph((call) => {
    if (call.url.includes("/subscribed_apps")) {
      if (call.method === "POST") {
        suscritas = [...suscritas, "app-dalecontrol"];
        return { status: 200, json: { success: true } };
      }
      return {
        status: 200,
        json: { data: suscritas.map((id) => ({ whatsapp_business_api_data: { id } })) },
      };
    }
    if (call.url.includes(A.phoneNumberId)) {
      return { status: 200, json: { display_phone_number: "+52 55 1234 5678", verified_name: "El Corte" } };
    }
    return null;
  });

  const conexion = await getBarberWaConnection(A.id);
  assert.equal(conexion.displayPhone, "+52 55 1234 5678", "se enseña el número, no el id interno de Meta");
  assert.equal(conexion.webhookSubscribed, true, "no estaba suscrita: se suscribió en la misma lectura");
  assert.ok(
    graph.some((c) => c.method === "POST" && c.url.endsWith(`${A.wabaId}/subscribed_apps`)),
    "se pidió la suscripción a Meta",
  );

  // Token revocado: la pantalla lo dice sin esperar al primer mensaje fallido.
  onGraph((call) =>
    call.url.includes(A.phoneNumberId)
      ? { status: 401, json: { error: { code: 190, message: "Error validating access token" } } }
      : null,
  );
  const rota = await getBarberWaConnection(A.id);
  assert.equal(rota.state, "ERROR");
  assert.match(rota.problem ?? "", /#190/);

  // Meta caído no es "token malo": no se inventa un problema.
  onGraph(() => ({ status: 502, json: {} }));
  const dudosa = await getBarberWaConnection(A.id);
  assert.notEqual(dudosa.state, "ERROR");
  assert.equal(dudosa.webhookSubscribed, null, "no se pudo saber: null, no false");
});

test("al conectar, el número tiene que ser de la cuenta que se autorizó", { skip }, async () => {
  onGraph((call) =>
    call.url.includes("/phone_numbers")
      ? { status: 200, json: { data: [{ id: "111" }, { id: "222" }] } }
      : null,
  );
  assert.equal(await barberWabaOwnsPhone("waba-1", "222", "token"), true);
  assert.equal(await barberWabaOwnsPhone("waba-1", "999", "token"), false, "un número ajeno no pasa");
  onGraph(() => ({ status: 400, json: { error: { message: "nope" } } }));
  assert.equal(await barberWabaOwnsPhone("waba-1", "222", "token"), false, "si Meta no lo confirma, es que no");
});

/* ═══════════════ Aviso de la fila: «ya casi es tu turno» ═══════════════ */

const avisoDe = (shop: string, nombre = "Luis Pérez", ahead = 2) =>
  walkInNotifyBody({ shopName: shop, clientName: nombre, ahead, etaMinutes: 20 });

test("🔴 el aviso de la fila SALE de verdad: plantilla de utilidad fuera de la ventana", { skip }, async () => {
  const phone = telefono();
  const r = await notifyBarberWalkIn({
    barbershopId: A.id,
    phone,
    body: avisoDe("Barbería El Corte"),
  });
  assert.equal(r.outcome, "sent");

  const [envio] = enviados();
  assert.equal(envio.body.to, `52${phone}`);
  assert.equal(envio.body.type, "template", "quien se formó en la fila no nos ha escrito: va la plantilla");
  assert.equal(envio.body.template.name, "dc_barber_turno_fila");
  const params = envio.body.template.components[0].parameters.map((p: any) => p.text);
  assert.deepEqual(params, [
    "Barbería El Corte",
    "Luis, faltan 2 personas para tu turno. Vente en unos 20 min.",
  ]);

  const [fila] = await mensajes(A, phone);
  assert.equal(fila.status, "SENT", "ya no se queda PENDING esperando a nadie");
  assert.equal(fila.templateName, BARBER_WALKIN_NOTIFY_TEMPLATE);
  assert.ok(fila.waMessageId);
  // Y el estado de entrega de Meta le llega a esa fila.
  await applyBarberDeliveryStatuses(A.phoneNumberId, [{ id: fila.waMessageId, status: "delivered" }]);
  assert.equal((await mensajes(A, phone))[0].status, "DELIVERED");
});

test("con la ventana abierta el aviso va como texto, completo", { skip }, async () => {
  const phone = telefono();
  const { value, msg } = entrante(A, phone, "ya llegué, ¿cuánto falta?");
  await ingestBarberInbound(value, msg);
  limpiar();

  const cuerpo = avisoDe("Barbería El Corte", "Memo", 0);
  const r = await notifyBarberWalkIn({ barbershopId: A.id, phone, body: cuerpo });
  assert.equal(r.outcome, "sent");
  assert.equal(enviados()[0].body.type, "text");
  assert.equal(enviados()[0].body.text.body, "Memo, ya es tu turno en Barbería El Corte. Te esperamos en la silla.");
});

test("🔴 doble clic en «Avisar»: un solo mensaje", { skip }, async () => {
  const phone = telefono();
  graphDelay(50);
  const cuerpo = avisoDe("Barbería El Corte");
  const resultados = await Promise.all([
    notifyBarberWalkIn({ barbershopId: A.id, phone, body: cuerpo }),
    notifyBarberWalkIn({ barbershopId: A.id, phone, body: cuerpo }),
    notifyBarberWalkIn({ barbershopId: A.id, phone, body: cuerpo }),
  ]);
  assert.equal(resultados.filter((r) => r.outcome === "sent").length, 1);
  assert.equal(resultados.filter((r) => r.outcome === "already").length, 2);
  assert.equal(enviados().length, 1);

  // Un rato después (ya enviado) tampoco se repite dentro de los 10 minutos.
  const otra = await notifyBarberWalkIn({ barbershopId: A.id, phone, body: cuerpo });
  assert.equal(otra.outcome, "already");
  assert.equal(enviados().length, 1);
});

test("sin WhatsApp conectado el aviso NO se encola para después: se dice por qué", { skip }, async () => {
  const sinNumero = await crearTienda({ conectada: false });
  const phone = telefono();
  const r = await notifyBarberWalkIn({ barbershopId: sinNumero.id, phone, body: avisoDe("X") });
  assert.equal(r.outcome, "failed");
  assert.equal(r.code, "NOT_CONNECTED");
  assert.equal(enviados().length, 0);
  assert.equal((await mensajes(sinNumero, phone)).length, 0, "no queda nada en cola para salir días después");
});

test("el aviso respeta el cupo del plan y cuenta contra él", { skip }, async () => {
  const T = await crearTienda({ plan: "BASICO" });
  const p1 = telefono();
  await prisma.barbershop.update({
    where: { id: T.id },
    data: { messagesUsedPeriod: 199, messagesPeriodStart: new Date() },
  });
  assert.equal((await notifyBarberWalkIn({ barbershopId: T.id, phone: p1, body: avisoDe("X") })).outcome, "sent");
  assert.equal(
    (await prisma.barbershop.findUniqueOrThrow({ where: { id: T.id } })).messagesUsedPeriod,
    200,
  );

  // Cupo agotado: no sale, y no se queda PENDING.
  const p2 = telefono();
  const r = await notifyBarberWalkIn({ barbershopId: T.id, phone: p2, body: avisoDe("X") });
  assert.equal(r.outcome, "failed");
  assert.equal(r.code, "QUOTA");
  assert.equal(enviados().length, 1);
  assert.equal((await mensajes(T, p2))[0].status, "FAILED");
});

test("si Meta rechaza el aviso (plantilla sin aprobar), el mostrador ve el motivo real", { skip }, async () => {
  const phone = telefono();
  onGraph((call) =>
    call.url.includes("/messages")
      ? { status: 400, json: { error: { code: 132001, message: "(#132001) Template name does not exist" } } }
      : null,
  );
  const r = await notifyBarberWalkIn({ barbershopId: A.id, phone, body: avisoDe("Barbería El Corte") });
  assert.equal(r.outcome, "failed");
  assert.equal(r.code, "SEND_FAILED");
  assert.match(r.error ?? "", /#132001/);
  assert.equal((await mensajes(A, phone))[0].status, "FAILED");

  // Un aviso fallido no bloquea el siguiente intento.
  onGraph(null);
  assert.equal((await notifyBarberWalkIn({ barbershopId: A.id, phone, body: avisoDe("X") })).outcome, "sent");
});

test("un aviso viejo que siguiera en cola ya no se manda", { skip }, async () => {
  const phone = telefono();
  const vieja = await prisma.barberMessage.create({
    data: {
      barbershopId: A.id,
      direction: "OUTBOUND",
      phone,
      body: avisoDe("Barbería El Corte"),
      templateName: BARBER_WALKIN_NOTIFY_TEMPLATE,
      status: "PENDING",
      createdAt: new Date(Date.now() - 45 * 60_000),
    },
  });
  await drainBarberOutbox(A.id);
  assert.equal(enviados().filter((c) => c.body.to === `52${phone}`).length, 0);
  const fila = await prisma.barberMessage.findUniqueOrThrow({ where: { id: vieja.id } });
  assert.equal(fila.status, "FAILED");
  assert.ok(isInvalidatedReminder(fila.errorMessage));
});
