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
  entranteBotonDePlantilla,
  entranteToque,
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
  enqueueBarberMessage,
  getBarberWaConnection,
  ingestBarberInbound,
  listBarberThreadMessages,
  notifyBarberBookingAccepted,
  notifyBarberBookingRejected,
  notifyBarberWalkIn,
  queueBarberBookingConfirmation,
  REMINDER_MIN_AGE_MS,
  runBarberWaDispatch,
  scheduleBarberReminders,
  sendBarberCampaign,
  sendBarberManualMessage,
} from "../whatsapp";
import {
  BARBER_WA_CANCEL_ASK,
  BARBER_WA_CLAIM_LOST_MESSAGE,
  BARBER_WA_OPT_OUT_REPLY,
  barberClientOptedOut,
  barberWaClaimMark,
  barberWaTemplate,
} from "../whatsapp-core";
import { BARBER_WALKIN_NOTIFY_TEMPLATE, isInvalidatedReminder, walkInNotifyBody } from "../agenda";
import { resolveBookingRequest } from "../booking";

const REMINDER = barberWaTemplate("reminder").name;
const REMINDER_BOTONES = barberWaTemplate("reminderButtons").name;

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
  assert.equal(envio.body.template.name, REMINDER_BOTONES, "primero la plantilla CON botones");
  assert.equal(envio.body.template.language.code, "es_MX");
  const params = envio.body.template.components[0].parameters.map((p: any) => p.text);
  assert.equal(params.length, 6, "las seis variables que tiene la plantilla aprobada");
  assert.equal(params[0], "Luis");
  assert.equal(params[1], "Barbería El Corte");
  assert.equal(params[3], "Corte de caballero");
  assert.equal(params[4], "Beto");
  // 🔴 Cada botón viaja con SU payload: la acción y la visita exacta.
  const botones = envio.body.template.components.filter((c: any) => c.type === "button");
  assert.deepEqual(
    botones.map((b: any) => [b.sub_type, b.index, b.parameters[0].payload]),
    [
      ["quick_reply", "0", `rec.confirmar:${cita.id}`],
      ["quick_reply", "1", `rec.reagendar:${cita.id}`],
      ["quick_reply", "2", `rec.cancelar:${cita.id}`],
    ],
  );

  const [fila] = await mensajes(A, phone);
  // La fila conserva el nombre del recordatorio de siempre: es lo que usan
  // la cola y «lo último que se le dijo», salga con la plantilla que salga.
  assert.equal(fila.templateName, REMINDER);
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

test("con la ventana de 24 h abierta el recordatorio sale gratis y CON botones; si Meta los rechaza, como texto", { skip }, async () => {
  await vaciarCola(A);
  const phone = telefono();
  const cita = await crearCita(A, { phone, enMinutos: 5 * 60 });
  // El cliente escribió hace un rato: ventana abierta.
  await prisma.barberMessage.create({
    data: { barbershopId: A.id, direction: "INBOUND", phone, body: "hola", status: "DELIVERED" },
  });
  await scheduleBarberReminders(A.id);
  await drainBarberOutbox(A.id);

  const [envio] = enviados();
  assert.equal(envio.body.type, "interactive", "no es plantilla: dentro de la ventana no se cobra");
  assert.match(envio.body.interactive.body.text, /te recordamos tu visita en Barbería El Corte/);
  assert.deepEqual(
    envio.body.interactive.action.buttons.map((b: any) => b.reply),
    [
      { id: `rec.confirmar:${cita.id}`, title: "✅ Confirmar" },
      { id: `rec.reagendar:${cita.id}`, title: "🔁 Cambiar" },
      { id: `rec.cancelar:${cita.id}`, title: "❌ Cancelar" },
    ],
  );

  // Otro cliente, y esta vez Meta rechaza el interactivo: sale el texto.
  limpiar();
  await vaciarCola(A);
  const p2 = telefono();
  await crearCita(A, { phone: p2, enMinutos: 5 * 60 });
  await prisma.barberMessage.create({
    data: { barbershopId: A.id, direction: "INBOUND", phone: p2, body: "hola", status: "DELIVERED" },
  });
  await scheduleBarberReminders(A.id);
  onGraph((call) =>
    call.body?.type === "interactive"
      ? { status: 400, json: { error: { code: 131009, message: "(#131009) Parameter value is not valid" } } }
      : null,
  );
  assert.deepEqual(await drainBarberOutbox(A.id), { sent: 1, failed: 0, skipped: 0 });
  const salidas = enviados();
  assert.equal(salidas[salidas.length - 1].body.type, "text");
  assert.match(salidas[salidas.length - 1].body.text.body, /Responde \*CONFIRMAR\*/);
});

test("🔴 si Meta rechaza o aún no aprueba la plantilla con botones, el recordatorio sale con la de TEXTO", { skip }, async () => {
  await vaciarCola(A);
  const phones = [telefono(), telefono()];
  for (const phone of phones) await crearCita(A, { phone, enMinutos: 5 * 60 });
  await scheduleBarberReminders(A.id);

  // Solo la de botones está sin aprobar; la de texto sí.
  onGraph((call) =>
    call.body?.template?.name === REMINDER_BOTONES
      ? { status: 404, json: { error: { code: 132001, message: "(#132001) Template name does not exist in the translation" } } }
      : null,
  );
  assert.deepEqual(await drainBarberOutbox(A.id), { sent: 2, failed: 0, skipped: 0 });
  const usadas = enviados().map((c) => c.body.template.name);
  assert.deepEqual(
    usadas,
    [REMINDER_BOTONES, REMINDER, REMINDER],
    "se intenta UNA vez la de botones y los demás van directo con la de texto",
  );
  for (const phone of phones) assert.equal((await mensajes(A, phone))[0].status, "SENT");

  // Y si la rechaza por otro motivo (la aprobada no trae botones → 132000),
  // también cae a la de texto en vez de perder el recordatorio.
  limpiar();
  await vaciarCola(A);
  const p3 = telefono();
  await crearCita(A, { phone: p3, enMinutos: 5 * 60 });
  await scheduleBarberReminders(A.id);
  onGraph((call) =>
    call.body?.template?.name === REMINDER_BOTONES
      ? { status: 400, json: { error: { code: 132000, message: "(#132000) Number of parameters does not match" } } }
      : null,
  );
  assert.deepEqual(await drainBarberOutbox(A.id), { sent: 1, failed: 0, skipped: 0 });
  assert.equal(enviados()[enviados().length - 1].body.template.name, REMINDER);
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

test("Meta rechaza el envío por un motivo REAL: la fila queda FAILED con ese motivo y no se reprograma", { skip }, async () => {
  await vaciarCola(A);
  const phone = telefono();
  await crearCita(A, { phone, enMinutos: 5 * 60 });
  await scheduleBarberReminders(A.id);

  onGraph((call) =>
    call.url.includes("/messages")
      ? {
          status: 400,
          json: { error: { code: 132000, message: "(#132000) Number of parameters does not match" } },
        }
      : null,
  );
  const drenado = await drainBarberOutbox(A.id);
  assert.deepEqual(drenado, { sent: 0, failed: 1, skipped: 0 });

  const [fila] = await mensajes(A, phone);
  assert.equal(fila.status, "FAILED");
  assert.match(fila.errorMessage ?? "", /#132000/);

  // Un fallo REAL de Meta no se reintenta cada pocos minutos.
  onGraph(null);
  assert.deepEqual(await scheduleBarberReminders(A.id), { queued: 0 });
});

test("🔴 la plantilla aún no está aprobada: el recordatorio ESPERA en cola y sale cuando Meta la aprueba", { skip }, async () => {
  await vaciarCola(A);
  const phones = [telefono(), telefono(), telefono()];
  for (const phone of phones) await crearCita(A, { phone, enMinutos: 5 * 60 });
  await scheduleBarberReminders(A.id);

  // Recién conectada: Meta todavía no aprueba dc_barber_recordatorio_cita.
  onGraph((call) =>
    call.url.includes("/messages")
      ? {
          status: 404,
          json: { error: { code: 132001, message: "(#132001) Template name does not exist in the translation" } },
        }
      : null,
  );
  const antes = await drainBarberOutbox(A.id);
  assert.deepEqual(antes, { sent: 0, failed: 0, skipped: 3 }, "ninguno se da por perdido");
  assert.equal(
    enviados().length,
    2,
    "a Meta se le pregunta UNA vez por plantilla y pasada (la de botones y la de texto), no una por fila",
  );
  for (const phone of phones) {
    const [fila] = await mensajes(A, phone);
    assert.equal(fila.status, "PENDING", "sigue en cola");
    assert.equal(fila.errorMessage, null, "sin reclamo colgado: la siguiente pasada la puede tomar");
  }
  // Y no se programa un segundo recordatorio mientras espera.
  assert.deepEqual(await scheduleBarberReminders(A.id), { queued: 0 });

  // Meta aprueba la plantilla: la siguiente pasada los manda.
  limpiar();
  assert.deepEqual(await drainBarberOutbox(A.id), { sent: 3, failed: 0, skipped: 0 });
  assert.equal(enviados().length, 3);
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

const estadoDe = async (id: string) =>
  (await prisma.barberAppointment.findUniqueOrThrow({ where: { id } })).status;
const ultimoTexto = () => {
  const c = enviados()[enviados().length - 1];
  return (c.body.type === "interactive" ? c.body.interactive.body.text : c.body.text?.body) as string;
};

test("🔴 G1 — la tabla de la revisora: contestar al recordatorio con una frase normal NO toca la visita", { skip }, async () => {
  // El bot de A está apagado: lo que no sea para el recordatorio se queda en
  // la bandeja y no recibe NINGUNA respuesta automática.
  const frases = [
    "Sí confirmo, no voy a faltar",
    "ahí estaré, no voy a fallar",
    "voy a llegar 10 min tarde, no puedo salir antes",
    "no puedo estacionarme, ahorita llego",
    "¿puedo cancelar si llueve?",
    "oye no puedo a las 5, ¿me la pasas a las 6?",
    "¿tienen cambio de 500?",
    "no confirmo todavía, te aviso",
  ];
  for (const frase of frases) {
    limpiar();
    const phone = telefono();
    const cita = await visitaRecordada(A, phone);
    const { value, msg } = entrante(A, phone, frase);
    await ingestBarberInbound(value, msg);
    assert.equal(await estadoDe(cita.id), "PENDING", `«${frase}» no cancela ni confirma`);
    assert.equal(enviados().length, 0, `«${frase}» no recibe «quedó cancelada» ni «te movemos la visita»`);
    assert.equal((await mensajes(A, phone)).filter((r) => r.direction === "INBOUND").length, 1, "queda en la bandeja");
  }
});

test("🔴 G1 — CANCELAR no cancela: pregunta por ESA visita, y solo el «sí» la cancela", { skip }, async () => {
  const phone = telefono();
  const cita = await visitaRecordada(A, phone, 8 * 60);
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

  let m = entrante(A, phone, "Cancelar");
  await ingestBarberInbound(m.value, m.msg);
  assert.equal(await estadoDe(cita.id), "PENDING", "todavía NO está cancelada");
  const pregunta = enviados()[0];
  assert.equal(pregunta.body.type, "interactive");
  assert.match(pregunta.body.interactive.body.text, /^¿Cancelo tu visita del .+\? Responde \*SÍ\*/);
  assert.deepEqual(
    pregunta.body.interactive.action.buttons.map((b: any) => b.reply.id),
    [`rec.si-cancelar:${cita.id}`, `rec.no-cancelar:${cita.id}`],
  );
  const filaPregunta = (await mensajes(A, phone)).find((r) => r.templateName === BARBER_WA_CANCEL_ASK);
  assert.equal(filaPregunta?.appointmentId, cita.id, "la fila recuerda por qué visita se preguntó");

  // Una frase que no es «sí» no cancela nada.
  limpiar();
  m = entrante(A, phone, "espera, déjame ver si alcanzo");
  await ingestBarberInbound(m.value, m.msg);
  assert.equal(await estadoDe(cita.id), "PENDING");
  assert.equal(enviados().length, 0);

  // «Sí» → se cancela ESA visita.
  m = entrante(A, phone, "Sí");
  await ingestBarberInbound(m.value, m.msg);
  assert.equal(await estadoDe(cita.id), "CANCELLED");
  assert.match(ultimoTexto(), /quedó cancelada/);
  const fila = await prisma.barberMessage.findUniqueOrThrow({ where: { id: enCola.id } });
  assert.equal(fila.status, "FAILED");
  assert.ok(isInvalidatedReminder(fila.errorMessage), "y lo que tenía en cola se invalida");
  // La pregunta se ve en la bandeja como un mensaje normal, sin etiqueta rara.
  const hilo = await listBarberThreadMessages(A.id, phone);
  const dto = hilo.messages.find((x) => x.body?.startsWith("¿Cancelo tu visita"));
  assert.ok(dto, "la pregunta aparece en la conversación");
  assert.equal(dto.templateName, null);
});

test("G1 — contestar «no» a la pregunta conserva la visita", { skip }, async () => {
  const phone = telefono();
  const cita = await visitaRecordada(A, phone, 8 * 60);
  let m = entrante(A, phone, "2");
  await ingestBarberInbound(m.value, m.msg);
  assert.match(ultimoTexto(), /^¿Cancelo tu visita/);
  m = entrante(A, phone, "No");
  await ingestBarberInbound(m.value, m.msg);
  assert.equal(await estadoDe(cita.id), "PENDING");
  assert.match(ultimoTexto(), /sigue en pie/);
});

test("🔴 G1 — se cancela la visita por la que se preguntó, no «la primera recordada»", { skip }, async () => {
  const phone = telefono();
  // Sábado: recordada y ya confirmada por el cliente.
  const sabado = await visitaRecordada(A, phone, 20 * 60);
  let m = entrante(A, phone, "confirmar");
  await ingestBarberInbound(m.value, m.msg);
  assert.equal(await estadoDe(sabado.id), "CONFIRMED");
  // Domingo: recordada después.
  const domingo = await visitaRecordada(A, phone, 23 * 60);

  // La frase de la revisora ya no cancela nada…
  limpiar();
  m = entrante(A, phone, "quiero cancelar la del domingo");
  await ingestBarberInbound(m.value, m.msg);
  assert.equal(await estadoDe(sabado.id), "CONFIRMED");
  assert.equal(await estadoDe(domingo.id), "PENDING");
  assert.equal(enviados().length, 0);

  // …y como ya hubo otro mensaje en medio, hay que volver a mandar el
  // recordatorio para que «CANCELAR» cuente: aquí lo simula el botón, que
  // siempre dice su visita.
  const toque = entranteToque(A, phone, { id: `rec.cancelar:${domingo.id}`, title: "❌ Cancelar" });
  await ingestBarberInbound(toque.value, toque.msg);
  m = entrante(A, phone, "sí");
  await ingestBarberInbound(m.value, m.msg);
  assert.equal(await estadoDe(domingo.id), "CANCELLED", "se canceló la del domingo");
  assert.equal(await estadoDe(sabado.id), "CONFIRMED", "la del sábado ni se tocó");
});

test("🔴 G1 — los botones dicen EXACTAMENTE qué visita, también el de la plantilla", { skip }, async () => {
  const phone = telefono();
  const una = await visitaRecordada(A, phone, 9 * 60);
  const otra = await visitaRecordada(A, phone, 11 * 60);

  // Dos recordatorios seguidos al mismo número: escrito sería ambiguo; el
  // botón no, porque trae su visita. Así llega el botón de una PLANTILLA.
  let t: { value: any; msg: any } = entranteBotonDePlantilla(A, phone, {
    payload: `rec.confirmar:${una.id}`,
    text: "Confirmar",
  });
  await ingestBarberInbound(t.value, t.msg);
  assert.equal(await estadoDe(una.id), "CONFIRMED");
  assert.equal(await estadoDe(otra.id), "PENDING");

  // Y así el de un mensaje interactivo: cancelar → pregunta → «Sí, cancelar».
  t = entranteToque(A, phone, { id: `rec.cancelar:${otra.id}`, title: "❌ Cancelar" });
  await ingestBarberInbound(t.value, t.msg);
  assert.equal(await estadoDe(otra.id), "PENDING", "el botón Cancelar tampoco cancela: pregunta");
  t = entranteToque(A, phone, { id: `rec.si-cancelar:${otra.id}`, title: "Sí, cancelar" });
  await ingestBarberInbound(t.value, t.msg);
  assert.equal(await estadoDe(otra.id), "CANCELLED");
  assert.equal(await estadoDe(una.id), "CONFIRMED");

  // «Cambiar» no toca la visita: abre la conversación.
  const tercera = await visitaRecordada(A, telefono(), 9 * 60);
  t = entranteToque(A, tercera.clientPhone!, { id: `rec.reagendar:${tercera.id}`, title: "🔁 Cambiar" });
  await ingestBarberInbound(t.value, t.msg);
  assert.equal(await estadoDe(tercera.id), "PENDING");
  assert.match(ultimoTexto(), /Con gusto te movemos la visita/);
});

test("🔴 G1 — un botón con la visita de OTRO teléfono, o ya vencida, no hace nada", { skip }, async () => {
  const ajena = await visitaRecordada(A, telefono(), 9 * 60);
  const intruso = telefono();
  for (const id of [`rec.si-cancelar:${ajena.id}`, `rec.confirmar:${ajena.id}`, "rec.si-cancelar:no-existe"]) {
    limpiar();
    const t = entranteToque(A, intruso, { id, title: "x" });
    await ingestBarberInbound(t.value, t.msg);
    assert.equal(await estadoDe(ajena.id), "PENDING", id);
    assert.match(ultimoTexto(), /ya no está vigente/);
  }
  // La misma visita desde OTRA barbería tampoco.
  const t = entranteToque(B, ajena.clientPhone!, { id: `rec.si-cancelar:${ajena.id}`, title: "x" });
  await ingestBarberInbound(t.value, t.msg);
  assert.equal(await estadoDe(ajena.id), "PENDING");
});

test("🔴 cancelar o mover a menos de 2 horas: no se toca nada y se le da el teléfono de la barbería", { skip }, async () => {
  const aviso = /Para cambios de última hora llama a la barbería: 55 1234 5678\./;

  // Visita en 90 minutos, recién recordada.
  const p1 = telefono();
  const c1 = await visitaRecordada(A, p1, 90);
  let m = entrante(A, p1, "CANCELAR");
  await ingestBarberInbound(m.value, m.msg);
  assert.equal(await estadoDe(c1.id), "PENDING");
  assert.match(ultimoTexto(), aviso);
  assert.ok(!/¿Cancelo tu visita/.test(ultimoTexto()), "ni siquiera se le pregunta");

  // Por botón, y aunque intente saltarse la pregunta.
  for (const id of [`rec.cancelar:${c1.id}`, `rec.si-cancelar:${c1.id}`, `rec.reagendar:${c1.id}`]) {
    limpiar();
    const t = entranteToque(A, p1, { id, title: "x" });
    await ingestBarberInbound(t.value, t.msg);
    assert.equal(await estadoDe(c1.id), "PENDING", id);
    assert.match(ultimoTexto(), aviso, id);
  }

  // Confirmar sí se puede hasta el último minuto.
  const t = entranteToque(A, p1, { id: `rec.confirmar:${c1.id}`, title: "✅ Confirmar" });
  await ingestBarberInbound(t.value, t.msg);
  assert.equal(await estadoDe(c1.id), "CONFIRMED");

  // Con más de 2 horas, cancelar sigue su camino normal (pregunta).
  const p2 = telefono();
  const c2 = await visitaRecordada(A, p2, 150);
  m = entrante(A, p2, "cancelar");
  await ingestBarberInbound(m.value, m.msg);
  assert.match(ultimoTexto(), /^¿Cancelo tu visita/);
  assert.equal(await estadoDe(c2.id), "PENDING");
});

test("🔴 la palabra exacta solo cuenta si el recordatorio fue lo último que dijimos", { skip }, async () => {
  // Caso 1: recordatorio → "sí". Confirma.
  const p1 = telefono();
  const c1 = await visitaRecordada(A, p1);
  let m = entrante(A, p1, "Sí");
  await ingestBarberInbound(m.value, m.msg);
  assert.equal(await estadoDe(c1.id), "CONFIRMED");

  // Caso 2: recordatorio → después ya hubo conversación (alguien le preguntó
  // otra cosa). Ni «si» ni «CONFIRMAR» ni «CANCELAR» son ya para el
  // recordatorio: la visita no se toca.
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
  for (const texto of ["si", "CONFIRMAR", "CANCELAR", "2"]) {
    limpiar();
    m = entrante(A, p2, texto);
    await ingestBarberInbound(m.value, m.msg);
    assert.equal(await estadoDe(c2.id), "PENDING", `«${texto}» era para la otra pregunta`);
    assert.equal(enviados().length, 0, `«${texto}» no recibe respuesta del recordatorio`);
  }

  // Caso 3: lo último que se le dijo fue la CONFIRMACIÓN DE LA RESERVA (una
  // fila que también lleva la visita, pero no es el recordatorio). Tampoco.
  const p3 = telefono();
  const c3 = await crearCita(A, { phone: p3, enMinutos: 6 * 60 });
  await prisma.barberMessage.create({
    data: {
      barbershopId: A.id,
      direction: "OUTBOUND",
      phone: p3,
      body: "¡Listo Luis! Tu visita quedó agendada…",
      templateName: barberWaTemplate("bookingConfirmed").name,
      status: "DELIVERED",
      appointmentId: c3.id,
    },
  });
  for (const texto of ["CANCELAR", "ok", "3"]) {
    limpiar();
    m = entrante(A, p3, texto);
    await ingestBarberInbound(m.value, m.msg);
    assert.equal(await estadoDe(c3.id), "PENDING", `«${texto}» tras la confirmación de reserva`);
    assert.equal(enviados().length, 0);
  }
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

test("la campaña dice POR QUÉ se cortó: sin conexión no es «sin cupo», y un no elegible no corta nada", { skip }, async () => {
  const cliente = await crearCliente(A, telefono(), "Beto Sol");
  const bloqueado = await crearCliente(A, telefono(), "Bloqueado");
  await prisma.barberClient.update({ where: { id: bloqueado.id }, data: { blockedAt: new Date() } });

  // Uno bloqueado y uno bueno: el bueno recibe, y nada "se cortó".
  const mixta = await sendBarberCampaign({
    barbershopId: A.id,
    kind: "birthday",
    promo: "tu corte lleva barba de cortesía.",
    clientIds: [bloqueado.id, cliente.id],
  });
  assert.deepEqual({ sent: mixta.sent, stop: mixta.stop }, { sent: 1, stop: null });

  // Sin número conectado.
  const sinNumero = await crearTienda({ conectada: false });
  const c2 = await crearCliente(sinNumero, telefono());
  const off = await sendBarberCampaign({ barbershopId: sinNumero.id, kind: "winback", promo: "x", clientIds: [c2.id] });
  assert.deepEqual({ sent: off.sent, stop: off.stop }, { sent: 0, stop: "not_connected" });

  // Cupo agotado.
  const basico = await crearTienda({ plan: "BASICO" });
  const c3 = await crearCliente(basico, telefono());
  await prisma.barbershop.update({
    where: { id: basico.id },
    data: { messagesUsedPeriod: 200, messagesPeriodStart: new Date() },
  });
  const tope = await sendBarberCampaign({ barbershopId: basico.id, kind: "winback", promo: "x", clientIds: [c3.id] });
  assert.deepEqual({ sent: tope.sent, stop: tope.stop }, { sent: 0, stop: "quota" });
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

  // M14 — pero un aviso DISTINTO sí sale: «faltan 2» y, al liberarse la silla, «ya es tu turno».
  const yaTeToca = walkInNotifyBody({ shopName: "Barbería El Corte", clientName: "Luis Pérez", ahead: 0, etaMinutes: 0 });
  assert.notEqual(yaTeToca, cuerpo);
  const segundo = await notifyBarberWalkIn({ barbershopId: A.id, phone, body: yaTeToca });
  assert.equal(segundo.outcome, "sent");
  assert.equal(enviados().length, 2);
  // …y ese tampoco se repite con un doble clic.
  assert.equal((await notifyBarberWalkIn({ barbershopId: A.id, phone, body: yaTeToca })).outcome, "already");
  assert.equal(enviados().length, 2);
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
  assert.equal(r.code, "TEMPLATE_PENDING", "el aviso de la fila no espera: se dice en el acto");
  assert.match(r.error ?? "", /#132001/);
  assert.match(r.error ?? "", /todavía no está aprobada por Meta/);
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

/* ═══════ G3 — solicitudes que la barbería todavía no acepta ═══════ */

const CONFIRMACION = barberWaTemplate("bookingConfirmed").name;

test("🔴 G3 — una reserva en línea PENDIENTE no recibe «quedó agendada»; al aceptarla, sí", { skip }, async () => {
  const phone = telefono();
  const solicitud = await crearCita(A, { phone, enMinutos: 26 * 60, source: "PUBLIC" });

  // Al reservar (política manual): nada en la cola.
  assert.equal(await queueBarberBookingConfirmation({ barbershopId: A.id, appointmentId: solicitud.id }), null);
  assert.equal((await mensajes(A, phone)).length, 0, "ni «¡Listo! Tu visita quedó agendada» ni nada");

  // La barbería la acepta (lo hace booking.ts) y avisa con la función nueva.
  await prisma.barberAppointment.update({ where: { id: solicitud.id }, data: { status: "CONFIRMED" } });
  const aviso = await notifyBarberBookingAccepted({ barbershopId: A.id, appointmentId: solicitud.id });
  assert.deepEqual(aviso, { sent: true, reason: "sent" });
  const [envio] = enviados();
  assert.equal(envio.body.template.name, CONFIRMACION, "el cliente no ha escrito: va la plantilla de utilidad");
  assert.equal(envio.body.to, `52${phone}`);
  const [fila] = await mensajes(A, phone);
  assert.equal(fila.status, "SENT");
  assert.equal(fila.appointmentId, solicitud.id);

  // Aceptar dos veces (doble clic) no confirma dos veces.
  limpiar();
  const otra = await notifyBarberBookingAccepted({ barbershopId: A.id, appointmentId: solicitud.id });
  assert.deepEqual(otra, { sent: false, reason: "not_applicable" });
  assert.equal(enviados().length, 0);

  // Con política «auto» la cita nace CONFIRMADA y la confirmación se encola al reservar, como siempre.
  const p2 = telefono();
  const directa = await crearCita(A, { phone: p2, enMinutos: 26 * 60, source: "PUBLIC", status: "CONFIRMED" });
  assert.ok(await queueBarberBookingConfirmation({ barbershopId: A.id, appointmentId: directa.id }));
  assert.equal((await mensajes(A, p2))[0].status, "PENDING");
});

test("G3 — aceptar con la plantilla aún sin aprobar: la confirmación espera en cola, no se pierde", { skip }, async () => {
  const phone = telefono();
  const cita = await crearCita(A, { phone, enMinutos: 26 * 60, source: "PUBLIC", status: "CONFIRMED" });
  onGraph((call) =>
    call.url.includes("/messages")
      ? { status: 404, json: { error: { code: 132001, message: "(#132001) Template name does not exist" } } }
      : null,
  );
  const aviso = await notifyBarberBookingAccepted({ barbershopId: A.id, appointmentId: cita.id });
  assert.deepEqual(aviso, { sent: false, reason: "queued" });
  const [fila] = await mensajes(A, phone);
  assert.equal(fila.status, "PENDING");
  assert.equal(fila.errorMessage, null);

  // Meta la aprueba: la siguiente pasada del despacho la manda.
  onGraph(null);
  limpiar();
  await drainBarberOutbox(A.id);
  assert.equal(enviados().filter((c) => c.body.to === `52${phone}`).length, 1);
});

test("🔴 G3 — al RECHAZAR: texto si el cliente escribió en las últimas 24 h; si no, nada (no hay plantilla)", { skip }, async () => {
  // Con la ventana abierta.
  const p1 = telefono();
  const s1 = await crearCita(A, { phone: p1, enMinutos: 26 * 60, source: "PUBLIC", name: "Memo Ruiz" });
  await prisma.barberMessage.create({
    data: { barbershopId: A.id, direction: "INBOUND", phone: p1, body: "¿sí quedó mi cita?", status: "DELIVERED" },
  });
  // Todavía no está rechazada: no se avisa de algo que no ha pasado.
  assert.deepEqual(
    await notifyBarberBookingRejected({ barbershopId: A.id, appointmentId: s1.id }),
    { sent: false, reason: "not_applicable" },
  );
  await prisma.barberAppointment.update({ where: { id: s1.id }, data: { status: "CANCELLED" } });
  assert.deepEqual(
    await notifyBarberBookingRejected({ barbershopId: A.id, appointmentId: s1.id }),
    { sent: true, reason: "sent" },
  );
  const [envio] = enviados();
  assert.equal(envio.body.type, "text");
  assert.match(envio.body.text.body, /^Hola Memo\. Barbería El Corte no pudo tomar tu solicitud del .+, así que ese horario NO quedó apartado\./);

  // Sin ventana: no se manda nada y se dice por qué, para que la barbería le llame.
  limpiar();
  const p2 = telefono();
  const s2 = await crearCita(A, { phone: p2, enMinutos: 26 * 60, source: "PUBLIC", status: "CANCELLED" });
  assert.deepEqual(
    await notifyBarberBookingRejected({ barbershopId: A.id, appointmentId: s2.id }),
    { sent: false, reason: "window_closed" },
  );
  assert.equal(enviados().length, 0, "ni texto (Meta lo rechazaría) ni plantilla (no existe)");
  assert.equal((await mensajes(A, p2)).length, 0);

  // Una cita de OTRA barbería no existe para ésta.
  assert.deepEqual(
    await notifyBarberBookingRejected({ barbershopId: B.id, appointmentId: s1.id }),
    { sent: false, reason: "not_found" },
  );
  // Sin WhatsApp conectado.
  const sinNumero = await crearTienda({ conectada: false });
  const s3 = await crearCita(sinNumero, { phone: telefono(), enMinutos: 600, source: "PUBLIC", status: "CANCELLED" });
  assert.deepEqual(
    await notifyBarberBookingRejected({ barbershopId: sinNumero.id, appointmentId: s3.id }),
    { sent: false, reason: "not_connected" },
  );
});

test("🔴 G3 — a una solicitud sin aceptar NO se le recuerda, y un «CONFIRMAR» del cliente no la confirma", { skip }, async () => {
  await vaciarCola(A);
  const pSolicitud = telefono();
  const pPanel = telefono();
  const solicitud = await crearCita(A, { phone: pSolicitud, enMinutos: 5 * 60, source: "PUBLIC" });
  await crearCita(A, { phone: pPanel, enMinutos: 5 * 60, source: "PANEL" });

  // Solo se recuerda la que creó la barbería.
  assert.deepEqual(await scheduleBarberReminders(A.id), { queued: 1 });
  assert.equal((await mensajes(A, pSolicitud)).length, 0);
  assert.equal((await mensajes(A, pPanel)).length, 1);

  // Aunque hubiera un recordatorio viejo en el hilo, CONFIRMAR no la acepta
  // por la barbería (escrito o con el botón).
  await prisma.barberMessage.create({
    data: {
      barbershopId: A.id,
      direction: "OUTBOUND",
      phone: pSolicitud,
      body: "Hola Luis, te recordamos tu visita…",
      templateName: REMINDER,
      status: "DELIVERED",
      appointmentId: solicitud.id,
    },
  });
  limpiar();
  const m = entrante(A, pSolicitud, "CONFIRMAR");
  await ingestBarberInbound(m.value, m.msg);
  assert.equal(await estadoDe(solicitud.id), "PENDING", "sigue siendo una solicitud");
  const t = entranteToque(A, pSolicitud, { id: `rec.confirmar:${solicitud.id}`, title: "✅ Confirmar" });
  await ingestBarberInbound(t.value, t.msg);
  assert.equal(await estadoDe(solicitud.id), "PENDING");

  // En cuanto la barbería la acepta, entra a los recordatorios.
  await prisma.barberAppointment.update({ where: { id: solicitud.id }, data: { status: "CONFIRMED" } });
  await prisma.barberMessage.deleteMany({ where: { barbershopId: A.id, phone: pSolicitud } });
  assert.deepEqual(await scheduleBarberReminders(A.id), { queued: 1 });
});

test("🔴 la cita que agenda el BOT en manual también es solicitud: sin recordatorio, «CONFIRMAR» no la confirma, al aceptarla sale texto", { skip }, async () => {
  await vaciarCola(A);
  const phone = telefono();
  const delBot = await crearCita(A, { phone, enMinutos: 5 * 60, source: "WHATSAPP" });
  // El cliente acaba de agendar por el chat: la ventana de 24 h está abierta.
  await prisma.barberMessage.create({
    data: { barbershopId: A.id, direction: "INBOUND", phone, body: "quiero corte a las 5", status: "DELIVERED" },
  });

  assert.deepEqual(await scheduleBarberReminders(A.id), { queued: 0 }, "no se recuerda lo que la barbería no ha aceptado");

  limpiar();
  const m = entrante(A, phone, "CONFIRMAR");
  await ingestBarberInbound(m.value, m.msg);
  assert.equal(await estadoDe(delBot.id), "PENDING", "confirmarla es de la barbería, no del cliente");

  // La barbería la acepta en Solicitudes: el aviso sale como TEXTO (ventana abierta).
  limpiar();
  const ok = await resolveBookingRequest({ barbershopIds: [A.id], appointmentId: delBot.id, action: "aceptar" });
  assert.deepEqual(ok, { ok: true, status: "CONFIRMED" });
  await drainBarberOutbox(A.id);
  const aEl = enviados().filter((c) => c.body.to === `52${phone}`);
  assert.equal(aEl.length, 1);
  assert.equal(aEl[0].body.type, "text", "dentro de la ventana no se gasta plantilla");

  // Ya aceptada, entra a los recordatorios como cualquier visita.
  await prisma.barberMessage.deleteMany({ where: { barbershopId: A.id, phone, direction: "OUTBOUND" } });
  assert.deepEqual(await scheduleBarberReminders(A.id), { queued: 1 });
});

test("🔴 no se recuerda una visita creada hace menos de 3 horas", { skip }, async () => {
  await vaciarCola(A);
  const reciente = telefono();
  const casi = telefono();
  const madura = telefono();
  await crearCita(A, { phone: reciente, enMinutos: 5 * 60, creadaHaceMin: 10 });
  await crearCita(A, { phone: casi, enMinutos: 5 * 60, creadaHaceMin: 175 });
  await crearCita(A, { phone: madura, enMinutos: 5 * 60, creadaHaceMin: 185 });

  assert.deepEqual(await scheduleBarberReminders(A.id), { queued: 1 });
  assert.equal((await mensajes(A, madura)).length, 1, "la de hace más de 3 h sí");
  assert.equal((await mensajes(A, reciente)).length, 0, "la recién creada no: acaba de recibir su confirmación");
  assert.equal((await mensajes(A, casi)).length, 0);
  assert.equal(REMINDER_MIN_AGE_MS, 3 * 3_600_000);

  // Cuando cumple las 3 horas, la siguiente pasada la recuerda.
  await prisma.barberAppointment.updateMany({
    where: { barbershopId: A.id, clientPhone: casi },
    data: { createdAt: new Date(Date.now() - 181 * 60_000) },
  });
  assert.deepEqual(await scheduleBarberReminders(A.id), { queued: 1 });
});

test("G3 — el aviso de rechazo que encola booking.ts: sale si la ventana sigue abierta; si se cerró, caduca sin ruido", { skip }, async () => {
  await vaciarCola(A);
  // Así lo encola la otra pantalla (ws6-t8) al rechazar: texto, sin plantilla.
  const abierta = telefono();
  const cerrada = telefono();
  const cita1 = await crearCita(A, { phone: abierta, enMinutos: 600, source: "PUBLIC", status: "CANCELLED" });
  const cita2 = await crearCita(A, { phone: cerrada, enMinutos: 600, source: "PUBLIC", status: "CANCELLED" });
  await prisma.barberMessage.create({
    data: { barbershopId: A.id, direction: "INBOUND", phone: abierta, body: "hola", status: "DELIVERED" },
  });
  // El otro cliente escribió hace 25 horas: su ventana ya se cerró.
  await prisma.barberMessage.create({
    data: {
      barbershopId: A.id,
      direction: "INBOUND",
      phone: cerrada,
      body: "hola",
      status: "DELIVERED",
      createdAt: new Date(Date.now() - 25 * 3_600_000),
    },
  });
  const texto = "Barbería El Corte: no pudimos apartar tu cita del sábado. Escríbenos por aquí y te buscamos otro horario.";
  const id1 = await enqueueBarberMessage({ barbershopId: A.id, phone: abierta, body: texto, templateName: null, appointmentId: cita1.id });
  const id2 = await enqueueBarberMessage({ barbershopId: A.id, phone: cerrada, body: texto, templateName: null, appointmentId: cita2.id });

  const drenado = await drainBarberOutbox(A.id);
  assert.equal(drenado.sent, 1);
  assert.equal(drenado.failed, 0, "el que caducó no cuenta como fallo de envío");
  assert.equal(enviados().length, 1);
  assert.equal(enviados()[0].body.to, `52${abierta}`);
  assert.equal(enviados()[0].body.text.body, texto, "aunque la cita esté cancelada: es justo el aviso de eso");

  const sale = await prisma.barberMessage.findUniqueOrThrow({ where: { id: id1! } });
  const caduca = await prisma.barberMessage.findUniqueOrThrow({ where: { id: id2! } });
  assert.equal(sale.status, "SENT");
  assert.equal(caduca.status, "FAILED");
  assert.ok(isInvalidatedReminder(caduca.errorMessage), "caducado, no «Meta lo rechazó»");
  const hilo = await listBarberThreadMessages(A.id, cerrada);
  assert.equal(hilo.messages.find((m) => m.id === id2)?.error, null);
});

test("M18 — el aviso de «falta método de pago» se quita cuando un envío posterior sale o se reconecta", { skip }, async () => {
  const tienda = await crearTienda({ plan: "PROFESIONAL" });
  const phone = telefono();
  const fallo = await prisma.barberMessage.create({
    data: {
      barbershopId: tienda.id,
      direction: "OUTBOUND",
      phone,
      body: "Hola, te recordamos tu visita…",
      status: "FAILED",
      errorMessage: "(#131042) Business eligibility payment issue",
      createdAt: new Date(Date.now() - 3_600_000),
    },
  });
  // La conexión se dio de alta ANTES del fallo (lo normal): el aviso se enseña.
  await prisma.barbershop.update({
    where: { id: tienda.id },
    data: { whatsappVerifiedAt: new Date(Date.now() - 86_400_000) },
  });
  assert.equal((await getBarberWaConnection(tienda.id)).state, "NO_PAYMENT_METHOD");

  // Pone la tarjeta y el siguiente mensaje SÍ sale: el aviso ya no es verdad.
  const bueno = await prisma.barberMessage.create({
    data: { barbershopId: tienda.id, direction: "OUTBOUND", phone, body: "Hola", status: "DELIVERED" },
  });
  const sana = await getBarberWaConnection(tienda.id);
  assert.equal(sana.state, "CONNECTED");
  assert.equal(sana.problem, null);

  // Sin ese envío, pero habiendo vuelto a conectar después del fallo: igual.
  await prisma.barberMessage.delete({ where: { id: bueno.id } });
  assert.equal((await getBarberWaConnection(tienda.id)).state, "NO_PAYMENT_METHOD");
  await prisma.barbershop.update({ where: { id: tienda.id }, data: { whatsappVerifiedAt: new Date() } });
  assert.equal((await getBarberWaConnection(tienda.id)).state, "CONNECTED");

  // Y un fallo NUEVO vuelve a encenderlo.
  await prisma.barberMessage.create({
    data: {
      barbershopId: tienda.id,
      direction: "OUTBOUND",
      phone,
      body: "Hola otra vez",
      status: "FAILED",
      errorMessage: "(#131042) Business eligibility payment issue",
      createdAt: new Date(Date.now() + 2_000),
    },
  });
  assert.equal((await getBarberWaConnection(tienda.id)).state, "NO_PAYMENT_METHOD");
  assert.ok(fallo.id);
});
