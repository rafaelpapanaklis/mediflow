/**
 * ws1-t4 · Auditoría BEVADENT (F4/M7, F5, F17 parte WhatsApp).
 *
 *   · cancelación y seguimiento post-cita tienen plantilla UTILITY propia, se
 *     crean solas y sus envíos la usan (y no la de otro tipo que mentiría);
 *   · cumpleaños y reactivación (MARKETING) están redactadas pero APAGADAS;
 *   · la nota de la ventana de 24 h solo sale si la plantilla de recordatorio
 *     no está aprobada;
 *   · ningún tipo del catálogo ni del Inbox muestra una clave sin traducir.
 *
 * Run: npm run test:wa-plantillas-t4
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_CATALOG_KINDS,
  PLANTILLAS_MARKETING_AUTOMATICAS_ENCENDIDAS,
  WA_PLANTILLAS_MARKETING_EN_ESPERA,
  WA_TEMPLATE_CATALOG,
  catalogEntryFor,
  checkCatalogEntry,
} from "../templates-catalog";
import { parseWaTemplates, renderTemplateBody, specForKind } from "../template-config";
import { decideSendMode } from "../send-mode";
import { WHATSAPP_SEND_KINDS } from "../system-message";
import { MOTIVO_SIN_PLANTILLA_PARA_TIPO, motivoDeBloqueo } from "../sin-plantilla";
import { envioDeResolucion, kindDeAvisoCita, paramsDeAvisoCita } from "../avisos-cita-plantilla";
import { plantillaDeFila } from "../plantilla-de-fila";
import { avisoRecallSinPlantilla, cuerpoNotaVentana24 } from "../ventana-24h";

const SRC = join(__dirname, "..", "..", "..");
const dic = (lang: string) =>
  JSON.parse(readFileSync(join(SRC, "i18n", "dictionaries", `${lang}.json`), "utf8"));
const leer = (d: any, clave: string) => clave.split(".").reduce((o, k) => (o ? o[k] : undefined), d);

const aprobada = (kind: string, name: string) => ({ [kind]: { name, lang: "es_MX", status: "APPROVED" } }) as any;
const DATOS = { paciente: "María", clinica: "Clínica Sonrisa", fecha: "lunes 11 de agosto", hora: "10:00", doctor: "Dr/a. Ana Ruiz" };

/* ── Catálogo ─────────────────────────────────────────────────────────── */

test("cancelación y seguimiento: UTILITY, válidas para Meta y de las que se crean solas", () => {
  for (const kind of ["appointment_cancelled", "followup"] as const) {
    const e = catalogEntryFor(kind);
    assert.ok(e, `${kind}: falta en el catálogo`);
    assert.equal(e!.category, "UTILITY");
    assert.equal(e!.optional, false, `${kind}: si fuera opcional no se daría de alta al conectar ni por el cron`);
    assert.equal(checkCatalogEntry(e!), null);
    assert.ok(DEFAULT_CATALOG_KINDS.includes(kind));
  }
  assert.equal(catalogEntryFor("appointment_cancelled")!.name, "dc_cancelacion_cita");
  assert.equal(catalogEntryFor("followup")!.name, "dc_seguimiento_cita");
});

test("cumpleaños y reactivación: MARKETING, redactadas, y APAGADAS mientras Rafael no decida", () => {
  assert.equal(PLANTILLAS_MARKETING_AUTOMATICAS_ENCENDIDAS, false);
  assert.deepEqual(WA_PLANTILLAS_MARKETING_EN_ESPERA.map((e) => e.kind).sort(), ["birthday", "recall"]);
  for (const e of WA_PLANTILLAS_MARKETING_EN_ESPERA) {
    assert.equal(e.category, "MARKETING");
    assert.equal(e.optional, true);
    assert.equal(checkCatalogEntry(e), null, `${e.name}: la redacción en espera también debe pasar las reglas de Meta`);
    // Apagadas = fuera del catálogo: nadie las da de alta, la pantalla no las
    // enseña y una entrada guardada en waTemplates no se lee.
    assert.equal(catalogEntryFor(e.kind), null);
    assert.ok(!WA_TEMPLATE_CATALOG.some((c) => c.name === e.name));
    assert.ok(!DEFAULT_CATALOG_KINDS.includes(e.kind));
    assert.deepEqual(parseWaTemplates({ [e.kind]: { name: e.name, lang: "es_MX", status: "APPROVED" } }), {});
  }
});

/* ── Cancelación ──────────────────────────────────────────────────────── */

test("el aviso de cancelación usa SU plantilla, con datos, y ya no se bloquea fuera de ventana", () => {
  assert.equal(kindDeAvisoCita("cancelada"), "appointment_cancelled");
  assert.equal(kindDeAvisoCita("agendada"), "booking");
  assert.equal(kindDeAvisoCita("reprogramada"), "appointment_change");
  const params = paramsDeAvisoCita("cancelada", DATOS);
  const d = decideSendMode({
    kind: "appointment_cancelled",
    windowOpen: false,
    templates: aprobada("appointment_cancelled", "dc_cancelacion_cita"),
    params,
  });
  assert.equal(d.mode, "template");
  const texto = renderTemplateBody(specForKind("appointment_cancelled"), params, "");
  assert.match(texto, /fue cancelada/);
  assert.doesNotMatch(texto, /cambió/, "la cancelación nunca dice que la cita «cambió»");
  assert.match(texto, /lunes 11 de agosto a las 10:00/);
});

test("la plantilla de reagendado NUNCA se usa para cancelar (aunque esté aprobada)", () => {
  // Con solo la de «cambió al…» aprobada, la cancelación se bloquea con motivo.
  const d = decideSendMode({
    kind: kindDeAvisoCita("cancelada"),
    windowOpen: false,
    templates: aprobada("appointment_change", "dc_reagendado_cita"),
    params: paramsDeAvisoCita("cancelada", DATOS),
  });
  assert.equal(d.mode, "blocked");
});

test("resolución del portal: cancelación aprobada → plantilla de cancelación; rechazo → sin plantilla", () => {
  assert.deepEqual(envioDeResolucion({ status: "APPROVED", type: "CANCEL" }, DATOS), {
    kind: "appointment_cancelled",
    templateParams: ["María", "Clínica Sonrisa", "lunes 11 de agosto", "10:00"],
  });
  assert.deepEqual(envioDeResolucion({ status: "APPROVED", type: "RESCHEDULE" }, DATOS), {
    kind: "appointment_change",
    templateParams: ["María", "Clínica Sonrisa", "lunes 11 de agosto", "10:00", "Dr/a. Ana Ruiz"],
  });
  for (const type of ["CANCEL", "RESCHEDULE"]) {
    assert.deepEqual(envioDeResolucion({ status: "REJECTED", type }, DATOS), {
      kind: "appointment_change",
      templateParams: null,
    });
  }
});

/* ── Cola: seguimiento, cumpleaños, recall ────────────────────────────── */

const cita = new Date("2026-08-11T16:00:00Z"); // 10:00 en Ciudad de México
const fila = (type: string, startsAt: Date | null = cita) => ({
  type,
  startsAt,
  doctor: { firstName: "Ana", lastName: "Ruiz" },
  firstName: "María",
  clinicName: "Clínica Sonrisa",
  timezone: "America/Mexico_City",
});

test("el seguimiento post-cita ya NO sale con la plantilla de recordatorio (la de la fecha pasada)", () => {
  const p = plantillaDeFila(fila("FOLLOWUP"));
  assert.equal(p.kind, "followup");
  assert.deepEqual(p.params, ["María", "Clínica Sonrisa", "martes, 11 de agosto"]);
  // Con SOLO la de recordatorio aprobada, el seguimiento se bloquea: nunca «te recordamos tu cita».
  const soloRecordatorio = decideSendMode({
    kind: p.kind,
    windowOpen: false,
    templates: aprobada("reminder", "dc_recordatorio_cita"),
    params: p.params,
  });
  assert.equal(soloRecordatorio.mode, "blocked");
  // Con la suya aprobada, sale.
  const conLaSuya = decideSendMode({
    kind: p.kind,
    windowOpen: false,
    templates: aprobada("followup", "dc_seguimiento_cita"),
    params: p.params,
  });
  assert.equal(conLaSuya.mode, "template");
  const texto = renderTemplateBody(specForKind("followup"), p.params!, "");
  assert.doesNotMatch(texto, /te recordamos/i);
});

test("el recordatorio de cita sigue igual: tipo reminder y sus cinco datos", () => {
  const p = plantillaDeFila(fila("APPT_AUTO"));
  assert.equal(p.kind, "reminder");
  assert.deepEqual(p.params, ["María", "Clínica Sonrisa", "martes, 11 de agosto", "10:00", "Dr/a. Ana Ruiz"]);
  assert.deepEqual(plantillaDeFila(fila("APPT_AUTO", null)), { kind: "reminder", params: null });
});

test("cumpleaños y recall: tipo propio; con su plantilla apagada siguen bloqueados como hoy, con el motivo real", () => {
  for (const [type, kind] of [["BIRTHDAY", "birthday"], ["RECALL", "recall"]] as const) {
    const p = plantillaDeFila(fila(type, null));
    assert.equal(p.kind, kind);
    assert.deepEqual(p.params, ["María", "Clínica Sonrisa"]);
    // Aunque la clínica tenga TODO aprobado (incluso una entrada vieja con ese nombre).
    const templates = {
      ...aprobada("reminder", "dc_recordatorio_cita"),
      ...aprobada(kind, kind === "birthday" ? "dc_cumpleanos" : "dc_reactivacion"),
    };
    const d = decideSendMode({ kind: p.kind, windowOpen: false, templates: parseWaTemplates(templates), params: p.params });
    assert.equal(d.mode, "blocked");
    assert.equal(motivoDeBloqueo({ reason: (d as any).reason, cuelgaDeCita: false }), MOTIVO_SIN_PLANTILLA_PARA_TIPO);
    // Con la ventana abierta salen como siempre (texto libre).
    assert.equal(decideSendMode({ kind: p.kind, windowOpen: true, templates, params: p.params }).mode, "text");
  }
});

/* ── F5: la nota de la ventana de 24 h ────────────────────────────────── */

test("la nota de la ventana de 24 h NO sale con la plantilla de recordatorio aprobada", () => {
  assert.equal(cuerpoNotaVentana24("approved"), null);
  assert.equal(cuerpoNotaVentana24("missing"), "inbox.whatsapp.window24BodyMissing");
  assert.equal(cuerpoNotaVentana24("pending"), "inbox.whatsapp.window24BodyPending");
  assert.equal(cuerpoNotaVentana24("rejected"), "inbox.whatsapp.window24BodyRejected");
});

test("la nota ya no dice que la plantilla «todavía no está disponible en DaleControl»", () => {
  for (const lang of ["es", "en"]) {
    const d = dic(lang);
    for (const estado of ["missing", "pending", "rejected"] as const) {
      const clave = cuerpoNotaVentana24(estado)!;
      const texto = leer(d, clave);
      assert.ok(typeof texto === "string" && texto.length > 0, `${lang}: falta ${clave}`);
      assert.doesNotMatch(texto, /no está disponible en DaleControl|not available in DaleControl/);
    }
    assert.equal(leer(d, "inbox.whatsapp.window24Body"), undefined, `${lang}: el texto viejo debe irse`);
    assert.ok(leer(d, "inbox.whatsapp.window24Cta"), `${lang}: falta window24Cta`);
  }
});

test("Reactivación avisa que por WhatsApp, fuera de 24 h, no sale sin plantilla", () => {
  assert.match(avisoRecallSinPlantilla("whatsapp")!, /últimas 24 horas/);
  assert.match(avisoRecallSinPlantilla("both")!, /correo sí/);
  assert.equal(avisoRecallSinPlantilla("email"), null);
});

/* ── F17: ninguna clave sin traducir ──────────────────────────────────── */

test("cada plantilla del catálogo (y las de marketing en espera) tiene nombre y variables traducidos", () => {
  for (const lang of ["es", "en"]) {
    const d = dic(lang);
    for (const e of [...WA_TEMPLATE_CATALOG, ...WA_PLANTILLAS_MARKETING_EN_ESPERA]) {
      for (const clave of [e.labelKey, ...e.variableKeys]) {
        assert.equal(typeof leer(d, clave), "string", `${lang}: «${clave}» (${e.name}) se vería sin traducir`);
      }
    }
  }
});

test("cada tipo de envío automático tiene su etiqueta en el Inbox", () => {
  for (const lang of ["es", "en"]) {
    const labels = leer(dic(lang), "inbox.client.autoLabel");
    for (const kind of WHATSAPP_SEND_KINDS) {
      assert.equal(typeof labels[kind], "string", `${lang}: el Inbox pintaría «inbox.client.autoLabel.${kind}»`);
    }
  }
});

test("«Aviso al cancelar» ya no dice que no hay plantilla de cancelación", () => {
  for (const lang of ["es", "en"]) {
    const texto = leer(dic(lang), "inbox.whatsapp.eventCancelDesc");
    assert.equal(typeof texto, "string");
    assert.doesNotMatch(texto, /todavía no hay plantilla|there is no Meta-approved/);
    assert.match(texto, /plantilla de cancelación|cancellation template/);
  }
});
