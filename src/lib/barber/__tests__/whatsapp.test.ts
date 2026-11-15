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
  barberWaTemplate,
  barberWaTemplateByName,
  barberWaWindowOpen,
  buildBarberWaQuota,
  checkBarberWaTemplate,
  classifyBarberReply,
  countBarberWaVariables,
  encodeBarberWaAttachment,
  isBareBarberReply,
  isBarberOptOutText,
  isBarberWaClaim,
  isBarberWaSysRow,
  isBarberWaUnlimited,
  nextBarberWaStatus,
  parseBarberWaAttachment,
  parseBarberWaClaim,
  reminderAlreadyHandled,
  sanitizeBarberWaParam,
  walkInTemplateNotice,
  type BarberWaAttachment,
} from "@/lib/barber/whatsapp-core";
import {
  isInvalidatedReminder,
  BARBER_REMINDER_INVALIDATED_MARK,
  walkInNotifyBody,
} from "@/lib/barber/agenda";

/* ═══════════════ 1. CATEGORÍAS: la factura de la barbería ═════════════ */

test("todo lo transaccional es `utility` — nada se cuela como marketing", () => {
  const esperado: Record<string, string> = {
    reminder: "UTILITY",
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

test("confirmar reconoce lo que la gente escribe de verdad", () => {
  for (const text of ["CONFIRMAR", "confirmo", "Confirmado", "sí", "si", "ok", "va", "1", "Ahí estaré"]) {
    assert.equal(classifyBarberReply(text), "confirm", text);
  }
});

test("cancelar reconoce lo que la gente escribe de verdad", () => {
  for (const text of ["CANCELAR", "cancélalo", "no puedo", "No podré ir", "2"]) {
    assert.equal(classifyBarberReply(text), "cancel", text);
  }
});

test("cambiar de horario es una TERCERA salida, no un cancelar", () => {
  for (const text of ["CAMBIAR", "reagendar", "¿lo movemos a otro día?", "otra hora", "3"]) {
    assert.equal(classifyBarberReply(text), "reschedule", text);
  }
});

test("🔴 'sí, pero otro día' NO confirma: lleva un sí dentro y no es un sí", () => {
  assert.equal(classifyBarberReply("sí, pero otro día"), "reschedule");
});

test("🔴 'mejor no, sí cancélala' cancela: ante la duda gana lo que el cliente quiso", () => {
  assert.equal(classifyBarberReply("mejor no, sí cancélala"), "cancel");
});

test("un dígito suelto dentro de una frase NO cancela la cita de nadie", () => {
  assert.equal(classifyBarberReply("somos 2"), "unclear");
  assert.equal(classifyBarberReply("llegamos 3 personas"), "unclear");
});

test("lo que no se entiende se marca unclear y no toca la agenda", () => {
  for (const text of ["", "   ", "gracias", "¿cuánto cuesta el corte?", "👍"]) {
    assert.equal(classifyBarberReply(text), "unclear", JSON.stringify(text));
  }
});

test("los acentos y las mayúsculas no cambian la respuesta", () => {
  assert.equal(classifyBarberReply("CONFÍRMALO"), classifyBarberReply("confirmalo"));
  assert.equal(classifyBarberReply("Cancélala"), "cancel");
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

test("🔴 «sí», «ok» y los dígitos son respuestas SUELTAS; las palabras explícitas no", () => {
  for (const t of ["si", "Sí", "SI", "ok", "Okay", "va", "vale", "claro", "de acuerdo", "1", "2", "3"]) {
    assert.equal(isBareBarberReply(t), true, t);
  }
  for (const t of ["confirmar", "CONFIRMO", "cancelar", "cambiar", "sí, confirmo", "ahí estaré", "hola"]) {
    assert.equal(isBareBarberReply(t), false, t);
  }
});

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
