// Plantillas de Meta en el composer del Inbox — decisión pura, sin BD ni red.
//
// Lo que protegen estos tests es lo que el usuario ve cuando la ventana de 24 h
// está CERRADA y la plantilla es el único mensaje que Meta entrega:
//   · que el motivo del bloqueo apunte a la pantalla correcta (el ESTADO en
//     Meta manda sobre los datos del paciente: si la plantilla ni existe,
//     decir "faltan datos" manda a la clínica a arreglar lo que no está roto);
//   · que la vista previa sea EXACTAMENTE lo que recibiría el paciente, con
//     las variables sustituidas POR POSICIÓN — Meta las sustituye así, y un
//     orden cambiado entrega el mensaje con los datos en el sitio del otro.
//
// Correr: npm run test:inbox-templates

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildInboxTemplateOption,
  describeNoTemplatesAvailable,
  describeTemplateState,
  INBOX_COMPOSER_KINDS,
  type InboxTemplateOption,
} from "../composer-templates";
// `templateUiState` y su tipo viven en el CATÁLOGO, no en template-config: ese
// último no los re-exporta. Importarlos de ahí compila en tsx (que borra los
// tipos) pero revienta en `next build` con TS2305.
import { catalogEntryFor, type WaTemplateUiState } from "../../whatsapp/templates-catalog";

// Entradas REALES del catálogo: si mañana cambian el cuerpo o el número de
// variables, estos tests se enteran (que es justo lo que queremos).
const REVIEW = catalogEntryFor("review")!;     // 2 variables: paciente, clínica
const REMINDER = catalogEntryFor("reminder")!; // 5 variables, la última el doctor

const APROBADA = { name: "dc_invitacion_resena", lang: "es_MX", status: "APPROVED" as const };

/* ─────────────── describeTemplateState ─────────────── */

test("una plantilla APROBADA no tiene nada que explicar", () => {
  assert.equal(describeTemplateState("approved"), null);
});

test("SIN dar de alta se explica como alta pendiente en Meta", () => {
  const motivo = describeTemplateState("missing");
  assert.ok(motivo);
  assert.match(motivo!, /dada de alta en Meta/i);
});

test("EN REVISIÓN dice que Meta todavía la mira, no que esté mal", () => {
  const motivo = describeTemplateState("pending");
  assert.ok(motivo);
  assert.match(motivo!, /revisando/i);
});

test("RECHAZADA lo dice, y arrastra el motivo de Meta cuando lo hay", () => {
  const sinMotivo = describeTemplateState("rejected");
  assert.ok(sinMotivo);
  assert.match(sinMotivo!, /rechaz/i);

  // El motivo de Meta es lo ÚNICO accionable que tiene la clínica: si se
  // perdiera por el camino, el mensaje quedaría en "no se puede y no sé por qué".
  const conMotivo = describeTemplateState("rejected", {
    name: "dc_invitacion_resena",
    lang: "es_MX",
    status: "REJECTED",
    reason: "Contenido promocional.",
  });
  assert.ok(conMotivo);
  assert.match(conMotivo!, /Contenido promocional/);
});

test("una entrada SIN status cuenta como aprobada (las registradas a mano)", () => {
  // Mismo criterio que templateUiState y que decideSendMode: si la clínica la
  // escribió en la pantalla vieja era porque ya se la habían aprobado.
  // Tratarla como "en revisión" apagaría envíos que hoy funcionan.
  const o = buildInboxTemplateOption({
    entry: REVIEW,
    cfg: { name: "dc_invitacion_resena", lang: "es_MX" },
    params: ["María", "Clínica Sonrisa"],
  });
  assert.equal(o.state, "approved");
  assert.equal(o.blockedReason, null);
  assert.equal(describeTemplateState(o.state, { name: "x", lang: "es_MX" }), null);
});

/* ─────────────── buildInboxTemplateOption · el camino feliz ─────────────── */

test("aprobada y con datos: se puede enviar y la vista previa es el mensaje real", () => {
  const o = buildInboxTemplateOption({
    entry: REVIEW,
    cfg: APROBADA,
    params: ["María", "Clínica Sonrisa"],
  });
  assert.equal(o.kind, "review");
  assert.equal(o.labelKey, REVIEW.labelKey);
  assert.equal(o.state, "approved");
  assert.equal(o.blockedReason, null);
  assert.ok(o.preview);
  assert.match(o.preview!, /María/);
  assert.match(o.preview!, /Clínica Sonrisa/);
  // Ni un hueco sin rellenar: lo que se ve es lo que llega.
  assert.doesNotMatch(o.preview!, /\{\{\d+\}\}/);
});

test("las variables se sustituyen POR POSICIÓN, en el orden del cuerpo", () => {
  // {{1}} = paciente y {{2}} = clínica, y en el cuerpo {{1}} va antes.
  const o = buildInboxTemplateOption({ entry: REVIEW, cfg: APROBADA, params: ["AAA", "BBB"] });
  assert.ok(o.preview);
  assert.ok(o.preview!.indexOf("AAA") < o.preview!.indexOf("BBB"));

  // Y con los valores cambiados de sitio, el preview cambia de sitio también:
  // sin esto, un renderizador que ignorara el índice pasaría el test anterior.
  const alReves = buildInboxTemplateOption({
    entry: REVIEW,
    cfg: APROBADA,
    params: ["BBB", "AAA"],
  });
  assert.ok(alReves.preview);
  assert.ok(alReves.preview!.indexOf("BBB") < alReves.preview!.indexOf("AAA"));
  assert.notEqual(alReves.preview, o.preview);
});

test("una plantilla de 5 variables las rellena todas, incluida la {{5}}", () => {
  const params = ["María", "Clínica Sonrisa", "lunes 11 de agosto", "10:00", "Dra. Ana Ruiz"];
  const o = buildInboxTemplateOption({
    entry: REMINDER,
    cfg: { name: "dc_recordatorio_cita", lang: "es_MX", status: "APPROVED" },
    params,
  });
  assert.equal(o.blockedReason, null);
  assert.ok(o.preview);
  for (const p of params) assert.ok(o.preview!.includes(p), `falta "${p}" en la vista previa`);
  assert.doesNotMatch(o.preview!, /\{\{\d+\}\}/);
});

/* ─────────────── el ESTADO manda sobre los datos ─────────────── */

test("sin dar de alta en Meta, el motivo habla del alta y NO de datos que falten", () => {
  // El orden importa: con params COMPLETOS, el único problema es el alta. Si
  // el módulo mirara primero los datos, la clínica se iría a revisar la ficha
  // del paciente en vez de a crear la plantilla.
  const o = buildInboxTemplateOption({
    entry: REVIEW,
    cfg: null,
    params: ["María", "Clínica Sonrisa"],
  });
  assert.equal(o.state, "missing");
  assert.ok(o.blockedReason);
  assert.match(o.blockedReason!, /dada de alta en Meta/i);
  assert.doesNotMatch(o.blockedReason!, /faltan datos/i);
  // Sin plantilla no hay nada que previsualizar: enseñar el texto invitaría a
  // pensar que ese mensaje se puede mandar.
  assert.equal(o.preview, null);
});

test("el estado gana incluso a un missingDataReason explícito", () => {
  const o = buildInboxTemplateOption({
    entry: REVIEW,
    cfg: null,
    params: null,
    missingDataReason: "Este paciente no tiene citas.",
  });
  assert.ok(o.blockedReason);
  assert.match(o.blockedReason!, /dada de alta en Meta/i);
  assert.doesNotMatch(o.blockedReason!, /no tiene citas/i);
});

test("en revisión y rechazada tampoco se pueden enviar, con datos o sin ellos", () => {
  const pendiente = buildInboxTemplateOption({
    entry: REVIEW,
    cfg: { ...APROBADA, status: "PENDING" },
    params: ["María", "Clínica Sonrisa"],
  });
  assert.equal(pendiente.state, "pending");
  assert.ok(pendiente.blockedReason);
  assert.equal(pendiente.preview, null);

  const rechazada = buildInboxTemplateOption({
    entry: REVIEW,
    cfg: { ...APROBADA, status: "REJECTED", reason: "Formato inválido." },
    params: ["María", "Clínica Sonrisa"],
  });
  assert.equal(rechazada.state, "rejected");
  assert.ok(rechazada.blockedReason);
  assert.match(rechazada.blockedReason!, /Formato inválido/);
  assert.equal(rechazada.preview, null);
});

/* ─────────────── buildInboxTemplateOption · los datos ─────────────── */

test("aprobada pero sin datos: se bloquea y no se inventa una vista previa", () => {
  // Meta rechazaría con 132000. Bloquear antes de enviar ahorra el intento y
  // deja un motivo que la clínica entiende.
  const o = buildInboxTemplateOption({ entry: REVIEW, cfg: APROBADA, params: null });
  assert.equal(o.state, "approved");
  assert.ok(o.blockedReason);
  assert.match(o.blockedReason!, /faltan datos/i);
  assert.equal(o.preview, null);
});

test("un número de datos distinto al de variables bloquea (de menos y de más)", () => {
  const deMenos = buildInboxTemplateOption({ entry: REVIEW, cfg: APROBADA, params: ["María"] });
  assert.ok(deMenos.blockedReason);
  assert.equal(deMenos.preview, null);

  // De más también: Meta cuenta los parámetros y falla igual.
  const deMas = buildInboxTemplateOption({
    entry: REVIEW,
    cfg: APROBADA,
    params: ["María", "Clínica Sonrisa", "sobra"],
  });
  assert.ok(deMas.blockedReason);
  assert.equal(deMas.preview, null);
});

test("un dato vacío o en blanco bloquea: Meta no acepta parámetros vacíos", () => {
  const vacio = buildInboxTemplateOption({ entry: REVIEW, cfg: APROBADA, params: ["María", ""] });
  assert.ok(vacio.blockedReason);
  assert.equal(vacio.preview, null);

  // Solo espacios es lo mismo que vacío: si no se comprobara, el paciente
  // recibiría "gracias por tu visita a  ." con el hueco en blanco.
  const espacios = buildInboxTemplateOption({
    entry: REVIEW,
    cfg: APROBADA,
    params: ["María", "   "],
  });
  assert.ok(espacios.blockedReason);
  assert.equal(espacios.preview, null);
});

test("cuando el caller sabe POR QUÉ faltan los datos, ese motivo es el que se ve", () => {
  const o = buildInboxTemplateOption({
    entry: REMINDER,
    cfg: { name: "dc_recordatorio_cita", lang: "es_MX", status: "APPROVED" },
    params: null,
    missingDataReason: "Este paciente no tiene ninguna cita futura agendada.",
  });
  assert.equal(o.blockedReason, "Este paciente no tiene ninguna cita futura agendada.");
  assert.equal(o.preview, null);
});

/* ─────────────── describeNoTemplatesAvailable ─────────────── */

function opt(
  state: WaTemplateUiState,
  blockedReason: string | null = null,
): InboxTemplateOption {
  return { kind: "review", labelKey: "inbox.whatsapp.tplKindReview", state, blockedReason, preview: null };
}

test("si al menos una plantilla sirve, no hay nada que avisar", () => {
  const msg = describeNoTemplatesAvailable({
    options: [opt("missing", "no está dada de alta"), opt("approved", null)],
    waConnected: true,
    billingOk: true,
  });
  assert.equal(msg, null);
});

test("sin WhatsApp conectado, el aviso manda a conectarlo (la causa raíz)", () => {
  const msg = describeNoTemplatesAvailable({
    options: [opt("missing", "no está dada de alta")],
    waConnected: false,
    billingOk: false,
  });
  assert.ok(msg);
  assert.match(msg!, /no está conectado/i);
  assert.match(msg!, /Configuración/);
});

test("plantillas APROBADAS y sin método de pago: el aviso habla del pago", () => {
  // El aviso del método de pago es la explicación que queda cuando las
  // plantillas SÍ están aprobadas y aun así no sale nada.
  const msg = describeNoTemplatesAvailable({
    options: [opt("approved", "faltan datos")],
    waConnected: true,
    billingOk: false,
  });
  assert.ok(msg);
  assert.match(msg!, /método de pago/i);
});

test("SIN plantillas y con billingOk en false, manda a crearlas — NO al método de pago", () => {
  // El camino inverso del test de arriba, y el estado REAL de toda clínica que
  // todavía no ha enviado ninguna plantilla: `Clinic.waBillingOk` es
  // `@default(false)` y solo pasa a true cuando un envío de plantilla sale
  // bien. Si el aviso del pago se evaluara primero (como estaba), la clínica
  // sin plantillas leería "revisa tu tarjeta en Meta" y se iría a la pantalla
  // equivocada… de la que no podría salir, porque para levantar esa bandera
  // hace falta enviar una plantilla, que es justo lo que le falta.
  const msg = describeNoTemplatesAvailable({
    options: [opt("missing", "no está dada de alta"), opt("missing", "no está dada de alta")],
    waConnected: true,
    billingOk: false,
  });
  assert.ok(msg);
  assert.match(msg!, /Plantillas/);
  assert.doesNotMatch(msg!, /método de pago/i);
});

test("en revisión y sin método de pago: primero lo de Meta revisando", () => {
  const msg = describeNoTemplatesAvailable({
    options: [opt("pending", "en revisión")],
    waConnected: true,
    billingOk: false,
  });
  assert.ok(msg);
  assert.match(msg!, /revisando/i);
  assert.doesNotMatch(msg!, /método de pago/i);
});

test("ninguna dada de alta: manda a la pantalla de Plantillas", () => {
  const msg = describeNoTemplatesAvailable({
    options: [opt("missing", "no está dada de alta"), opt("missing", "no está dada de alta")],
    waConnected: true,
    billingOk: true,
  });
  assert.ok(msg);
  assert.match(msg!, /Plantillas/);
  assert.match(msg!, /24 h/);
});

test("sin ninguna opción, el aviso es el mismo que cuando ninguna está dada de alta", () => {
  const msg = describeNoTemplatesAvailable({ options: [], waConnected: true, billingOk: true });
  assert.ok(msg);
  assert.match(msg!, /Plantillas/);
});

test("mezcla de en revisión y sin alta: dice que Meta las está revisando", () => {
  // Es lo accionable: no hay nada que hacer más que esperar.
  const msg = describeNoTemplatesAvailable({
    options: [opt("pending", "Meta la revisa"), opt("missing", "no está dada de alta")],
    waConnected: true,
    billingOk: true,
  });
  assert.ok(msg);
  assert.match(msg!, /revisando/i);
});

test("aprobadas pero sin datos: el aviso apunta al paciente, no a Meta", () => {
  const msg = describeNoTemplatesAvailable({
    options: [opt("approved", "faltan datos"), opt("approved", "faltan datos")],
    waConnected: true,
    billingOk: true,
  });
  assert.ok(msg);
  assert.match(msg!, /cita agendada|saldo pendiente/i);
});

/* ─────────────── el catálogo del composer ─────────────── */

test("todos los tipos que ofrece el composer existen en el catálogo", () => {
  // Un kind sin entrada en el catálogo saldría como un chip que no se puede
  // rellenar ni enviar: otro botón muerto, que es el fallo que cierra M-23.
  for (const kind of INBOX_COMPOSER_KINDS) {
    assert.ok(catalogEntryFor(kind), `el kind "${kind}" no está en WA_TEMPLATE_CATALOG`);
  }
});
