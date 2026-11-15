/**
 * DaleControl BARBER — pruebas OFFLINE del WhatsApp del vertical.
 *
 * Run (sin BD, sin red, sin Meta):
 *   npx tsx --test src/lib/barber/__tests__/whatsapp.test.ts
 *
 * Qué fijan estas pruebas (todas salen de algo que YA falló en el dental o de
 * una regla de Meta que cuesta dinero romper):
 *
 *  1. TODO lo transaccional sale como `utility`. Meta cobra por mensaje
 *     entregado y `marketing` cuesta ~4x; mandar un recordatorio como
 *     promoción cuadruplicaría la factura de cada barbería. Las de promoción,
 *     además, son `optional`: nunca se dan de alta ni se mandan solas.
 *  2. Los cuerpos cumplen las reglas de Meta (ni empiezan ni terminan con
 *     variable, sin dos variables seguidas, un ejemplo por variable). Romper
 *     una hace que Meta RECHACE la plantilla y la barbería se queda muda.
 *  3. El bug M-22 del dental (al reagendar llega el aviso de la hora vieja)
 *     no se repite: solo una fila invalidada por T1 deja programar de nuevo.
 *  4. El bug M-06/M-10 (un rechazo pintado como "entregado") no se repite:
 *     el estado nunca retrocede y FAILED no se sobrescribe.
 *  5. La clasificación de la respuesta no cancela citas por accidente.
 *  6. Nada de lo que manda un cliente desaparece en silencio.
 *  7. Terminología del vertical: cero "paciente", "doctor", "clínica"…
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  BARBER_WA_ARCHIVE_MARK,
  BARBER_WA_CLAIM_STALE_MS,
  BARBER_WA_PARAM_MAX,
  BARBER_WA_PRICE_USD,
  BARBER_WA_TEMPLATES,
  BARBER_WA_UNARCHIVE_MARK,
  BARBER_WALKIN_NOTICE_TTL_MS,
  barberClientOptedOut,
  barberOutboxStaleReason,
  barberWaClaimMark,
  barberWaFits,
  barberWaOptionsAsText,
  barberWaTemplate,
  barberWaTemplateByName,
  barberWaWindowOpen,
  buildBarberWaQuota,
  checkBarberWaTemplate,
  classifyBarberReply,
  countBarberWaVariables,
  encodeBarberWaAttachment,
  isBarberNoReply,
  isBarberOptOutText,
  isBarberUnacceptedRequest,
  isBarberWaAskRow,
  isBarberWaClaim,
  isBarberWaSysRow,
  isBarberWaUnlimited,
  isBarberWaLinked,
  isBarberYesReply,
  nextBarberWaStatus,
  normalizeBarberReply,
  parseBarberReminderButton,
  parseBarberWaAttachment,
  parseBarberWaClaim,
  reminderAlreadyHandled,
  sanitizeBarberWaParam,
  walkInTemplateNotice,
  BARBER_REMINDER_TEMPLATE_BUTTONS,
  BARBER_REQUEST_SOURCES,
  BARBER_WA_CANCEL_ASK,
  BARBER_WA_CHANGE_NOTICE_HOURS,
  barberCancelAskButtons,
  barberLateChangeReply,
  barberReminderButtons,
  barberTooLateToChange,
  decideBarberReminderReply,
  decideBarberBotTurn,
  barberBotReplyIsStale,
  barberBotTurnMark,
  parseBarberBotTurnMark,
  isBarberBotTurnMark,
  BARBER_WA_TURN_PREFIX,
  type BarberWaAttachment,
} from "@/lib/barber/whatsapp-core";
import { BARBER_CANCEL_WINDOW_HOURS } from "@/lib/barber/portal-core";
import {
  isInvalidatedReminder,
  BARBER_REMINDER_INVALIDATED_MARK,
  walkInNotifyBody,
} from "@/lib/barber/agenda";

/* ═══════════════ 1. CATEGORÍAS: la factura de la barbería ═════════════ */

test("todo lo transaccional es `utility` — nada se cuela como marketing", () => {
  const esperado: Record<string, string> = {
    reminder: "UTILITY",
    reminderButtons: "UTILITY",
    walkinTurn: "UTILITY",
    bookingConfirmed: "UTILITY",
    // Meta EXIGE authentication para un código de un solo uso; mandarlo como
    // utilidad se rechaza.
    portalCode: "AUTHENTICATION",
    // Promoción real, y solo eso.
    birthday: "MARKETING",
    winback: "MARKETING",
  };
  for (const tpl of BARBER_WA_TEMPLATES) {
    assert.equal(tpl.category, esperado[tpl.kind], `plantilla ${tpl.kind}`);
  }
  // Y no hay ninguna más que la lista de arriba.
  assert.deepEqual(
    BARBER_WA_TEMPLATES.map((t) => t.kind).sort(),
    Object.keys(esperado).sort(),
  );
});

test("solo las de MARKETING son opcionales: las demás se dan de alta solas", () => {
  for (const tpl of BARBER_WA_TEMPLATES) {
    assert.equal(
      tpl.optional,
      tpl.category === "MARKETING",
      `${tpl.name} debería ser optional solo si es marketing`,
    );
  }
});

test("marketing cuesta ~4x que utility (por eso nunca se manda sola)", () => {
  assert.ok(
    BARBER_WA_PRICE_USD.MARKETING > BARBER_WA_PRICE_USD.UTILITY * 3,
    "si esto deja de ser cierto, revisar el copy que se le enseña a la barbería",
  );
});

test("prefijo propio dc_barber_: jamás se pisa una plantilla del dental", () => {
  for (const tpl of BARBER_WA_TEMPLATES) {
    assert.ok(tpl.name.startsWith("dc_barber_"), tpl.name);
  }
});

/* ═══════════════ 2. REGLAS DE META SOBRE EL CUERPO ═══════════════════ */

test("el catálogo entero pasa las reglas de Meta", () => {
  for (const tpl of BARBER_WA_TEMPLATES) {
    assert.equal(checkBarberWaTemplate(tpl), null, `${tpl.name}: ${checkBarberWaTemplate(tpl)}`);
  }
});

test("checkBarberWaTemplate DELATA los cuerpos que Meta rechazaría", () => {
  const base = barberWaTemplate("walkinTurn");
  const empieza = { ...base, body: "{{1}} ya casi es tu turno en {{2}}. Ven.", sample: ["a", "b"], variables: ["a", "b"] };
  assert.match(String(checkBarberWaTemplate(empieza)), /empezar/);

  const termina = { ...base, body: "Hola {{1}}, ya casi es tu turno en {{2}}", sample: ["a", "b"], variables: ["a", "b"] };
  assert.match(String(checkBarberWaTemplate(termina)), /terminar/);

  const seguidas = { ...base, body: "Hola {{1}} {{2}}, ya casi. Ven.", sample: ["a", "b"], variables: ["a", "b"] };
  assert.match(String(checkBarberWaTemplate(seguidas)), /seguidas/);

  const sinEjemplo = { ...base, body: "Hola {{1}}, ya casi es tu turno en {{2}}. Ven.", sample: ["a"], variables: ["a", "b"] };
  assert.match(String(checkBarberWaTemplate(sinEjemplo)), /ejemplo/);

  const nombreMalo = { ...base, name: "DC-Barber Turno" };
  assert.match(String(checkBarberWaTemplate(nombreMalo)), /nombre/);
});

test("la de autenticación NO lleva cuerpo propio (lo redacta Meta)", () => {
  const tpl = barberWaTemplate("portalCode");
  assert.equal(tpl.body, "");
  assert.equal(checkBarberWaTemplate(tpl), null);
  assert.match(String(checkBarberWaTemplate({ ...tpl, body: "Tu código es {{1}}." })), /autenticación/);
});

test("countBarberWaVariables cuenta variables DISTINTAS, no repeticiones", () => {
  assert.equal(countBarberWaVariables("Hola {{1}}, te esperamos {{2}}. Saludos {{1}}."), 2);
  assert.equal(countBarberWaVariables("Sin variables."), 0);
});

test("barberWaTemplateByName encuentra por el nombre exacto de Meta", () => {
  assert.equal(barberWaTemplateByName("dc_barber_recordatorio_cita")?.kind, "reminder");
  assert.equal(barberWaTemplateByName("no_existe"), null);
});

test("🔴 CONTRATO: la cantidad de variables es la que pasa el emisor (132000)", () => {
  // Meta sustituye por POSICIÓN y rechaza con 132000 si la cantidad no
  // coincide con la plantilla aprobada. Estos números son el contrato con
  // src/lib/barber/whatsapp.ts:
  //   reminder          → reminderParamsFrom()          devuelve 6
  //   bookingConfirmed  → bookingParamsFrom()           devuelve 4
  //   walkinTurn        → [shop.name, row.body]         son 2
  //   portalCode        → [code]                        es 1
  //   birthday/winback  → [cliente, barbería, promo]    son 3
  const contrato: Record<string, number> = {
    reminder: 6,
    // La de botones lleva los MISMOS seis parámetros (reminderParamsFrom).
    reminderButtons: 6,
    bookingConfirmed: 4,
    walkinTurn: 2,
    portalCode: 1,
    birthday: 3,
    winback: 3,
  };
  for (const tpl of BARBER_WA_TEMPLATES) {
    assert.equal(tpl.variables.length, contrato[tpl.kind], `variables de ${tpl.kind}`);
    assert.ok(tpl.sample.length >= contrato[tpl.kind], `ejemplos de ${tpl.kind}`);
    if (tpl.category !== "AUTHENTICATION") {
      // En las de autenticación el cuerpo lo pone Meta y no lleva {{n}}.
      assert.equal(countBarberWaVariables(tpl.body), contrato[tpl.kind], `{{n}} de ${tpl.kind}`);
    }
  }
});

/* ═════════ 3. EL BUG M-22: al reagendar NO llega la hora vieja ════════ */

test("recordatorio ya atendido: una fila viva NO se reprograma", () => {
  for (const status of ["PENDING", "SENT", "DELIVERED", "READ"] as const) {
    assert.equal(
      reminderAlreadyHandled([{ status, errorMessage: null }], isInvalidatedReminder),
      true,
      status,
    );
  }
});

test("recordatorio FALLIDO DE VERDAD tampoco se reprograma (no se hace spam)", () => {
  const rows = [{ status: "FAILED" as const, errorMessage: "(#131026) El número no tiene WhatsApp" }];
  assert.equal(reminderAlreadyHandled(rows, isInvalidatedReminder), true);
});

test("🔴 recordatorio INVALIDADO por T1 SÍ deja programar uno nuevo (M-22)", () => {
  // Esto es exactamente lo que escribe reminderInvalidationData("MOVED").
  const rows = [
    {
      status: "FAILED" as const,
      errorMessage: `${BARBER_REMINDER_INVALIDATED_MARK} la visita se movió de horario o de barbero`,
    },
  ];
  assert.equal(reminderAlreadyHandled(rows, isInvalidatedReminder), false);
});

test("con varias filas, basta UNA viva para no reprogramar", () => {
  const rows = [
    { status: "FAILED" as const, errorMessage: `${BARBER_REMINDER_INVALIDATED_MARK} se movió` },
    { status: "SENT" as const, errorMessage: null },
  ];
  assert.equal(reminderAlreadyHandled(rows, isInvalidatedReminder), true);
});

test("sin ninguna fila, hay que programar", () => {
  assert.equal(reminderAlreadyHandled([], isInvalidatedReminder), false);
});

/* ═══ 4. EL BUG M-06/M-10: un rechazo NO se pinta como entregado ══════ */

test("el estado avanza SENT → DELIVERED → READ", () => {
  assert.equal(nextBarberWaStatus("PENDING", "sent"), "SENT");
  assert.equal(nextBarberWaStatus("SENT", "delivered"), "DELIVERED");
  assert.equal(nextBarberWaStatus("DELIVERED", "read"), "READ");
});

test("🔴 el estado NUNCA retrocede (Meta manda los avisos desordenados)", () => {
  assert.equal(nextBarberWaStatus("READ", "delivered"), null);
  assert.equal(nextBarberWaStatus("READ", "sent"), null);
  assert.equal(nextBarberWaStatus("DELIVERED", "sent"), null);
});

test("un aviso REPETIDO no escribe nada (idempotencia)", () => {
  assert.equal(nextBarberWaStatus("DELIVERED", "delivered"), null);
  assert.equal(nextBarberWaStatus("FAILED", "failed"), null);
});

test("🔴 FAILED gana y no se sobrescribe con un 'entregado' que llegue tarde", () => {
  assert.equal(nextBarberWaStatus("SENT", "failed"), "FAILED");
  assert.equal(nextBarberWaStatus("READ", "failed"), "FAILED");
  assert.equal(nextBarberWaStatus("FAILED", "delivered"), null);
  assert.equal(nextBarberWaStatus("FAILED", "read"), null);
});

test("un estado desconocido de Meta no toca nada (lado seguro)", () => {
  assert.equal(nextBarberWaStatus("SENT", "warning"), null);
  assert.equal(nextBarberWaStatus("SENT", ""), null);
});

/* ═══════════ 5. LA RESPUESTA DEL CLIENTE AL RECORDATORIO ═════════════ */
//
// 🔴 G1 de la revisión (ronda 2). Hasta entonces estas respuestas se buscaban
// por «contiene»: «no puedo», «no voy», «cancelar» dentro de CUALQUIER frase
// cancelaban la cita. Esta sección fijaba «no puedo → cancela» como lo
// esperado; ahora fija lo contrario.

const REMINDER = barberWaTemplate("reminder").name;
const trasElRecordatorio = { templateName: REMINDER };

test("confirmar: solo cuando el mensaje ES la respuesta", () => {
  for (const text of ["CONFIRMAR", "confirmo", "Sí", "si", "ok", "va", "1", "¡Confirmar!", "Sí 👍", "sí confirmo"]) {
    assert.equal(classifyBarberReply(text), "confirm", text);
  }
});

test("cancelar y cambiar: solo la palabra, sola", () => {
  for (const text of ["CANCELAR", "cancelar.", "cancélala", "Cancelo", "2"]) {
    assert.equal(classifyBarberReply(text), "cancel", text);
  }
  for (const text of ["CAMBIAR", "reagendar", "Cambiar hora", "3"]) {
    assert.equal(classifyBarberReply(text), "reschedule", text);
  }
});

test("🔴 LA TABLA DE LA REVISORA: ninguna frase normal cancela, confirma ni «mueve» la visita", () => {
  const frases = [
    // Antes: CANCELABAN (contenían «no voy» / «no puedo» / «cancelar»).
    "Sí confirmo, no voy a faltar",
    "ahí estaré, no voy a fallar",
    "voy a llegar 10 min tarde, no puedo salir antes",
    "no puedo estacionarme, ahorita llego",
    "¿puedo cancelar si llueve?",
    "oye no puedo a las 5, ¿me la pasas a las 6?",
    "quiero cancelar la del domingo",
    // Antes: contestaba «con gusto te movemos la visita» (contenía «cambio»).
    "¿tienen cambio de 500?",
    // Antes: CONFIRMABA (contenía «confirmo»).
    "no confirmo todavía, te aviso",
    // Las que la prueba vieja daba por buenas como cancelación o cambio.
    "no puedo",
    "No podré ir",
    "no voy",
    "mejor no, sí cancélala",
    "sí, pero otro día",
    "¿lo movemos a otro día?",
    "otra hora",
    "ahí estaré",
    "somos 2",
    "llegamos 3 personas",
    "gracias",
    "👍",
    "",
  ];
  for (const frase of frases) {
    assert.equal(classifyBarberReply(frase), "unclear", JSON.stringify(frase));
    // …y por tanto no hay NINGUNA acción sobre la visita, ni siquiera justo
    // después del recordatorio: el mensaje sigue al bot o a la bandeja.
    assert.equal(decideBarberReminderReply(frase, trasElRecordatorio, REMINDER), null, JSON.stringify(frase));
  }
});

test("normalizar quita acentos, mayúsculas y signos — nunca palabras", () => {
  assert.equal(normalizeBarberReply("  ¡CONFIRMAR!  "), "confirmar");
  assert.equal(normalizeBarberReply("Sí 👍"), "si");
  assert.equal(normalizeBarberReply("Cancélala."), "cancelala");
  assert.equal(normalizeBarberReply("Sí confirmo, no voy a faltar"), "si confirmo no voy a faltar");
});

test("🔴 la palabra exacta solo cuenta si el recordatorio fue lo último que se le dijo", () => {
  // Justo después del recordatorio.
  assert.equal(decideBarberReminderReply("CONFIRMAR", trasElRecordatorio, REMINDER), "confirm");
  assert.equal(decideBarberReminderReply("sí", trasElRecordatorio, REMINDER), "confirm");
  assert.equal(decideBarberReminderReply("3", trasElRecordatorio, REMINDER), "reschedule");

  // Después de cualquier otra cosa (el bot preguntó algo, alguien escribió,
  // la confirmación de la reserva): ni siquiera «CANCELAR» escrito tal cual.
  for (const ultimo of [{ templateName: null }, { templateName: "dc_barber_reserva_confirmada" }, null]) {
    for (const text of ["CONFIRMAR", "CANCELAR", "CAMBIAR", "sí", "1", "2", "3"]) {
      assert.equal(decideBarberReminderReply(text, ultimo, REMINDER), null, `${text} tras ${JSON.stringify(ultimo)}`);
    }
  }
});

test("🔴 CANCELAR no cancela: PREGUNTA. Solo el «sí» a esa pregunta cancela", () => {
  assert.equal(decideBarberReminderReply("CANCELAR", trasElRecordatorio, REMINDER), "ask-cancel");
  assert.equal(decideBarberReminderReply("2", trasElRecordatorio, REMINDER), "ask-cancel");

  const trasLaPregunta = { templateName: BARBER_WA_CANCEL_ASK };
  for (const text of ["SÍ", "si", "Sí, cancelar", "ok", "va"]) {
    assert.equal(decideBarberReminderReply(text, trasLaPregunta, REMINDER), "do-cancel", text);
  }
  for (const text of ["no", "No.", "mejor no", "No, gracias"]) {
    assert.equal(decideBarberReminderReply(text, trasLaPregunta, REMINDER), "keep", text);
  }
  // Cualquier otra cosa tras la pregunta no decide nada (y «cancelar»
  // repetido tampoco cancela: tiene que ser el sí).
  for (const text of ["no sé, déjame ver", "sí pero mejor el jueves", "cancelar", "1", "gracias"]) {
    assert.equal(decideBarberReminderReply(text, trasLaPregunta, REMINDER), null, text);
  }
  assert.equal(isBarberYesReply("no"), false);
  assert.equal(isBarberNoReply("sí"), false);
  assert.equal(isBarberWaAskRow(BARBER_WA_CANCEL_ASK), true);
  assert.equal(isBarberWaSysRow(BARBER_WA_CANCEL_ASK), false, "la pregunta es un mensaje real: se ve en la bandeja");
});

test("los botones del recordatorio dicen la acción Y la visita exacta", () => {
  const botones = barberReminderButtons("cita_123");
  assert.deepEqual(
    botones.map((b) => b.id),
    ["rec.confirmar:cita_123", "rec.reagendar:cita_123", "rec.cancelar:cita_123"],
  );
  for (const b of [...botones, ...barberCancelAskButtons("cita_123")]) {
    assert.ok(Array.from(b.title).length <= 20, `«${b.title}» cabe en un botón de respuesta (20)`);
  }
  assert.deepEqual(parseBarberReminderButton("rec.confirmar:cita_123"), { action: "confirm", appointmentId: "cita_123" });
  assert.deepEqual(parseBarberReminderButton("rec.reagendar:cita_123"), { action: "reschedule", appointmentId: "cita_123" });
  // El botón «Cancelar» tampoco cancela: pregunta.
  assert.deepEqual(parseBarberReminderButton("rec.cancelar:cita_123"), { action: "ask-cancel", appointmentId: "cita_123" });
  const [si, no] = barberCancelAskButtons("cita_123");
  assert.deepEqual(parseBarberReminderButton(si.id), { action: "do-cancel", appointmentId: "cita_123" });
  assert.deepEqual(parseBarberReminderButton(no.id), { action: "keep", appointmentId: "cita_123" });
  // Lo que no es de estos botones no se interpreta.
  for (const id of ["bot:1", "rec.confirmar", "rec.confirmar:", "otra.cosa:1", "", null, 7]) {
    assert.equal(parseBarberReminderButton(id), null, String(id));
  }
});

test("la plantilla del recordatorio con botones: tres, sin emojis, mismas variables que la de texto", () => {
  const conBotones = barberWaTemplate("reminderButtons");
  const deTexto = barberWaTemplate("reminder");
  assert.deepEqual(conBotones.buttons, ["Confirmar", "Cambiar", "Cancelar"]);
  assert.deepEqual([...BARBER_REMINDER_TEMPLATE_BUTTONS], conBotones.buttons);
  assert.deepEqual(conBotones.variables, deTexto.variables, "los mismos seis parámetros, en el mismo orden");
  assert.equal(conBotones.category, "UTILITY");
  assert.notEqual(conBotones.name, deTexto.name, "son dos plantillas: la de texto queda de respaldo");
  assert.equal(deTexto.buttons, undefined);
  // El payload de cada botón sale de barberReminderButtons, en el mismo orden.
  assert.equal(barberReminderButtons("x").length, conBotones.buttons!.length);

  // Lo que Meta rechazaría en un botón de plantilla.
  const con = (buttons: string[]) => checkBarberWaTemplate({ ...conBotones, buttons });
  assert.equal(con(["Confirmar", "Cambiar", "Cancelar"]), null);
  assert.ok(con(["✅ Confirmar"]), "emojis");
  assert.ok(con(["Confirmar\nya"]), "saltos de línea");
  assert.ok(con(["x".repeat(26)]), "más de 25 caracteres");
  assert.ok(con(["Sí", "Sí"]), "dos iguales");
  assert.ok(con(["A", "B", "C", "D"]), "más de tres");
});

test("🔴 cancelar o mover exige 2 horas de anticipación — la misma regla que «mi cuenta»", () => {
  assert.equal(BARBER_WA_CHANGE_NOTICE_HOURS, BARBER_CANCEL_WINDOW_HOURS, "un solo número para los dos caminos");
  const now = new Date("2026-11-17T15:00:00.000Z");
  const en = (min: number) => new Date(now.getTime() + min * 60_000);
  assert.equal(barberTooLateToChange(en(121), now), false);
  assert.equal(barberTooLateToChange(en(120), now), false);
  assert.equal(barberTooLateToChange(en(119), now), true);
  assert.equal(barberTooLateToChange(en(-10), now), true);
  assert.match(barberLateChangeReply("55 1234 5678"), /Para cambios de última hora llama a la barbería: 55 1234 5678\./);
  assert.match(barberLateChangeReply(null), /llama a la barbería\.$/);
});

test("una solicitud sin aceptar es la reserva en línea PENDIENTE (lo que lista Solicitudes)", () => {
  assert.equal(isBarberUnacceptedRequest({ status: "PENDING", source: "PUBLIC" }), true);
  assert.equal(isBarberUnacceptedRequest({ status: "CONFIRMED", source: "PUBLIC" }), false, "ya aceptada");
  assert.equal(isBarberUnacceptedRequest({ status: "PENDING", source: "PANEL" }), false, "la creó la barbería");
  assert.equal(isBarberUnacceptedRequest({ status: "PENDING", source: "WALKIN" }), false);
  assert.deepEqual([...BARBER_REQUEST_SOURCES], ["PUBLIC"]);
  // booking.ts (de otra pantalla) define Solicitudes con este mismo filtro.
  const booking = readFileSync("src/lib/barber/booking.ts", "utf8");
  assert.ok(booking.includes('source: "PUBLIC"'), "si Solicitudes cambia de filtro, BARBER_REQUEST_SOURCES tiene que seguirlo");
});

/* ═════════════════ 6. ADJUNTOS Y MARCAS DE SISTEMA ═══════════════════ */

test("un adjunto sobrevive la ida y vuelta por templateName", () => {
  const att: BarberWaAttachment = {
    kind: "image",
    mediaId: "1234567890",
    mime: "image/jpeg",
    filename: "corte.jpg",
  };
  assert.deepEqual(parseBarberWaAttachment(encodeBarberWaAttachment(att)), att);
});

test("un adjunto ilegible es 'no hay adjunto', nunca una excepción", () => {
  assert.equal(parseBarberWaAttachment("attach:{roto"), null);
  assert.equal(parseBarberWaAttachment("attach:{}"), null);
  assert.equal(parseBarberWaAttachment('attach:{"kind":"virus","mediaId":"x"}'), null);
  assert.equal(parseBarberWaAttachment(null), null);
  assert.equal(parseBarberWaAttachment("dc_barber_recordatorio_cita"), null);
});

test("las marcas de sistema no se confunden con una plantilla", () => {
  assert.equal(isBarberWaSysRow(BARBER_WA_ARCHIVE_MARK), true);
  assert.equal(isBarberWaSysRow(BARBER_WA_UNARCHIVE_MARK), true);
  assert.equal(isBarberWaSysRow("dc_barber_recordatorio_cita"), false);
  assert.equal(isBarberWaSysRow(null), false);
  // Ojo con la fila de la fila virtual, que es de T1 y NO es de sistema.
  assert.equal(isBarberWaSysRow("walkin_casi_es_tu_turno"), false);
});

/* ══════════════════════════ 7. CUOTA ═════════════════════════════════ */

test("cupo: cabe mientras no se pase, e ilimitado siempre cabe", () => {
  assert.equal(barberWaFits(200, 199), true);
  assert.equal(barberWaFits(200, 200), false);
  assert.equal(barberWaFits(-1, 999_999), true);
  assert.equal(isBarberWaUnlimited(-1), true);
  assert.equal(isBarberWaUnlimited(200), false);
});

test("se avisa desde el 80% del cupo, no en silencio al llegar al tope", () => {
  const antes = buildBarberWaQuota({ limit: 200, used: 159, periodStart: null });
  assert.equal(antes.nearLimit, false);
  const avisa = buildBarberWaQuota({ limit: 200, used: 160, periodStart: null });
  assert.equal(avisa.nearLimit, true);
  assert.equal(avisa.exhausted, false);
  assert.equal(avisa.remaining, 40);
  const lleno = buildBarberWaQuota({ limit: 200, used: 200, periodStart: null });
  assert.equal(lleno.exhausted, true);
  assert.equal(lleno.remaining, 0);
});

test("cupo ilimitado nunca avisa ni se agota", () => {
  const q = buildBarberWaQuota({ limit: -1, used: 10_000, periodStart: null });
  assert.equal(q.nearLimit, false);
  assert.equal(q.exhausted, false);
});

/* ═══════════════════ 8. VENTANA DE SERVICIO 24 h ═════════════════════ */

test("la ventana de 24 h abre con el mensaje del cliente y cierra sola", () => {
  const ahora = new Date("2026-08-24T12:00:00.000Z");
  assert.equal(barberWaWindowOpen(null, ahora), false);
  assert.equal(barberWaWindowOpen(new Date("2026-08-24T11:00:00.000Z"), ahora), true);
  // Justo en el filo: 24 h exactas ya está CERRADA (Meta responde 131047).
  assert.equal(barberWaWindowOpen(new Date("2026-08-23T12:00:00.000Z"), ahora), false);
  assert.equal(barberWaWindowOpen(new Date("2026-08-23T12:00:01.000Z"), ahora), true);
});

/* ═══════ 8b. PARÁMETROS: lo que hace que Meta rechace el mensaje ══════ */

test("🔴 un parámetro nunca lleva saltos, tabulaciones ni espacios dobles (132018)", () => {
  assert.equal(sanitizeBarberWaParam("Av. Juárez 120\nLocal 4"), "Av. Juárez 120 Local 4");
  assert.equal(sanitizeBarberWaParam("uno\r\n\tdos      tres"), "uno dos tres");
  assert.equal(sanitizeBarberWaParam("línea" + String.fromCharCode(0x2028) + "otra"), "línea otra");
  assert.equal(sanitizeBarberWaParam("  Luis  "), "Luis");
});

test("un parámetro vacío se cambia por un relleno (131008) y uno enorme se recorta", () => {
  assert.equal(sanitizeBarberWaParam(""), "—");
  assert.equal(sanitizeBarberWaParam(" \n "), "—");
  assert.equal(sanitizeBarberWaParam(null), "—");
  assert.equal(sanitizeBarberWaParam("", "Tu servicio"), "Tu servicio");
  const largo = sanitizeBarberWaParam("x".repeat(BARBER_WA_PARAM_MAX + 50));
  assert.equal(Array.from(largo).length, BARBER_WA_PARAM_MAX);
});

/* ════════════ 8c. LA COLA: reclamar antes de mandar ═══════════════════ */

test("el reclamo de una fila se reconoce, trae su hora y caduca", () => {
  const ahora = new Date("2026-11-14T18:00:00.000Z");
  const marca = barberWaClaimMark(ahora);
  assert.equal(isBarberWaClaim(marca), true);
  assert.equal(parseBarberWaClaim(marca)?.toISOString(), ahora.toISOString());
  assert.equal(isBarberWaClaim(null), false);
  assert.equal(isBarberWaClaim("(#131026) Message undeliverable"), false);
  assert.equal(parseBarberWaClaim("(#131026) Message undeliverable"), null);
  // Una marca ilegible cuenta como viejísima: no puede atorar la fila.
  const rara = parseBarberWaClaim("[enviando] no-es-fecha");
  assert.ok(rara && ahora.getTime() - rara.getTime() > BARBER_WA_CLAIM_STALE_MS);
  // Un reclamo NO es un recordatorio invalidado (son marcas distintas).
  assert.equal(isInvalidatedReminder(marca), false);
});

test("🔴 lo que ya no tiene sentido NO se manda: visita pasada, cancelada o aviso viejo", () => {
  const now = new Date("2026-11-14T18:00:00.000Z");
  const enDosHoras = new Date("2026-11-14T20:00:00.000Z");
  const haceUnaHora = new Date("2026-11-14T17:00:00.000Z");
  const viva = { status: "CONFIRMED", startAt: enDosHoras };
  const base = { createdAt: now, now };

  for (const kind of ["reminder", "bookingConfirmed"] as const) {
    assert.equal(barberOutboxStaleReason({ ...base, kind, appointment: viva }), null);
    assert.equal(
      barberOutboxStaleReason({ ...base, kind, appointment: { ...viva, status: "PENDING" } }),
      null,
    );
    assert.ok(barberOutboxStaleReason({ ...base, kind, appointment: { ...viva, startAt: haceUnaHora } }));
    assert.ok(barberOutboxStaleReason({ ...base, kind, appointment: { ...viva, startAt: now } }));
    for (const status of ["CANCELLED", "NO_SHOW", "DONE", "IN_PROGRESS"]) {
      assert.ok(barberOutboxStaleReason({ ...base, kind, appointment: { ...viva, status } }), status);
    }
    assert.ok(barberOutboxStaleReason({ ...base, kind, appointment: null }), "la visita ya no existe");
  }

  // Aviso de la fila: vale media hora.
  const reciente = new Date(now.getTime() - BARBER_WALKIN_NOTICE_TTL_MS + 60_000);
  const viejo = new Date(now.getTime() - BARBER_WALKIN_NOTICE_TTL_MS - 60_000);
  assert.equal(barberOutboxStaleReason({ kind: "walkinTurn", createdAt: reciente, now, appointment: null }), null);
  assert.ok(barberOutboxStaleReason({ kind: "walkinTurn", createdAt: viejo, now, appointment: null }));

  // Un texto suelto que alguien encoló no caduca solo.
  assert.equal(barberOutboxStaleReason({ kind: "other", createdAt: viejo, now, appointment: null }), null);
});

test("el aviso de la fila no repite en la plantilla lo que la plantilla ya dice", () => {
  const shop = "Barbería El Corte";
  const tpl = barberWaTemplate("walkinTurn");
  const armar = (aviso: string) => tpl.body.replace("{{1}}", shop).replace("{{2}}", aviso);

  const yaEs = walkInNotifyBody({ shopName: shop, clientName: "Luis Pérez", ahead: 0, etaMinutes: 0 });
  assert.equal(walkInTemplateNotice(shop, yaEs), "Luis, ya es tu turno.");
  const final1 = armar(walkInTemplateNotice(shop, yaEs));
  assert.equal(final1.split("Te esperamos en la silla").length - 1, 1, "una sola vez");
  assert.equal(final1.split(shop).length - 1, 1, "el nombre de la barbería una sola vez");

  const faltan = walkInNotifyBody({ shopName: shop, clientName: "Luis", ahead: 2, etaMinutes: 20 });
  assert.equal(
    walkInTemplateNotice(shop, faltan),
    "Luis, faltan 2 personas para tu turno. Vente en unos 20 min.",
  );
  assert.equal(walkInTemplateNotice(shop, "   "), "Ya casi es tu turno.");
});

/* ═══════ 8d. RESPUESTAS SUELTAS Y BAJA DE PROMOCIONES ═════════════════ */

test("la baja se reconoce por lo que la gente escribe, y no por accidente", () => {
  for (const t of ["BAJA", "baja.", "Stop", "darme de baja", "ya no me manden mensajes", "No quiero promociones!"]) {
    assert.equal(isBarberOptOutText(t), true, t);
  }
  for (const t of [
    "¿a qué hora baja la cortina?",
    "stop, mejor el jueves",
    "me doy de baja de la fila",
    "quiero un corte bajo",
    "",
  ]) {
    assert.equal(isBarberOptOutText(t), false, t);
  }
});

test("la baja se lee de las preferencias sin tronar con datos raros", () => {
  assert.equal(barberClientOptedOut({ __optout: { at: "2026-11-14T00:00:00.000Z" } }), true);
  assert.equal(barberClientOptedOut({ __optout: null }), false);
  assert.equal(barberClientOptedOut({ __optout: { at: "" } }), false);
  assert.equal(barberClientOptedOut({ otra: 1 }), false);
  assert.equal(barberClientOptedOut(null), false);
  assert.equal(barberClientOptedOut("texto"), false);
  assert.equal(barberClientOptedOut([]), false);
});

test("el respaldo de los botones es el mismo mensaje con las opciones numeradas", () => {
  assert.equal(
    barberWaOptionsAsText("¿Qué te vas a hacer? ", [
      { title: "Corte" },
      { title: "Barba", description: "$120 · 20 min" },
    ]),
    "¿Qué te vas a hacer?\n\n1. Corte\n2. Barba — $120 · 20 min",
  );
});

test("🔴 el cron del despacho solo entra con CRON_SECRET, no con una cabecera que cualquiera puede escribir", () => {
  const src = readFileSync("src/app/api/barber/whatsapp/_server.ts", "utf8");
  const sinComentarios = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  assert.ok(!sinComentarios.includes("x-vercel-cron"), "la cabecera x-vercel-cron no autoriza nada");
  assert.ok(sinComentarios.includes("Bearer ${secret}"), "se exige el secreto");
  assert.ok(/if \(!secret\)[\s\S]{0,200}status: 503/.test(sinComentarios), "sin secreto configurado: 503");
});

/* ══════════ 9. TERMINOLOGÍA: es una barbería, no una clínica ═════════ */

const PROHIBIDAS = [
  /\bpacientes?\b/i,
  /\bdoctora?s?\b/i,
  /\bDr\./,
  /\bcl[íi]nicas?\b/i,
  /\bconsultas?\b/i,
  /\bexpedientes?\b/i,
  /\bconsultorios?\b/i,
];

/** Archivos del vertical que escribió esta ola. */
function archivosDeLaOla(): string[] {
  const raices = [
    "src/lib/barber/whatsapp.ts",
    "src/lib/barber/whatsapp-core.ts",
    "src/app/api/barber/whatsapp",
    "src/components/barber/whatsapp",
    "src/i18n/dictionaries/barber/whatsapp.es.json",
    "src/i18n/dictionaries/barber/whatsapp.en.json",
    "src/app/barber/(panel)/whatsapp",
  ];
  const out: string[] = [];
  const walk = (p: string) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const child of readdirSync(p)) walk(join(p, child));
      return;
    }
    if (/\.(ts|tsx|json|css)$/.test(p)) out.push(p);
  };
  for (const r of raices) walk(r);
  return out;
}

/**
 * Quita los comentarios para revisar SOLO el código y los textos que ve la
 * gente.
 *
 * Los comentarios de este módulo SÍ nombran al producto dental a propósito —
 * son las notas de aislamiento que explican qué NO se toca y de qué bug se
 * está huyendo. Eso es documentación necesaria, no terminología equivocada.
 * Lo que no puede llevar una palabra del dental es lo que se ejecuta y, sobre
 * todo, lo que se le enseña a la barbería.
 */
function sinComentarios(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    // `//` de comentario, pero NO el de "https://".
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("cero 'paciente', 'doctor', 'clínica', 'consulta', 'expediente' en el CÓDIGO", () => {
  const ofensas: string[] = [];
  for (const file of archivosDeLaOla()) {
    const raw = readFileSync(file, "utf8");
    // Los JSON no llevan comentarios: se revisan enteros.
    const text = file.endsWith(".json") ? raw : sinComentarios(raw);
    for (const linea of text.split(/\r?\n/)) {
      for (const re of PROHIBIDAS) {
        if (re.test(linea)) ofensas.push(`${file}: ${linea.trim()}`);
      }
    }
  }
  assert.deepEqual(
    ofensas,
    [],
    `Terminología del dental en el código del vertical barber:\n${ofensas.join("\n")}`,
  );
});

test("los diccionarios del vertical hablan de cliente/barbero/barbería", () => {
  const es = readFileSync("src/i18n/dictionaries/barber/whatsapp.es.json", "utf8");
  assert.match(es, /cliente/);
  assert.match(es, /barber[íi]a/);
  for (const re of PROHIBIDAS) assert.equal(re.test(es), false, String(re));
});

/* ═══════ G4 — un solo turno del bot por conversación ═══════ */

test("🔴 G4 — quién corre: uno a la vez, y el mensaje más nuevo contesta por todos", () => {
  const t0 = new Date("2026-11-14T18:00:00.000Z");
  const en = (ms: number) => new Date(t0.getTime() + ms);
  const fila = (id: string, llego: number, marca: string | null) => ({
    id,
    createdAt: en(llego),
    errorMessage: marca,
  });
  const ahora = en(5_000);
  const vigente = en(50_000);
  const caducada = en(1_000);
  const yo = { id: "m2", createdAt: en(2_000) };

  // Nadie más: corro.
  assert.equal(decideBarberBotTurn(yo, [], ahora), "run");
  // Un entrante sin marca (un «CONFIRMAR», una foto) no pinta nada.
  assert.equal(decideBarberBotTurn(yo, [fila("m1", 1_000, null)], ahora), "run");

  // Otro turno está corriendo: espero (da igual si es anterior o posterior).
  assert.equal(
    decideBarberBotTurn(yo, [fila("m1", 1_000, barberBotTurnMark("atendiendo", vigente))], ahora),
    "wait",
  );
  // …aunque además haya uno más nuevo esperando: primero que acabe el que corre.
  assert.equal(
    decideBarberBotTurn(
      yo,
      [fila("m1", 1_000, barberBotTurnMark("atendiendo", vigente)), fila("m3", 3_000, barberBotTurnMark("espera", vigente))],
      ahora,
    ),
    "wait",
  );
  // Nadie corre y hay uno MÁS NUEVO esperando: cedo, él contesta por los dos.
  assert.equal(
    decideBarberBotTurn(yo, [fila("m3", 3_000, barberBotTurnMark("espera", vigente))], ahora),
    "yield",
  );
  // El que espera es más VIEJO que yo: corro yo (él cederá).
  assert.equal(
    decideBarberBotTurn(yo, [fila("m1", 1_000, barberBotTurnMark("espera", vigente))], ahora),
    "run",
  );
  // Misma hora exacta: desempata el id, y solo uno de los dos corre.
  const gemelo = { id: "m9", createdAt: yo.createdAt };
  assert.equal(
    decideBarberBotTurn(yo, [{ ...gemelo, errorMessage: barberBotTurnMark("espera", vigente) }], ahora),
    "yield",
  );
  assert.equal(
    decideBarberBotTurn(gemelo, [{ ...yo, errorMessage: barberBotTurnMark("espera", vigente) }], ahora),
    "run",
  );

  // Un turno ya contestó habiendo visto mi mensaje: cedo, no contesto dos veces.
  assert.equal(
    decideBarberBotTurn(yo, [fila("m3", 3_000, barberBotTurnMark("listo", en(3_000)))], ahora),
    "yield",
  );
  assert.equal(
    decideBarberBotTurn(yo, [fila("m3", 3_000, barberBotTurnMark("listo", yo.createdAt))], ahora),
    "yield",
  );
  // …pero un «listo» de ANTES de que yo llegara no me vio: corro.
  assert.equal(
    decideBarberBotTurn(yo, [fila("m1", 1_000, barberBotTurnMark("listo", en(1_000)))], ahora),
    "run",
  );

  // 🔴 Una marca caducada es de un proceso que murió: no puede dejar mudo el hilo.
  assert.equal(
    decideBarberBotTurn(yo, [fila("m1", 1_000, barberBotTurnMark("atendiendo", caducada))], ahora),
    "run",
  );
  assert.equal(
    decideBarberBotTurn(yo, [fila("m3", 3_000, barberBotTurnMark("espera", caducada))], ahora),
    "run",
  );
  // Mi propia fila no cuenta, y un error de verdad en esa columna tampoco.
  assert.equal(
    decideBarberBotTurn(yo, [{ ...yo, errorMessage: barberBotTurnMark("atendiendo", vigente) }], ahora),
    "run",
  );
  assert.equal(decideBarberBotTurn(yo, [fila("m1", 1_000, "(#131047) Re-engagement message")], ahora), "run");
});

test("G4 — la respuesta nace vieja solo si llegó algo DESPUÉS de lo que vio el turno y sigue esperando", () => {
  const t0 = new Date("2026-11-14T18:00:00.000Z");
  const en = (ms: number) => new Date(t0.getTime() + ms);
  const ahora = en(5_000);
  const visto = en(1_000);
  const fila = (llego: number, marca: string | null) => ({ id: `m${llego}`, createdAt: en(llego), errorMessage: marca });

  assert.equal(barberBotReplyIsStale(visto, [], ahora), false);
  assert.equal(barberBotReplyIsStale(visto, [fila(2_000, barberBotTurnMark("espera", en(50_000)))], ahora), true);
  // Lo que ya había visto no la vuelve vieja.
  assert.equal(barberBotReplyIsStale(visto, [fila(1_000, barberBotTurnMark("espera", en(50_000)))], ahora), false);
  // Un mensaje nuevo que NO va al bot (sin marca) no se la traga: nadie más contestaría.
  assert.equal(barberBotReplyIsStale(visto, [fila(2_000, null)], ahora), false);
  // El que esperaba ya se rindió (marca caducada): contesto yo.
  assert.equal(barberBotReplyIsStale(visto, [fila(2_000, barberBotTurnMark("espera", en(4_000)))], ahora), false);
  assert.equal(barberBotReplyIsStale(visto, [fila(2_000, barberBotTurnMark("listo", en(2_000)))], ahora), false);
});

test("G4 — las marcas del turno se leen de vuelta y no se confunden con un error ni con la cola", () => {
  const cuando = new Date("2026-11-14T18:00:00.000Z");
  for (const kind of ["atendiendo", "espera", "listo"] as const) {
    const marca = barberBotTurnMark(kind, cuando);
    assert.ok(marca.startsWith(BARBER_WA_TURN_PREFIX));
    assert.ok(isBarberBotTurnMark(marca));
    assert.deepEqual(parseBarberBotTurnMark(marca), { kind, at: cuando });
    assert.equal(isBarberWaClaim(marca), false, "no es el reclamo «[enviando]» de la cola");
    assert.equal(isInvalidatedReminder(marca), false);
  }
  for (const raro of [null, undefined, "", "(#100) Invalid parameter", "[bot:otra] 2026-11-14T18:00:00.000Z", "[bot:listo] ayer"]) {
    assert.equal(parseBarberBotTurnMark(raro), null, String(raro));
  }
  assert.equal(isBarberBotTurnMark("(#100) Invalid parameter"), false);
});

test("la pantalla del bot da por conectado todo lo que no sea «sin conectar» (también «sin verificación»)", () => {
  assert.equal(isBarberWaLinked("DISCONNECTED"), false);
  for (const s of ["CONNECTED", "UNVERIFIED", "NO_PAYMENT_METHOD", "ERROR"] as const) {
    assert.equal(isBarberWaLinked(s), true, s);
  }
  // La página del bot usa este criterio y no el `=== "CONNECTED"` de antes.
  const page = readFileSync("src/app/barber/(panel)/whatsapp/bot/page.tsx", "utf8");
  assert.ok(page.includes("connected={isBarberWaLinked(connection.state)}"));
  assert.ok(!page.includes('=== "CONNECTED"'));
});
