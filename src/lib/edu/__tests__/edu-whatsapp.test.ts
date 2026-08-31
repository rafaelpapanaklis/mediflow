/**
 * WHATSAPP Y RECORDATORIOS — Ola 9 de DaleControl INSTITUCIONAL.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-whatsapp.test.ts
 *
 * (No hay `npm run test:edu-whatsapp`: package.json es un archivo del
 * producto dental y esta ola no lo toca. Cuando el vertical se integre a
 * main, es UNA línea.)
 *
 * Todo se comprueba SIN base de datos y SIN red: `whatsapp-core.ts` es puro
 * (decide, no ejecuta) y `visibility.ts` devuelve objetos `where`, así que
 * aquí se lee exactamente lo que Prisma recibiría — que es donde vive la
 * regla.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LAS CUATRO COSAS QUE FIJA ESTE ARCHIVO
 *
 * 1. REAGENDAR O CANCELAR CANCELA EL RECORDATORIO VIEJO, y por DOS
 *    caminos independientes: `planEduReminderCancel` (lo que estaba en cola
 *    se cancela, lo ya enviado NO se toca) y `eduReminderDedupeKey` (la
 *    llave lleva la HORA dentro, así que la fila vieja no puede tapar el
 *    aviso bueno). En el dental esto es un bug abierto: la llave NO lleva la
 *    hora y la fila vieja bloquea el recordatorio correcto para siempre.
 *
 * 2. SIN PLANTILLA APROBADA, EL AVISO NO SE INTENTA — y el motivo se puede
 *    leer en voz alta.
 *
 * 3. UN ALUMNO NO VE UN RECIBO NI EN EL REGISTRO DE WHATSAPP. El cuerpo del
 *    aviso lleva el folio, el total y el saldo: recortar solo por paciente
 *    dejaría el dinero a la vista de quien la Ola 5 cerró por partida doble.
 *
 * 4. LA VENTANA DE 24 h SE CONSIDERA SIEMPRE CERRADA: no existe ningún
 *    camino que devuelva "texto libre".
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDU_REMINDER_GRACE_MIN,
  EDU_REMINDER_LIVE_APPOINTMENT_STATUSES,
  EDU_REMINDER_MAX_HOURS,
  EDU_REMINDER_MIN_HOURS,
  EDU_WA_BILLING_ERROR_CODE,
  EDU_WA_KINDS,
  EDU_WA_KIND_LABELS,
  EDU_WA_MAX_ATTEMPTS,
  EDU_WA_STATUSES,
  EDU_WA_STATUS_DETAILS,
  EDU_WA_STATUS_LABELS,
  EDU_WA_TEMPLATES,
  eduClampReminderHours,
  eduDecideWaSend,
  eduParseWaTemplates,
  eduReminderDedupeKey,
  eduReminderMoment,
  eduRenderWaBody,
  eduSanitizeWaTemplates,
  eduWaConnState,
  eduWaIsOpenStatus,
  eduWaPhone,
  eduWaPhoneLabel,
  eduWaReadiness,
  eduWaSpec,
  planEduReminderCancel,
  type EduWaTemplateMap,
} from "../whatsapp-core";
import { eduCanSendWhatsappKind, eduVisibility, eduWhatsappScopeWhere } from "../visibility";
import { EDU_APPOINTMENT_STATUSES, type EduRole } from "../types";

const INST = "inst_1";

function actor(role: EduRole, eduUserId = "u_1") {
  return { role, eduUserId };
}

/** Un mapa de plantillas con las tres APROBADAS. */
function aprobadas(): EduWaTemplateMap {
  const out: EduWaTemplateMap = {};
  for (const spec of EDU_WA_TEMPLATES) {
    out[spec.kind] = { name: spec.suggestedName, lang: "es_MX", status: "APPROVED" };
  }
  return out;
}

function paramsDe(kind: (typeof EDU_WA_KINDS)[number]): string[] {
  return (eduWaSpec(kind)?.variableKeys ?? []).map((k, i) => `${k}-${i}`);
}

// ─────────────────────────────────────────────────────────────────────
// 1 · EL CATÁLOGO DE PLANTILLAS
// ─────────────────────────────────────────────────────────────────────

test("hay una plantilla por cada tipo de mensaje, y ni una de más", () => {
  assert.deepEqual(
    EDU_WA_TEMPLATES.map((t) => t.kind).sort(),
    [...EDU_WA_KINDS].sort(),
    "un tipo sin plantilla es un aviso que nunca podría salir",
  );
  for (const kind of EDU_WA_KINDS) {
    assert.ok(EDU_WA_KIND_LABELS[kind], `falta la etiqueta en español de ${kind}`);
  }
});

/**
 * Reglas de Meta que cuesta caro descubrir tarde: la revisión rechaza un
 * cuerpo que empieza o termina con una variable, o que pega dos.
 */
test("ningún cuerpo empieza, termina ni pega variables (Meta lo rechazaría)", () => {
  for (const spec of EDU_WA_TEMPLATES) {
    const cuerpo = spec.body.trim();
    assert.ok(!/^\{\{\d+\}\}/.test(cuerpo), `${spec.kind} empieza con una variable`);
    assert.ok(!/\{\{\d+\}\}$/.test(cuerpo), `${spec.kind} termina con una variable`);
    assert.ok(!/\}\}\s*\{\{/.test(cuerpo), `${spec.kind} pega dos variables`);
  }
});

test("las variables van de {{1}} a {{n}} sin huecos y coinciden con variableKeys", () => {
  for (const spec of EDU_WA_TEMPLATES) {
    const nums = Array.from(spec.body.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1]));
    const unicos = Array.from(new Set(nums)).sort((a, b) => a - b);
    assert.deepEqual(
      unicos,
      spec.variableKeys.map((_, i) => i + 1),
      `${spec.kind}: el cuerpo y variableKeys no dicen lo mismo (los valores viajan por POSICIÓN)`,
    );
    assert.equal(
      spec.sample.length,
      spec.variableKeys.length,
      `${spec.kind}: el ejemplo para Meta tiene otro número de datos`,
    );
  }
});

test("pintar la plantilla sustituye por POSICIÓN, no por nombre", () => {
  const spec = eduWaSpec("RECORDATORIO")!;
  const texto = eduRenderWaBody(spec, ["Ana", "Instituto X", "lunes 1", "09:00"]);
  assert.ok(texto.includes("Ana"));
  assert.ok(texto.includes("Instituto X"));
  assert.ok(texto.includes("lunes 1"));
  assert.ok(texto.includes("09:00"));
  assert.ok(!texto.includes("{{"), "quedó una variable sin sustituir");
});

// ─────────────────────────────────────────────────────────────────────
// 2 · LEER Y GUARDAR LO QUE LA ESCUELA REGISTRA
// ─────────────────────────────────────────────────────────────────────

test("una entrada corrupta se DESCARTA en vez de intentar enviarse", () => {
  const map = eduParseWaTemplates({
    RECORDATORIO: { name: "MAYÚSCULAS Y ESPACIOS", lang: "es_MX" },
    CONSENTIMIENTO: { name: "edu_ok", lang: "no-es-un-idioma" },
    RECIBO: { name: "edu_recibo_cobro", lang: "es_MX" },
    INVENTADO: { name: "edu_x", lang: "es" },
  });
  assert.equal(map.RECORDATORIO, undefined, "un nombre inválido gastaría un intento en Meta");
  assert.equal(map.CONSENTIMIENTO, undefined);
  assert.equal(map.RECIBO?.name, "edu_recibo_cobro");
  assert.equal(Object.keys(map).length, 1, "una clave que no es un tipo no puede colarse");
});

test("el ESTADO nunca se acepta del cliente (si no, se podría fingir APPROVED)", () => {
  const res = eduSanitizeWaTemplates(
    { RECORDATORIO: { name: "edu_recordatorio_cita", lang: "es_MX", status: "APPROVED" } },
    {},
  );
  assert.equal(res.ok, true);
  assert.equal(res.templates.RECORDATORIO?.name, "edu_recordatorio_cita");
  assert.equal(
    res.templates.RECORDATORIO?.status,
    undefined,
    "el estado lo pone Meta, no el navegador",
  );
});

test("cambiar el nombre TIRA el estado viejo (otra plantilla es otra revisión)", () => {
  const previo: EduWaTemplateMap = {
    RECORDATORIO: { name: "edu_viejo", lang: "es_MX", status: "APPROVED" },
  };
  const igual = eduSanitizeWaTemplates({ RECORDATORIO: { name: "edu_viejo", lang: "es_MX" } }, previo);
  assert.equal(igual.templates.RECORDATORIO?.status, "APPROVED", "el mismo nombre conserva el estado");

  const otro = eduSanitizeWaTemplates({ RECORDATORIO: { name: "edu_nuevo", lang: "es_MX" } }, previo);
  assert.equal(
    otro.templates.RECORDATORIO?.status,
    undefined,
    "arrastrar el APPROVED de otra plantilla haría intentar una que quizá ni existe",
  );
});

test("un tipo que no viene en el cuerpo se CONSERVA; uno vacío se desregistra", () => {
  const previo = aprobadas();
  const res = eduSanitizeWaTemplates({ RECORDATORIO: { name: "", lang: "es_MX" } }, previo);
  assert.equal(res.ok, true);
  assert.equal(res.templates.RECORDATORIO, undefined, "vacío = desregistrar");
  assert.equal(
    res.templates.RECIBO?.name,
    "edu_recibo_cobro",
    "guardar una pantalla parcial no puede borrar lo que no estaba en ella",
  );
});

test("un nombre con forma inválida se rebota con un error que se puede leer", () => {
  const res = eduSanitizeWaTemplates({ RECIBO: { name: "Recibo Bonito", lang: "es_MX" } }, {});
  assert.equal(res.ok, false);
  assert.match(String(res.error), /minúsculas/);
});

// ─────────────────────────────────────────────────────────────────────
// 3 · ¿SALE O NO SALE?  (la regla que sostiene la ola)
// ─────────────────────────────────────────────────────────────────────

test("NUNCA existe un camino que devuelva texto libre: este vertical no ve la ventana de 24 h", () => {
  for (const kind of EDU_WA_KINDS) {
    const ok = eduDecideWaSend({ kind, templates: aprobadas(), params: paramsDe(kind) });
    assert.equal(ok.mode, "template");
    const sin = eduDecideWaSend({ kind, templates: {}, params: paramsDe(kind) });
    assert.equal(sin.mode, "blocked");
    // Comprobación defensiva en RUNTIME: el día que alguien añada un modo
    // "text" al tipo, esta línea revienta antes de que llegue a producción.
    for (const d of [ok, sin]) {
      assert.ok(
        d.mode === "template" || d.mode === "blocked",
        `apareció un modo nuevo (${d.mode}): este vertical no puede mandar texto libre`,
      );
    }
  }
});

test("sin plantilla registrada el aviso NO se intenta, y el motivo dice qué falta", () => {
  const d = eduDecideWaSend({
    kind: "RECORDATORIO",
    templates: {},
    params: paramsDe("RECORDATORIO"),
  });
  assert.equal(d.mode, "blocked");
  if (d.mode !== "blocked") return;
  assert.match(d.reason, /Recordatorio de cita/);
  assert.match(d.reason, /24 h/);
});

test("una plantilla en revisión o rechazada tampoco se intenta", () => {
  const enRevision = eduDecideWaSend({
    kind: "RECIBO",
    templates: { RECIBO: { name: "edu_recibo_cobro", lang: "es_MX", status: "PENDING" } },
    params: paramsDe("RECIBO"),
  });
  assert.equal(enRevision.mode, "blocked");

  const rechazada = eduDecideWaSend({
    kind: "RECIBO",
    templates: {
      RECIBO: { name: "edu_recibo_cobro", lang: "es_MX", status: "REJECTED", reason: "Texto promocional" },
    },
    params: paramsDe("RECIBO"),
  });
  assert.equal(rechazada.mode, "blocked");
  if (rechazada.mode !== "blocked") return;
  assert.match(rechazada.reason, /Texto promocional/, "el motivo de Meta se enseña tal cual");
});

test("una entrada SIN estado cuenta como aprobada (es la que se registró a mano)", () => {
  const d = eduDecideWaSend({
    kind: "RECIBO",
    templates: { RECIBO: { name: "edu_recibo_cobro", lang: "es_MX" } },
    params: paramsDe("RECIBO"),
  });
  assert.equal(d.mode, "template");
});

test("un número de datos distinto se bloquea ANTES de gastar el intento (Meta daría 132000)", () => {
  const d = eduDecideWaSend({ kind: "RECORDATORIO", templates: aprobadas(), params: ["solo", "dos"] });
  assert.equal(d.mode, "blocked");
  if (d.mode !== "blocked") return;
  assert.match(d.reason, /4 datos/);
});

test("un dato vacío se bloquea y se dice CUÁL falta (WhatsApp rechaza las variables vacías)", () => {
  const d = eduDecideWaSend({
    kind: "RECORDATORIO",
    templates: aprobadas(),
    params: ["Ana", "Instituto", "   ", "09:00"],
  });
  assert.equal(d.mode, "blocked");
  if (d.mode !== "blocked") return;
  assert.match(d.reason, /fecha/, "sin decir cuál falta, el motivo no sirve para arreglarlo");
});

// ─────────────────────────────────────────────────────────────────────
// 4 · EL ESTADO DE LA CONEXIÓN — "sin método de pago" CON ESAS PALABRAS
// ─────────────────────────────────────────────────────────────────────

test('el 131042 se lee como "Sin método de pago" y no como un fallo genérico', () => {
  const estado = eduWaConnState({
    connected: true,
    phoneNumberId: "123456789",
    hasToken: true,
    billingOk: false,
    lastErrorCode: EDU_WA_BILLING_ERROR_CODE,
  });
  assert.equal(estado, "SIN_METODO_DE_PAGO");
});

test("un token revocado (connected=false) NO se confunde con falta de tarjeta", () => {
  assert.equal(
    eduWaConnState({
      connected: false,
      phoneNumberId: "123456789",
      hasToken: true,
      billingOk: true,
      lastErrorCode: 190,
    }),
    "TOKEN_CAIDO",
  );
});

test("sin credenciales, el estado es SIN_CONECTAR aunque haya un error viejo guardado", () => {
  assert.equal(
    eduWaConnState({
      connected: false,
      phoneNumberId: null,
      hasToken: false,
      billingOk: false,
      lastErrorCode: EDU_WA_BILLING_ERROR_CODE,
    }),
    "SIN_CONECTAR",
  );
});

test("un cobro aceptado después del 131042 devuelve la conexión a CONECTADO", () => {
  // billingOk se pone a true en el primer envío de plantilla aceptado: es la
  // única señal fiable de que la WABA tiene tarjeta (Meta no la expone).
  assert.equal(
    eduWaConnState({
      connected: true,
      phoneNumberId: "123456789",
      hasToken: true,
      billingOk: true,
      lastErrorCode: EDU_WA_BILLING_ERROR_CODE,
    }),
    "CONECTADO",
  );
});

test("el detalle de cada estado explica QUÉ hacer, y el de la tarjeta manda a Meta", async () => {
  const { EDU_WA_CONN_DETAILS } = await import("../whatsapp-core");
  assert.match(EDU_WA_CONN_DETAILS.SIN_METODO_DE_PAGO, /método de pago/);
  assert.match(EDU_WA_CONN_DETAILS.SIN_METODO_DE_PAGO, /131042/);
  assert.match(
    EDU_WA_CONN_DETAILS.SIN_METODO_DE_PAGO,
    /Meta/,
    "si no dice dónde se arregla, la escuela abre un ticket contra el panel",
  );
});

// ─────────────────────────────────────────────────────────────────────
// 5 · LO QUE PUEDE SALIR HOY (readiness)
// ─────────────────────────────────────────────────────────────────────

test("con la conexión caída, NINGÚN aviso puede salir y el motivo es el de la conexión", () => {
  const filas = eduWaReadiness({
    conn: "SIN_METODO_DE_PAGO",
    templates: aprobadas(),
    enabled: { RECORDATORIO: true, CONSENTIMIENTO: true, RECIBO: true },
  });
  for (const f of filas) {
    assert.ok(f.problem, `${f.kind} debería tener un problema que enseñar`);
    assert.match(String(f.problem), /método de pago/);
  }
});

test("con todo conectado, un aviso apagado dice que está apagado (y no otra cosa)", () => {
  const filas = eduWaReadiness({
    conn: "CONECTADO",
    templates: aprobadas(),
    enabled: { RECORDATORIO: false, CONSENTIMIENTO: true, RECIBO: true },
  });
  const rec = filas.find((f) => f.kind === "RECORDATORIO")!;
  assert.equal(rec.templateOk, true);
  assert.match(String(rec.problem), /apagado/);
  assert.equal(filas.find((f) => f.kind === "RECIBO")!.problem, null);
});

test("un aviso encendido SIN plantilla dice que falta la plantilla", () => {
  const filas = eduWaReadiness({
    conn: "CONECTADO",
    templates: {},
    enabled: { RECORDATORIO: true, CONSENTIMIENTO: true, RECIBO: true },
  });
  for (const f of filas) {
    assert.equal(f.templateOk, false);
    assert.match(String(f.problem), /plantilla/);
  }
});

// ─────────────────────────────────────────────────────────────────────
// 6 · EL TELÉFONO
// ─────────────────────────────────────────────────────────────────────

test("el teléfono se limpia como lo escribe la gente, y lo que no da 10 dígitos es null", () => {
  assert.equal(eduWaPhone("55 1234 5678"), "5512345678");
  assert.equal(eduWaPhone("+52 55 1234 5678"), "5512345678");
  assert.equal(eduWaPhone("521 55 1234 5678"), "5512345678");
  assert.equal(eduWaPhone("(55) 1234-5678"), "5512345678");
  assert.equal(eduWaPhone("1234567"), null, "un fijo a medias no se manda a Meta a ver qué pasa");
  assert.equal(eduWaPhone(null), null);
  assert.equal(eduWaPhone(""), null);
});

test("el teléfono se PINTA legible y un teléfono inválido no se inventa", () => {
  assert.equal(eduWaPhoneLabel("5512345678"), "55 1234 5678");
  assert.equal(eduWaPhoneLabel("123"), "123");
  assert.equal(eduWaPhoneLabel(null), "—");
});

// ─────────────────────────────────────────────────────────────────────
// 7 · EL RECORDATORIO: CUÁNDO SALE Y CUÁL ES SU LLAVE
// ─────────────────────────────────────────────────────────────────────

test("la anticipación se acota a horas enteras entre 1 y 168", () => {
  assert.equal(eduClampReminderHours("24"), 24);
  assert.equal(eduClampReminderHours(1), EDU_REMINDER_MIN_HOURS);
  assert.equal(eduClampReminderHours(168), EDU_REMINDER_MAX_HOURS);
  assert.equal(eduClampReminderHours(0), null);
  assert.equal(eduClampReminderHours(169), null);
  assert.equal(eduClampReminderHours(-24), null);
  assert.equal(eduClampReminderHours("mañana"), null);
  assert.equal(eduClampReminderHours(null), null);
});

test("el momento del recordatorio es la hora de la cita menos la anticipación", () => {
  const cita = new Date("2026-09-14T15:00:00.000Z");
  assert.equal(
    eduReminderMoment(cita, 24).toISOString(),
    "2026-09-13T15:00:00.000Z",
  );
  assert.equal(eduReminderMoment(cita, 2).toISOString(), "2026-09-14T13:00:00.000Z");
});

/**
 * 🔴 LA PRUEBA CENTRAL DE LA OLA, MITAD 1.
 *
 * En el dental la llave de idempotencia es cita+momento+canal, SIN la hora.
 * Consecuencia: mover una cita deja una fila que TAPA el recordatorio bueno
 * —no es que llegue tarde, es que no llega nunca—. Aquí la llave lleva la
 * hora dentro, así que mover la cita produce una llave nueva.
 */
test("mover la cita CAMBIA la llave, así que la fila vieja no puede tapar el aviso bueno", () => {
  const cita = "appt_1";
  const vieja = new Date("2026-09-14T15:00:00.000Z");
  const nueva = new Date("2026-09-15T17:00:00.000Z");

  const llaveVieja = eduReminderDedupeKey(cita, 24, vieja);
  const llaveNueva = eduReminderDedupeKey(cita, 24, nueva);
  assert.notEqual(llaveVieja, llaveNueva, "sin la hora dentro, el aviso correcto no saldría nunca");
  assert.ok(llaveVieja.includes(vieja.toISOString()));
});

test("la MISMA cita a la MISMA hora da la MISMA llave (no se manda dos veces)", () => {
  const cita = new Date("2026-09-14T15:00:00.000Z");
  assert.equal(
    eduReminderDedupeKey("appt_1", 24, cita),
    eduReminderDedupeKey("appt_1", 24, new Date("2026-09-14T15:00:00.000Z")),
  );
});

test("mover una cita y devolverla a su hora recupera la llave: no se manda dos veces", () => {
  const original = new Date("2026-09-14T15:00:00.000Z");
  const movida = new Date("2026-09-16T15:00:00.000Z");
  const k1 = eduReminderDedupeKey("appt_1", 24, original);
  const k2 = eduReminderDedupeKey("appt_1", 24, movida);
  const k3 = eduReminderDedupeKey("appt_1", 24, new Date(original));
  assert.notEqual(k1, k2);
  assert.equal(k1, k3);
});

test("cambiar la anticipación también cambia la llave (es otro aviso)", () => {
  const cita = new Date("2026-09-14T15:00:00.000Z");
  assert.notEqual(eduReminderDedupeKey("a", 24, cita), eduReminderDedupeKey("a", 2, cita));
});

test("dos citas distintas nunca comparten llave", () => {
  const cita = new Date("2026-09-14T15:00:00.000Z");
  assert.notEqual(eduReminderDedupeKey("a", 24, cita), eduReminderDedupeKey("b", 24, cita));
});

// ─────────────────────────────────────────────────────────────────────
// 8 · CANCELAR AL REAGENDAR O AL CERRAR — la prueba central, mitad 2
// ─────────────────────────────────────────────────────────────────────

/**
 * 🔴 El texto del recordatorio se pinta al encolarlo, con la fecha y la hora
 * DENTRO. Si la cita se mueve y su aviso sigue en cola, al paciente le llega
 * la hora vieja — y viene un día antes, o no viene.
 */
test("reagendar CANCELA lo que estaba en cola y NO toca lo que ya salió", () => {
  const plan = planEduReminderCancel([
    { id: "m_pendiente", status: "PENDING", attempts: 1, dedupeKey: "k1" },
    { id: "m_enviado", status: "SENT", attempts: 1, dedupeKey: "k2" },
  ]);
  assert.deepEqual(plan.cancelIds, ["m_pendiente"]);
  assert.deepEqual(
    plan.keepIds,
    ["m_enviado"],
    "borrar lo enviado dejaría al instituto sin poder contestar «¿le avisamos?»",
  );
});

test("un FALLIDO también se cancela: si no, volvería a la cola con la hora vieja", () => {
  const plan = planEduReminderCancel([
    { id: "m_fallido", status: "FAILED", attempts: 1, dedupeKey: "k" },
  ]);
  assert.deepEqual(plan.cancelIds, ["m_fallido"]);
});

test("lo ya cancelado y lo bloqueado se quedan como están (cancelar dos veces no es nada)", () => {
  const plan = planEduReminderCancel([
    { id: "m_cancelado", status: "CANCELLED", attempts: 0, dedupeKey: "k1" },
    { id: "m_bloqueado", status: "BLOCKED", attempts: 0, dedupeKey: "k2" },
  ]);
  assert.deepEqual(plan.cancelIds, []);
  assert.deepEqual(plan.keepIds.sort(), ["m_bloqueado", "m_cancelado"]);
});

test("una cita sin recordatorios no produce ningún cambio", () => {
  const plan = planEduReminderCancel([]);
  assert.deepEqual(plan.cancelIds, []);
  assert.deepEqual(plan.keepIds, []);
});

/**
 * 🔴 LA SIMETRÍA QUE CIERRA EL AGUJERO. La agenda cancela el recordatorio al
 * pasar a un estado TERMINAL; el barrido solo mira los VIVOS. Si las dos
 * listas no fueran complementarias quedaría un estado en el que ni se manda
 * ni se cancela, y la fila diría "en curso" para siempre.
 */
test("los estados vivos del barrido son EXACTAMENTE el complemento de los terminales", () => {
  const TERMINALES = ["CANCELLED", "NO_SHOW", "COMPLETED"];
  const vivos = [...EDU_REMINDER_LIVE_APPOINTMENT_STATUSES] as string[];
  const todos = [...EDU_APPOINTMENT_STATUSES] as string[];

  assert.deepEqual(
    [...vivos].sort(),
    todos.filter((s) => !TERMINALES.includes(s)).sort(),
    "un estado que no está ni en vivos ni en terminales deja la fila colgada para siempre",
  );
  for (const t of TERMINALES) {
    assert.ok(todos.includes(t), `${t} ya no existe en el enum: hay que revisar la agenda`);
    assert.ok(!vivos.includes(t), `${t} no puede estar entre los estados que reciben recordatorio`);
  }
});

test("un envío abierto se reintenta hasta el tope y luego se deja en paz", () => {
  assert.equal(eduWaIsOpenStatus("PENDING", 0), true);
  assert.equal(eduWaIsOpenStatus("FAILED", 1), true);
  assert.equal(eduWaIsOpenStatus("FAILED", EDU_WA_MAX_ATTEMPTS), false, "no se le pega a Meta toda la vida");
  assert.equal(eduWaIsOpenStatus("SENT", 1), false);
  assert.equal(eduWaIsOpenStatus("CANCELLED", 0), false, "cancelar es una decisión, no un fallo");
});

/**
 * 🔴 Lo menos obvio de todo el barrido: un BLOQUEADO se vuelve a mirar.
 *
 * Un bloqueo no es un fallo, es una condición que puede DEJAR DE SER
 * VERDAD: el motivo típico es "el teléfono de la ficha no tiene 10 dígitos"
 * y recepción lo corrige a media mañana. Si BLOCKED fuera terminal, ese
 * paciente se quedaría sin recordatorio con el dato ya bueno — y volver a
 * mirarlo no cuesta una llamada a Meta, porque el bloqueo se decide ANTES
 * de la red.
 */
test("un BLOQUEADO se vuelve a mirar: el motivo puede haberse arreglado", () => {
  assert.equal(eduWaIsOpenStatus("BLOCKED", 0), true);
});

test("la gracia del barrido es la misma que la de la caducidad (si no, quedan filas colgadas)", () => {
  assert.ok(EDU_REMINDER_GRACE_MIN > 0);
  // El barrido acepta una cita cuyo momento cayó hasta GRACE minutos atrás,
  // y caducarPendientesViejos cancela lo que quedó más viejo que eso. Son el
  // mismo número a propósito: con dos distintos habría una franja en la que
  // ni se manda ni se caduca.
  assert.equal(EDU_REMINDER_GRACE_MIN, 120);
});

// ─────────────────────────────────────────────────────────────────────
// 9 · EL ALCANCE — un alumno no ve un recibo NI EN EL REGISTRO
// ─────────────────────────────────────────────────────────────────────

/**
 * 🔴 El cuerpo de un aviso de RECIBO dice el folio, el total y el saldo. Si
 * el registro se recortara SOLO por paciente, un ALUMNO abriría la ficha de
 * su propio paciente y leería cuánto pagó — justo lo que la Ola 5 cerró por
 * partida doble (permiso + alcance).
 */
test("ALUMNO y DOCENTE no ven los avisos de RECIBO ni con sus propios pacientes", () => {
  for (const rol of ["ALUMNO", "DOCENTE"] as EduRole[]) {
    const a = actor(rol);
    const where = eduWhatsappScopeWhere({
      institutionId: INST,
      patientScope: eduVisibility(a, "patients"),
      chargeScope: eduVisibility(a, "charges"),
      allPatients: false,
      patientIds: ["p_1", "p_2"],
    });
    assert.deepEqual(
      where.kind,
      { not: "RECIBO" },
      `${rol} leería el folio, el total y el saldo en el cuerpo del aviso`,
    );
    assert.deepEqual(where.patientId, { in: ["p_1", "p_2"] });
    assert.equal(where.institutionId, INST);
  }
});

test("DIRECCION y CAJA sí ven los avisos de recibo, y sin recorte por paciente", () => {
  for (const rol of ["DIRECCION", "CAJA"] as EduRole[]) {
    const a = actor(rol);
    const where = eduWhatsappScopeWhere({
      institutionId: INST,
      patientScope: eduVisibility(a, "patients"),
      chargeScope: eduVisibility(a, "charges"),
      allPatients: true,
    });
    assert.equal(where.kind, undefined, `${rol} sí ve dinero`);
    assert.equal(where.patientId, undefined);
    assert.equal(where.institutionId, INST);
  }
});

test("sin pacientes a la vista, el where no devuelve ni una fila (nunca el instituto entero)", () => {
  const a = actor("ALUMNO");
  const where = eduWhatsappScopeWhere({
    institutionId: INST,
    patientScope: eduVisibility(a, "patients"),
    chargeScope: eduVisibility(a, "charges"),
    allPatients: false,
    patientIds: [],
  });
  assert.deepEqual(where.patientId, { in: [] });
});

test("un alcance de pacientes vacío cierra la consulta entera", () => {
  const where = eduWhatsappScopeWhere({
    institutionId: INST,
    patientScope: { kind: "none" },
    chargeScope: { kind: "none" },
    allPatients: false,
    patientIds: ["p_1"],
  });
  assert.deepEqual(where, { institutionId: INST, id: { in: [] } });
});

test("sin institutionId, el where LANZA (un undefined borraría el filtro de tenant)", () => {
  assert.throws(
    () =>
      eduWhatsappScopeWhere({
        institutionId: "",
        patientScope: { kind: "all" },
        chargeScope: { kind: "all" },
        allPatients: true,
      }),
    /institutionId/,
  );
});

/** La segunda cerradura del dinero, la que no depende de ningún permiso. */
test("solo quien VE dinero puede mandar un recibo; la carta la manda cualquiera", () => {
  for (const rol of ["DIRECCION", "CAJA"] as EduRole[]) {
    assert.equal(eduCanSendWhatsappKind("RECIBO", eduVisibility(actor(rol), "charges")), true);
  }
  for (const rol of ["DOCENTE", "ALUMNO"] as EduRole[]) {
    assert.equal(
      eduCanSendWhatsappKind("RECIBO", eduVisibility(actor(rol), "charges")),
      false,
      `${rol} no manda nada de dinero, tenga el permiso que tenga`,
    );
    assert.equal(
      eduCanSendWhatsappKind("CONSENTIMIENTO", eduVisibility(actor(rol), "charges")),
      true,
      "la carta sí: se firma en el sillón",
    );
  }
});

// ─────────────────────────────────────────────────────────────────────
// 10 · LO QUE SE LE PINTA A UNA PERSONA
// ─────────────────────────────────────────────────────────────────────

test("cada estado de envío tiene etiqueta y explicación en español", () => {
  for (const s of EDU_WA_STATUSES) {
    assert.ok(EDU_WA_STATUS_LABELS[s], `falta la etiqueta de ${s}`);
    assert.ok(EDU_WA_STATUS_DETAILS[s], `falta la explicación de ${s}`);
  }
});

/**
 * ⚠️ Sin los acuses de entrega (que este vertical no ingiere) lo único que
 * sabemos es que Meta ACEPTÓ el mensaje. Decir "Entregado" a secas es el
 * fallo mudo de siempre.
 */
test('SENT dice "Entregado a WhatsApp" y no "Entregado" a secas', () => {
  assert.equal(EDU_WA_STATUS_LABELS.SENT, "Entregado a WhatsApp");
  assert.match(EDU_WA_STATUS_DETAILS.SENT, /acuses de entrega/);
});

test('BLOCKED se lee como "No se intentó" (no como un fallo de Meta)', () => {
  assert.equal(EDU_WA_STATUS_LABELS.BLOCKED, "No se intentó");
});
