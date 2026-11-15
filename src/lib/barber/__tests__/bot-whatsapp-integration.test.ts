// El BOT de barber de punta a punta, entrando por donde entra de verdad:
// el webhook (ingestBarberInbound). Postgres real; Meta, Claude y Whisper
// simulados (ver _wa-arnes.ts).
//
// Lo que hay que demostrar aquí, porque es lo que se le prometió a una
// barbería que ya pagó:
//   · el cliente escribe (o manda una nota de voz, o toca un botón) y sale
//     con cita — creada por el motor de agenda, no por el modelo;
//   · lo que el bot ofrece con botones cierra el ciclo cuando se toca;
//   · el bot no se apaga solo cliente por cliente (pausas que caducan), no
//     le pisa la respuesta a una persona y no deja a nadie con «te paso con
//     alguien» cuando la cita ya quedó hecha.
import {
  borrarTodo,
  crearCita,
  crearCliente,
  crearTienda,
  entrante,
  entranteToque,
  entranteVoz,
  enviados,
  instalarFetch,
  limpiar,
  mensajes,
  modelQueue,
  modelRequests,
  oggDe,
  onGraph,
  prisma,
  restaurarFetch,
  say,
  setAudio,
  setWhisper,
  skip,
  telefono,
  toolResults,
  useTool,
  whisperCalls,
  BASE_LOCAL,
  TOKENS_POR_LLAMADA,
  TZ,
  type Tienda,
} from "./_wa-arnes";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ingestBarberInbound, sendBarberManualMessage } from "../whatsapp";
import {
  BARBER_WA_VOICE_FAILED_REPLY,
  BARBER_WA_VOICE_TOO_LONG_REPLY,
  barberWaTemplate,
} from "../whatsapp-core";
import {
  barberBotGate,
  listBarberBotPauses,
  runBarberBotTurn,
  saveBarberBotSettings,
} from "../bot";
import {
  BARBER_BOT_PAUSE_OFF_HOURS,
  botTurnCostMicros,
  botVoiceCostMicros,
  isAutoBotPause,
} from "../bot-core";
import { addIsoDays, barberTodayISO } from "../booking-core";

let P: Tienda;
const MANANA = addIsoDays(barberTodayISO(TZ), 1);
const BOT_ON = { enabled: true, aiDailyCapMxn: 50, hours: { mode: "always" } };

/** Lo que cuesta UNA llamada al modelo simulado con la tarifa de Sonnet 5. */
const COSTO_LLAMADA = botTurnCostMicros({
  model: "claude-sonnet-5",
  inputTokens: TOKENS_POR_LLAMADA.input_tokens,
  outputTokens: TOKENS_POR_LLAMADA.output_tokens,
  usdMxn: 18,
});

before(async () => {
  if (!BASE_LOCAL) return;
  process.env.BARBER_ANTHROPIC_API_KEY = "sk-prueba-guionada";
  process.env.OPENAI_API_KEY = "sk-prueba-whisper";
  delete process.env.BARBER_BOT_AI_MODEL;
  delete process.env.BARBER_BOT_AI_THINKING;
  delete process.env.BARBER_BOT_USD_MXN;
  instalarFetch();
  P = await crearTienda({ name: "Barbería El Corte", plan: "PROFESIONAL" });
  await saveBarberBotSettings(P.id, BOT_ON);
});

after(async () => {
  restaurarFetch();
  if (!BASE_LOCAL) return;
  await borrarTodo();
});

beforeEach(() => limpiar());

async function escribe(t: Tienda, phone: string, texto: string) {
  const { value, msg } = entrante(t, phone, texto);
  return ingestBarberInbound(value, msg);
}
async function gastoDeHoy(t: Tienda): Promise<number> {
  const row = await prisma.barberBotUsage.findUnique({
    where: { barbershopId_day: { barbershopId: t.id, day: barberTodayISO(TZ) } },
  });
  return Number(row?.spentMicros ?? 0);
}
const ultimoEnvio = () => enviados()[enviados().length - 1];

/* ═══════════════ Agendar tocando botones, de punta a punta ═══════════════ */

test("🔴 agenda por WhatsApp de punta a punta: lista de servicios → horarios → cita REAL", { skip }, async () => {
  const phone = telefono();

  // ── Turno 1: «quiero cita» → el bot ofrece los servicios con botones ──
  modelQueue.push(useTool("listar_servicios", {}));
  modelQueue.push((seen) => {
    const cat = seen[seen.length - 1];
    return useTool("responder_con_opciones", {
      texto: "¡Qué onda! ¿Qué te vas a hacer?",
      opciones: cat.servicios.map((s: any) => ({
        titulo: s.nombre,
        descripcion: `${s.precio} · ${s.duracionMin} min`,
      })),
    });
  });
  await escribe(P, phone, "hola, quiero una cita");

  const m1 = ultimoEnvio();
  assert.equal(m1.body.type, "interactive", "sale con botones, no solo texto");
  assert.equal(m1.body.interactive.type, "button", "dos servicios caben en botones (máx. 3)");
  const botones = m1.body.interactive.action.buttons.map((b: any) => b.reply);
  assert.deepEqual(
    botones.map((b: any) => b.title),
    ["Barba", "Corte de caballero"],
    "los servicios salen del catálogo real de la barbería, en su orden",
  );
  assert.deepEqual(botones.map((b: any) => b.id), ["bot:1", "bot:2"]);
  assert.equal(m1.body.interactive.body.text, "¡Qué onda! ¿Qué te vas a hacer?");
  assert.equal(modelRequests.length, 2, "responder_con_opciones cierra el turno: no hay tercera llamada");

  const filas1 = await mensajes(P, phone);
  assert.match(filas1[filas1.length - 1].body ?? "", /🔘 Opciones: Barba · Corte de caballero/);

  // ── Turno 2: TOCA «Corte de caballero» → horarios de mañana en lista ──
  modelQueue.push(() => useTool("buscar_horarios", { fecha: MANANA, servicioIds: [P.corteId] }));
  modelQueue.push((seen) => {
    const h = seen[seen.length - 1].horarios.slice(0, 5);
    return useTool("responder_con_opciones", {
      texto: `Va. Para mañana tengo estos horarios, ¿cuál te late?`,
      opciones: h.map((x: any) => ({ titulo: x.comoSeDice, descripcion: "mañana" })),
    });
  });
  const t2 = entranteToque(P, phone, { id: "bot:2", title: "Corte de caballero" });
  await ingestBarberInbound(t2.value, t2.msg);

  const m2 = ultimoEnvio();
  assert.equal(m2.body.interactive.type, "list", "cinco horarios no caben en botones: va lista");
  const rows = m2.body.interactive.action.sections[0].rows;
  assert.equal(rows.length, 5);
  assert.ok(rows.length <= 10, "nunca más de 10 filas (límite de Meta)");
  const huecos = toolResults.find((r) => r && r.horarios)?.horarios ?? [];
  assert.deepEqual(
    rows.map((r: any) => r.title),
    huecos.slice(0, 5).map((h: any) => h.comoSeDice),
    "los horarios ofrecidos son los del motor de agenda",
  );
  // Lo que el modelo leyó como mensaje del cliente fue el título del botón.
  const ultimoUsuario = modelRequests[2].messages.filter((m: any) => m.role === "user").pop();
  assert.equal(ultimoUsuario.content, "Corte de caballero");

  // ── Turno 3: TOCA la primera hora → el modelo agenda ──
  const elegida = huecos[0];
  modelQueue.push(
    useTool("agendar", {
      fecha: MANANA,
      hora: elegida.hora,
      servicioIds: [P.corteId],
      nombre: "Rafa Méndez",
    }),
  );
  modelQueue.push((seen) => {
    const r = seen[seen.length - 1];
    return say(`Listo Rafa, quedas el ${r.fechaBonita} a las ${r.horaBonita}. Folio ${r.referencia}.`);
  });
  const t3 = entranteToque(P, phone, { id: "bot:1", title: elegida.comoSeDice }, "list_reply");
  await ingestBarberInbound(t3.value, t3.msg);

  const cita = await prisma.barberAppointment.findFirst({
    where: { barbershopId: P.id, clientPhone: phone },
    include: { services: true },
  });
  assert.ok(cita, "la cita existe en la agenda");
  assert.equal(cita.source, "WHATSAPP");
  assert.equal(cita.clientName, "Rafa Méndez");
  assert.equal(cita.barberId, P.barberId, "con un barbero concreto, no «cualquiera»");
  assert.equal(Number(cita.services[0].priceAtBooking), 180);
  assert.equal(ultimoEnvio().body.type, "text");
  assert.match(ultimoEnvio().body.text.body, /Listo Rafa/);

  // Cada mensaje del bot contó contra el cupo del plan… que aquí es ilimitado,
  // pero el contador se mueve igual.
  const shop = await prisma.barbershop.findUniqueOrThrow({ where: { id: P.id } });
  assert.ok(shop.messagesUsedPeriod >= 3);
});

test("🔴 tocar «Sí» en una pregunta del bot NO confirma la visita del recordatorio", { skip }, async () => {
  const phone = telefono();
  const cita = await crearCita(P, { phone, enMinutos: 6 * 60 });
  // El recordatorio es LO ÚLTIMO que le dijimos: un «Sí» escrito lo confirmaría.
  await prisma.barberMessage.create({
    data: {
      barbershopId: P.id,
      direction: "OUTBOUND",
      phone,
      body: "Hola Luis, te recordamos tu visita…",
      templateName: barberWaTemplate("reminder").name,
      status: "DELIVERED",
      appointmentId: cita.id,
    },
  });
  modelQueue.push(say("¡Va! ¿Para qué día la quieres?"));
  const toque = entranteToque(P, phone, { id: "bot:1", title: "Sí" });
  await ingestBarberInbound(toque.value, toque.msg);

  assert.equal(
    (await prisma.barberAppointment.findUniqueOrThrow({ where: { id: cita.id } })).status,
    "PENDING",
    "el toque llevaba el id del bot: no es una respuesta al recordatorio",
  );
  assert.equal(modelRequests.length, 1, "lo atendió el bot");
  assert.match(ultimoEnvio().body.text.body, /¿Para qué día/);
});

test("si Meta rechaza los botones, el MISMO mensaje sale como texto con las opciones numeradas", { skip }, async () => {
  const phone = telefono();
  modelQueue.push(
    useTool("responder_con_opciones", {
      texto: "¿Qué te vas a hacer?",
      opciones: [{ titulo: "Corte" }, { titulo: "Barba", descripcion: "$120" }],
    }),
  );
  onGraph((call) =>
    call.body?.type === "interactive"
      ? { status: 400, json: { error: { code: 131009, message: "(#131009) Parameter value is not valid" } } }
      : null,
  );
  await escribe(P, phone, "hola");

  const salidas = enviados();
  assert.equal(salidas.length, 2, "un intento con botones y el respaldo");
  assert.equal(salidas[0].body.type, "interactive");
  assert.equal(salidas[1].body.type, "text");
  assert.equal(salidas[1].body.text.body, "¿Qué te vas a hacer?\n\n1. Corte\n2. Barba — $120");

  const filas = (await mensajes(P, phone)).filter((r) => r.direction === "OUTBOUND");
  assert.equal(filas.length, 1, "en la bandeja queda UN mensaje");
  assert.equal(filas[0].status, "SENT");
  assert.equal(filas[0].body, "¿Qué te vas a hacer?\n\n1. Corte\n2. Barba — $120", "y es lo que el cliente leyó");
});

test("opciones inválidas (una sola, o repetidas) salen como texto normal, sin botón roto", { skip }, async () => {
  const phone = telefono();
  modelQueue.push(
    useTool("responder_con_opciones", {
      texto: "Solo me queda este horario: 5 pm.",
      opciones: [{ titulo: "5 pm" }, { titulo: "5 PM" }, { titulo: "" }],
    }),
  );
  await escribe(P, phone, "¿tienes algo hoy?");
  assert.equal(ultimoEnvio().body.type, "text");
  assert.equal(ultimoEnvio().body.text.body, "Solo me queda este horario: 5 pm.");
});

/* ═══════════════ El modelo ═══════════════ */

test("🔴 el bot llama a Sonnet 5 (el del dental), con razonamiento al mínimo, y se cobra a su tarifa", { skip }, async () => {
  const antes = await gastoDeHoy(P);
  modelQueue.push(say("¡Qué onda! ¿En qué te ayudo?"));
  await escribe(P, telefono(), "buenas");

  const [req] = modelRequests;
  assert.equal(req.model, "claude-sonnet-5");
  assert.deepEqual(req.raw.thinking, { type: "adaptive" });
  assert.deepEqual(req.raw.output_config, { effort: "low" });
  assert.equal(req.raw.temperature, undefined, "Sonnet 5 rechaza temperature");
  assert.ok(req.raw.max_tokens >= 1500, "con margen para el razonamiento y el tokenizador nuevo");
  assert.ok(
    req.raw.tools.some((t: any) => t.name === "responder_con_opciones"),
    "tiene la herramienta de botones",
  );
  assert.equal((await gastoDeHoy(P)) - antes, COSTO_LLAMADA, "2 / 10 USD por millón, no 3 / 15");

  // Sigue siendo configurable por env, sin redeploy.
  process.env.BARBER_BOT_AI_MODEL = "claude-sonnet-4-6";
  try {
    limpiar();
    modelQueue.push(say("Hola."));
    await escribe(P, telefono(), "hola");
    assert.equal(modelRequests[0].model, "claude-sonnet-4-6");
    assert.equal(modelRequests[0].raw.thinking, undefined, "a un 4.x no se le manda thinking");
    assert.equal(modelRequests[0].raw.output_config, undefined);
  } finally {
    delete process.env.BARBER_BOT_AI_MODEL;
  }
});

test("en la última vuelta el modelo ya no puede pedir herramientas (tool_choice none)", { skip }, async () => {
  const phone = telefono();
  // Cuatro vueltas pidiendo herramientas: la quinta tiene que contestar.
  for (let i = 0; i < 4; i++) modelQueue.push(useTool("listar_servicios", {}));
  modelQueue.push(say("Tenemos corte y barba."));
  await escribe(P, phone, "¿qué servicios tienen?");

  assert.equal(modelRequests.length, 5);
  assert.equal(modelRequests[3].raw.tool_choice, undefined);
  assert.deepEqual(modelRequests[4].raw.tool_choice, { type: "none" });
  assert.ok(modelRequests[4].raw.tools.length > 0, "las herramientas siguen declaradas (el hilo las nombra)");
  assert.match(ultimoEnvio().body.text.body, /corte y barba/);
});

/* ═══════════════ Cuando la IA falla a media tarea ═══════════════ */

test("🔴 el modelo agenda y luego la IA se cae: el cliente recibe la confirmación, no «te paso con alguien»", { skip }, async () => {
  const phone = telefono();
  const cliente = await crearCliente(P, phone, "Memo Ruiz");
  modelQueue.push(() => useTool("buscar_horarios", { fecha: addIsoDays(MANANA, 1), servicioIds: [P.barbaId] }));
  modelQueue.push((seen) =>
    useTool("agendar", {
      fecha: addIsoDays(MANANA, 1),
      hora: seen[seen.length - 1].horarios[0].hora,
      servicioIds: [P.barbaId],
      nombre: "Memo Ruiz",
    }),
  );
  // La tercera llamada (la que iba a redactar la respuesta) falla dos veces.
  let llamadas = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url).includes("api.anthropic.com") && ++llamadas >= 3) {
      return new Response(JSON.stringify({ error: { type: "overloaded_error" } }), { status: 529 });
    }
    return original(url, init);
  }) as typeof fetch;
  try {
    await escribe(P, phone, "agéndame la barba pasado mañana a primera hora");
  } finally {
    globalThis.fetch = original;
  }

  const cita = await prisma.barberAppointment.findFirst({ where: { barbershopId: P.id, clientId: cliente.id } });
  assert.ok(cita, "la cita SÍ se creó");
  const texto = ultimoEnvio().body.text.body as string;
  assert.match(texto, /✅ Tu cita quedó (apartada|confirmada) para el/);
  assert.match(texto, /Tu folio es /);
  assert.ok(!/paso esto con alguien/.test(texto));
  assert.equal(llamadas, 4, "la llamada caída se reintentó UNA vez");
  assert.equal(
    (await listBarberBotPauses(P.id)).some((p) => p.phone === phone),
    false,
    "y el hilo no se queda en pausa: no hay nada que una persona tenga que arreglar",
  );
});

/* ═══════════════ Pausas: el bot no se apaga solo para siempre ═══════════════ */

test("🔴 fuera de horario avisa UNA vez, y al volver el horario el bot vuelve solo", { skip }, async () => {
  const phone = telefono();
  // Ningún día activo: siempre fuera de horario.
  await saveBarberBotSettings(P.id, { ...BOT_ON, hours: { mode: "custom", days: [] } });
  try {
    await escribe(P, phone, "¿tienen lugar mañana?");
    assert.equal(enviados().length, 1);
    assert.match(ultimoEnvio().body.text.body, /Ahorita no estamos en línea/);
    assert.equal(modelRequests.length, 0, "sin gastar IA");
    const [pausa] = (await listBarberBotPauses(P.id)).filter((p) => p.phone === phone);
    assert.equal(pausa.reason, BARBER_BOT_PAUSE_OFF_HOURS);
    assert.equal(isAutoBotPause(pausa.reason), true);

    // Segundo mensaje, todavía fuera de horario: silencio (no se repite el aviso).
    limpiar();
    await escribe(P, phone, "¿hola?");
    assert.equal(enviados().length, 0);
  } finally {
    await saveBarberBotSettings(P.id, BOT_ON);
  }

  // Ya en horario: el siguiente mensaje lo atiende el bot y la pausa se va.
  limpiar();
  modelQueue.push(say("¡Buenos días! Sí hay lugar, ¿a qué hora te queda?"));
  await escribe(P, phone, "buenos días");
  assert.equal(modelRequests.length, 1);
  assert.match(ultimoEnvio().body.text.body, /Sí hay lugar/);
  assert.equal((await listBarberBotPauses(P.id)).some((p) => p.phone === phone), false);
});

test("🔴 una pausa del bot caduca a las 12 h; la de una persona, nunca", { skip }, async () => {
  const horas = (n: number) => new Date(Date.now() - n * 3_600_000);
  const reciente = telefono();
  const vieja = telefono();
  const dePersona = telefono();
  await prisma.barberBotPause.createMany({
    data: [
      { barbershopId: P.id, phone: reciente, reason: "🤖 El cliente pidió hablar con una persona", pausedAt: horas(2) },
      { barbershopId: P.id, phone: vieja, reason: "🤖 El bot no pudo responder", pausedAt: horas(13) },
      { barbershopId: P.id, phone: dePersona, reason: "La barbería tomó la conversación", pausedAt: horas(72) },
    ],
  });

  assert.deepEqual(await barberBotGate(P.id, reciente), { open: false, reason: "paused" });
  assert.deepEqual(await barberBotGate(P.id, vieja), { open: true, reason: null });
  assert.deepEqual(await barberBotGate(P.id, dePersona), { open: false, reason: "paused" });

  modelQueue.push(say("Aquí sigo, ¿qué necesitas?"));
  await escribe(P, vieja, "oigan");
  assert.equal(modelRequests.length, 1, "nadie tomó la conversación en 12 h: el bot vuelve");
  await escribe(P, reciente, "oigan");
  await escribe(P, dePersona, "oigan");
  assert.equal(modelRequests.length, 1, "las otras dos siguen en manos de una persona");
});

test("🔴 si alguien de la barbería contesta a mano, el bot se calla en ese hilo", { skip }, async () => {
  const phone = telefono();
  modelQueue.push(say("¡Hola! ¿En qué te ayudo?"));
  await escribe(P, phone, "hola");
  assert.equal(modelRequests.length, 1);

  const r = await sendBarberManualMessage({ barbershopId: P.id, phone, body: "Soy Beto, yo te atiendo." });
  assert.equal(r.ok, true);
  const [pausa] = (await listBarberBotPauses(P.id)).filter((p) => p.phone === phone);
  assert.ok(pausa, "el hilo queda en pausa");
  assert.equal(isAutoBotPause(pausa.reason), false, "es una pausa de PERSONA: no caduca sola");

  limpiar();
  await escribe(P, phone, "va, ¿a qué hora?");
  assert.equal(modelRequests.length, 0, "el bot no le pisa la respuesta");
  assert.equal(enviados().length, 0);
});

test("pedir una persona pausa el hilo sin gastar IA; y el bot no lee lo que nunca llegó", { skip }, async () => {
  const phone = telefono();
  // Un recordatorio en cola (PENDING) y una respuesta que Meta rechazó (FAILED):
  // ninguna de las dos la leyó el cliente.
  await prisma.barberMessage.createMany({
    data: [
      { barbershopId: P.id, direction: "OUTBOUND", phone, body: "RECORDATORIO EN COLA", status: "PENDING" },
      { barbershopId: P.id, direction: "OUTBOUND", phone, body: "RESPUESTA RECHAZADA", status: "FAILED" },
    ],
  });
  modelQueue.push(say("¡Hola!"));
  await escribe(P, phone, "hola");
  const hilo = JSON.stringify(modelRequests[0].messages);
  assert.ok(!hilo.includes("RECORDATORIO EN COLA") && !hilo.includes("RESPUESTA RECHAZADA"));

  limpiar();
  await escribe(P, phone, "quiero hablar con una persona");
  assert.equal(modelRequests.length, 0);
  assert.match(ultimoEnvio().body.text.body, /Ya le avisé a alguien de la barbería/);
  const [pausa] = (await listBarberBotPauses(P.id)).filter((p) => p.phone === phone);
  assert.equal(isAutoBotPause(pausa.reason), true, "pausa del bot: si nadie la toma, caduca a las 12 h");
});

/* ═══════════════ Notas de voz ═══════════════ */

test("🔴 una nota de voz se transcribe, el bot la atiende como texto y el costo va al tope de IA", { skip }, async () => {
  const phone = telefono();
  const antes = await gastoDeHoy(P);
  setWhisper({ text: "  Hola, quiero un corte  mañana en la tarde ", duration: 6 });
  modelQueue.push(say("¡Va! Mañana en la tarde tengo lugar, ¿a qué hora te queda?"));

  const { value, msg } = entranteVoz(P, phone);
  assert.equal(await ingestBarberInbound(value, msg), true);

  assert.equal(whisperCalls, 1);
  const [entrada] = (await mensajes(P, phone)).filter((r) => r.direction === "INBOUND");
  assert.equal(entrada.body, "🎤 Nota de voz: Hola, quiero un corte mañana en la tarde");
  assert.ok(entrada.templateName?.startsWith("attach:"), "el audio se conserva en la bandeja (por media id)");

  // El modelo leyó la transcripción como mensaje del cliente.
  const ultimoUsuario = modelRequests[0].messages.filter((m: any) => m.role === "user").pop();
  assert.match(ultimoUsuario.content, /quiero un corte mañana en la tarde/);
  assert.match(ultimoEnvio().body.text.body, /Mañana en la tarde tengo lugar/);

  // El costo: transcripción (6 s) + una llamada al modelo, en barber_bot_usage.
  assert.equal((await gastoDeHoy(P)) - antes, botVoiceCostMicros(6, 18) + COSTO_LLAMADA);
});

test("🔴 G1 — lo que dice una nota de voz NUNCA decide sobre el recordatorio: va al bot", { skip }, async () => {
  const recordada = async (phone: string) => {
    const cita = await crearCita(P, { phone, enMinutos: 7 * 60 });
    await prisma.barberMessage.create({
      data: {
        barbershopId: P.id,
        direction: "OUTBOUND",
        phone,
        body: "Hola Luis, te recordamos tu visita…",
        templateName: barberWaTemplate("reminder").name,
        status: "READ",
        appointmentId: cita.id,
      },
    });
    return cita;
  };
  const estado = async (id: string) =>
    (await prisma.barberAppointment.findUniqueOrThrow({ where: { id } })).status;

  // Aunque el transcriptor devuelva EXACTAMENTE la palabra que, escrita,
  // confirmaría o pediría cancelar: por voz no cuenta.
  for (const oido of ["Cancelar", "confirmar", "Sí", "No puedo ir, cancela"]) {
    limpiar();
    const phone = telefono();
    const cita = await recordada(phone);
    setWhisper({ text: oido, duration: 2 });
    modelQueue.push(say("Te escuché. ¿Quieres que revise tu visita?"));
    const { value, msg } = entranteVoz(P, phone);
    await ingestBarberInbound(value, msg);

    assert.equal(await estado(cita.id), "PENDING", `oír «${oido}» no toca la visita`);
    assert.equal(modelRequests.length, 1, "lo atendió el bot");
    assert.match(ultimoEnvio().body.text.body, /Te escuché/);
    assert.ok(!/¿Cancelo tu visita|está confirmada|quedó cancelada/.test(ultimoEnvio().body.text.body));
  }
});

test("🔴 el bot tampoco cancela ni mueve a menos de 2 horas: contesta con el teléfono de la barbería", { skip }, async () => {
  const aviso = /Para cambios de última hora llama a la barbería: 55 1234 5678\./;
  const estado = async (id: string) =>
    (await prisma.barberAppointment.findUniqueOrThrow({ where: { id } })).status;

  // Cancelar una visita que empieza en 90 minutos.
  const p1 = telefono();
  const c1 = await crearCita(P, { phone: p1, enMinutos: 90 });
  modelQueue.push(useTool("cancelar", { citaId: c1.id }));
  await escribe(P, p1, "cancela mi cita de al rato");
  assert.equal(await estado(c1.id), "PENDING", "la cita sigue en pie");
  assert.match(ultimoEnvio().body.text.body, aviso);
  assert.equal(modelRequests.length, 1, "el aviso sale tal cual, sin otra vuelta del modelo");

  // Moverla, igual.
  limpiar();
  const p2 = telefono();
  const c2 = await crearCita(P, { phone: p2, enMinutos: 100 });
  const antes = (await prisma.barberAppointment.findUniqueOrThrow({ where: { id: c2.id } })).startAt;
  modelQueue.push(useTool("reagendar", { citaId: c2.id, fecha: MANANA, hora: "17:00" }));
  await escribe(P, p2, "pásala a mañana a las 5");
  const despues = (await prisma.barberAppointment.findUniqueOrThrow({ where: { id: c2.id } })).startAt;
  assert.equal(despues.getTime(), antes.getTime(), "no se movió");
  assert.match(ultimoEnvio().body.text.body, aviso);

  // Con más de 2 horas, cancelar funciona como siempre.
  limpiar();
  const p3 = telefono();
  const c3 = await crearCita(P, { phone: p3, enMinutos: 5 * 60 });
  modelQueue.push(useTool("cancelar", { citaId: c3.id }));
  modelQueue.push(say("Listo, quedó cancelada."));
  await escribe(P, p3, "cancela mi cita");
  assert.equal(await estado(c3.id), "CANCELLED");
});

test("audio demasiado largo o que no se pudo escuchar: se le pide que lo escriba", { skip }, async () => {
  // 4 minutos: ni se manda a transcribir.
  const p1 = telefono();
  setAudio(oggDe(240));
  let v = entranteVoz(P, p1);
  await ingestBarberInbound(v.value, v.msg);
  assert.equal(whisperCalls, 0, "no se paga por un audio que no se va a usar");
  assert.equal(ultimoEnvio().body.text.body, BARBER_WA_VOICE_TOO_LONG_REPLY);
  assert.match((await mensajes(P, p1))[0].body ?? "", /el bot no la transcribió/);
  assert.equal(modelRequests.length, 0);

  // El transcriptor falla.
  limpiar();
  const p2 = telefono();
  setWhisper(null);
  v = entranteVoz(P, p2);
  await ingestBarberInbound(v.value, v.msg);
  assert.equal(ultimoEnvio().body.text.body, BARBER_WA_VOICE_FAILED_REPLY);
  assert.equal(modelRequests.length, 0);
  for (const texto of [BARBER_WA_VOICE_TOO_LONG_REPLY, BARBER_WA_VOICE_FAILED_REPLY]) {
    assert.ok(!/cl[ií]nica/i.test(texto), "los avisos hablan de la barbería, no del dental");
  }
});

test("🔴 con el bot apagado, en pausa o sin tope de IA, el audio NO se transcribe (no se gasta)", { skip }, async () => {
  // Bot apagado.
  const apagada = await crearTienda({ plan: "PROFESIONAL" });
  let v = entranteVoz(apagada, telefono());
  assert.equal(await ingestBarberInbound(v.value, v.msg), true);

  // Plan sin bot (Avanzado), aunque lo tenga "encendido".
  const avanzado = await crearTienda({ plan: "AVANZADO" });
  await saveBarberBotSettings(avanzado.id, BOT_ON);
  v = entranteVoz(avanzado, telefono());
  await ingestBarberInbound(v.value, v.msg);

  // Hilo en manos de una persona.
  const enPausa = telefono();
  await prisma.barberBotPause.create({
    data: { barbershopId: P.id, phone: enPausa, reason: "La barbería tomó la conversación" },
  });
  v = entranteVoz(P, enPausa);
  await ingestBarberInbound(v.value, v.msg);

  // Tope diario de IA en cero.
  const sinTope = await crearTienda({ plan: "PROFESIONAL" });
  await saveBarberBotSettings(sinTope.id, { ...BOT_ON, aiDailyCapMxn: 0 });
  v = entranteVoz(sinTope, telefono());
  await ingestBarberInbound(v.value, v.msg);

  assert.equal(whisperCalls, 0, "ninguno se mandó a transcribir");
  assert.equal(modelRequests.length, 0);
  assert.equal(enviados().length, 0, "y no se le promete nada al cliente: el audio queda para el equipo");
  const fila = (await mensajes(P, enPausa))[0];
  assert.equal(fila.body, "🎤 Te mandaron una nota de voz");
  assert.equal(await gastoDeHoy(sinTope), 0);
});

test("sin OPENAI_API_KEY no se rompe nada: el audio queda en la bandeja como antes", { skip }, async () => {
  const guardada = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const phone = telefono();
    const v = entranteVoz(P, phone);
    assert.equal(await ingestBarberInbound(v.value, v.msg), true);
    assert.equal(whisperCalls, 0);
    assert.equal(enviados().length, 0);
    assert.equal((await mensajes(P, phone))[0].body, "🎤 Te mandaron una nota de voz");
  } finally {
    process.env.OPENAI_API_KEY = guardada;
  }
});

test("nota de voz fuera del horario del bot: no se transcribe, pero recibe el aviso de horario", { skip }, async () => {
  const phone = telefono();
  await saveBarberBotSettings(P.id, { ...BOT_ON, hours: { mode: "custom", days: [] } });
  try {
    const v = entranteVoz(P, phone);
    await ingestBarberInbound(v.value, v.msg);
    assert.equal(whisperCalls, 0);
    assert.match(ultimoEnvio().body.text.body, /Ahorita no estamos en línea/);
  } finally {
    await saveBarberBotSettings(P.id, BOT_ON);
  }
});

/* ═══════════════ Las herramientas contra la agenda real ═══════════════ */

test("mis_citas y cancelar encuentran la cita por la FICHA aunque el teléfono de la cita sea otro", { skip }, async () => {
  const phone = telefono();
  const cliente = await crearCliente(P, phone, "Paco Díaz");
  // Cita creada en el panel cuando la ficha tenía otro número.
  const cita = await crearCita(P, { phone: telefono(), enMinutos: 30 * 60, clientId: cliente.id });

  modelQueue.push(useTool("mis_citas", {}));
  modelQueue.push((seen) => useTool("cancelar", { citaId: seen[seen.length - 1].citas[0].citaId }));
  modelQueue.push(say("Listo Paco, quedó cancelada."));
  await escribe(P, phone, "cancela mi cita porfa");

  const vistas = toolResults.find((r) => r && r.citas);
  assert.equal(vistas.citas.length, 1, "el bot ve la cita del cliente");
  assert.equal(
    (await prisma.barberAppointment.findUniqueOrThrow({ where: { id: cita.id } })).status,
    "CANCELLED",
  );
});

test("el bot no toca la cita de OTRO teléfono aunque el modelo le pase el id", { skip }, async () => {
  const ajena = await crearCita(P, { phone: telefono(), enMinutos: 40 * 60 });
  const phone = telefono();
  modelQueue.push(useTool("cancelar", { citaId: ajena.id }));
  modelQueue.push(say("No encontré una cita a tu nombre."));
  await escribe(P, phone, "cancela la cita");

  const r = toolResults.find((x) => x && x.error);
  assert.match(r.error, /No encontré esa cita/);
  assert.equal(
    (await prisma.barberAppointment.findUniqueOrThrow({ where: { id: ajena.id } })).status,
    "PENDING",
  );
});

test("una sucursal hereda el plan de su matriz: el bot contesta", { skip }, async () => {
  const matriz = await crearTienda({ plan: "PROFESIONAL", conectada: false });
  const sucursal = await crearTienda({ plan: "BASICO" });
  await prisma.barbershop.update({ where: { id: sucursal.id }, data: { parentId: matriz.id } });
  await saveBarberBotSettings(sucursal.id, BOT_ON);

  modelQueue.push(say("¡Hola! Aquí la sucursal."));
  const phone = telefono();
  await prisma.barberMessage.create({
    data: { barbershopId: sucursal.id, direction: "INBOUND", phone, body: "hola", status: "DELIVERED" },
  });
  const turno = await runBarberBotTurn({ barbershopId: sucursal.id, phone, text: "hola" });
  assert.equal(turno.skipped, null);
  assert.match(turno.reply ?? "", /Aquí la sucursal/);

  // …y si la matriz deja de pagar, la sucursal tampoco tiene bot.
  await prisma.barbershop.update({ where: { id: matriz.id }, data: { subscriptionStatus: "canceled" } });
  const sinPago = await runBarberBotTurn({ barbershopId: sucursal.id, phone, text: "hola" });
  assert.equal(sinPago.reply, null);
  assert.equal(sinPago.skipped, "subscriptionInactive");
});
