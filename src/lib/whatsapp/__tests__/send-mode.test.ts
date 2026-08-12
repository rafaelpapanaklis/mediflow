// Texto libre vs plantilla — la decisión del P0 (M-09), pura y sin BD.
//   npm run test:wa-send-mode

import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSendMode } from "../send-mode";
import { parseWaTemplates, renderTemplateBody, specForKind } from "../template-config";

const TPL = { reminder: { name: "dc_recordatorio_cita", lang: "es_MX" } };
// Cinco datos: la plantilla de recordatorio lleva {{5}} = doctor (ver el
// catálogo). El número tiene que coincidir con el del catálogo o Meta rechaza.
const PARAMS = ["María", "Clínica Sonrisa", "lunes 11 de agosto", "10:00", "Dra. Ana Ruiz"];

/* ─────────────── dentro de la ventana ─────────────── */

test("con la ventana abierta se manda texto libre (gratis, como hasta hoy)", () => {
  const d = decideSendMode({ kind: "reminder", windowOpen: true, templates: {} });
  assert.equal(d.mode, "text");
});

test("con la ventana abierta NO se gasta una plantilla aunque esté configurada", () => {
  // Meta le cobra cada plantilla a la clínica: dentro de ventana sería tirar
  // dinero por un mensaje que el texto libre entrega igual.
  const d = decideSendMode({
    kind: "reminder",
    windowOpen: true,
    templates: TPL,
    params: PARAMS,
  });
  assert.equal(d.mode, "text");
});

/* ─────────────── fuera de la ventana ─────────────── */

test("fuera de ventana, con plantilla y datos, se manda la plantilla", () => {
  const d = decideSendMode({
    kind: "reminder",
    windowOpen: false,
    templates: TPL,
    params: PARAMS,
  });
  assert.equal(d.mode, "template");
  if (d.mode !== "template") return;
  assert.equal(d.template.name, "dc_recordatorio_cita");
  assert.equal(d.template.lang, "es_MX");
  assert.deepEqual(d.params, PARAMS);
});

test("fuera de ventana y SIN plantilla no se envía: es el P0", () => {
  // Este es el fallo que arregla la tarea. Antes salía texto libre, Meta lo
  // rechazaba con 131047 y el panel lo daba por "Enviado".
  const d = decideSendMode({
    kind: "reminder",
    windowOpen: false,
    templates: {},
    params: PARAMS,
  });
  assert.equal(d.mode, "blocked");
});

test("JAMÁS se devuelve texto libre con la ventana cerrada", () => {
  // La garantía central, sobre todas las combinaciones que se pueden dar.
  const combos = [
    { templates: {}, params: PARAMS },
    { templates: {}, params: null },
    { templates: TPL, params: null },
    { templates: TPL, params: [] },
    { templates: TPL, params: ["solo", "dos"] },
    { templates: TPL, params: PARAMS },
  ];
  for (const c of combos) {
    const d = decideSendMode({ kind: "reminder", windowOpen: false, ...c });
    assert.notEqual(d.mode, "text");
  }
});

test("el motivo del bloqueo es el que sabe traducir el panel", () => {
  const d = decideSendMode({ kind: "reminder", windowOpen: false, templates: {} });
  assert.equal(d.mode, "blocked");
  if (d.mode !== "blocked") return;
  // Acoplamiento a propósito: describeReminderError reconoce este texto como
  // "templateNotConfigured". Si cambia sin tocar allí, el panel enseña el crudo.
  assert.match(d.reason, /falta configurar la plantilla/i);
});

/* ─────────────── estado de la plantilla en Meta ─────────────── */

test("una plantilla EN REVISIÓN no se envía: Meta la rechazaría con 132001", () => {
  // Desde que DaleControl las crea solo, `waTemplates` puede tener una
  // plantilla registrada que Meta todavía no aprobó. Mandarla gasta el intento
  // para nada.
  const d = decideSendMode({
    kind: "reminder",
    windowOpen: false,
    templates: { reminder: { ...TPL.reminder, status: "PENDING" } },
    params: PARAMS,
  });
  assert.equal(d.mode, "blocked");
  if (d.mode !== "blocked") return;
  // Texto acoplado a describeReminderError → "templatePending".
  assert.match(d.reason, /todavía no aprueba la plantilla/i);
});

test("una plantilla RECHAZADA no se envía y arrastra el motivo de Meta", () => {
  const d = decideSendMode({
    kind: "reminder",
    windowOpen: false,
    templates: {
      reminder: { ...TPL.reminder, status: "REJECTED", reason: "Contenido promocional." },
    },
    params: PARAMS,
  });
  assert.equal(d.mode, "blocked");
  if (d.mode !== "blocked") return;
  assert.match(d.reason, /meta rechazó la plantilla/i);
  assert.match(d.reason, /Contenido promocional/);
});

test("APROBADA envía, y SIN estado también (las que se registraron a mano)", () => {
  const aprobada = decideSendMode({
    kind: "reminder",
    windowOpen: false,
    templates: { reminder: { ...TPL.reminder, status: "APPROVED" } },
    params: PARAMS,
  });
  assert.equal(aprobada.mode, "template");

  // Sin `status`: entrada vieja escrita por la clínica en la pantalla anterior.
  // Tratarla como "en revisión" apagaría envíos que hoy funcionan.
  const legado = decideSendMode({
    kind: "reminder",
    windowOpen: false,
    templates: TPL,
    params: PARAMS,
  });
  assert.equal(legado.mode, "template");
});

/* ─────────────── validación de los datos ─────────────── */

test("no se envía si faltan datos: Meta rechazaría con 132000", () => {
  const d = decideSendMode({
    kind: "reminder",
    windowOpen: false,
    templates: TPL,
    params: ["María", "Clínica Sonrisa"],
  });
  assert.equal(d.mode, "blocked");
  if (d.mode !== "blocked") return;
  assert.match(d.reason, /5 datos y se prepararon 2/);
});

test("un dato vacío bloquea e indica CUÁL falta", () => {
  const d = decideSendMode({
    kind: "reminder",
    windowOpen: false,
    templates: TPL,
    params: ["María", "", "lunes", "10:00", "Dra. Ana Ruiz"],
  });
  assert.equal(d.mode, "blocked");
  if (d.mode !== "blocked") return;
  assert.match(d.reason, /\{\{2\}\}/);
});

test("los datos se recortan antes de enviarse", () => {
  const d = decideSendMode({
    kind: "reminder",
    windowOpen: false,
    templates: TPL,
    params: ["  María  ", "Clínica", "lunes", "10:00", "Dra. Ana Ruiz"],
  });
  assert.equal(d.mode, "template");
  if (d.mode !== "template") return;
  assert.equal(d.params[0], "María");
});

test("un tipo sin plantilla definida se bloquea con su propio motivo", () => {
  // "system" son los avisos a la propia clínica (saldo de IA, pagos): no están
  // en el catálogo, así que fuera de ventana no pueden salir.
  const d = decideSendMode({ kind: "system", windowOpen: false, templates: {} });
  assert.equal(d.mode, "blocked");
  if (d.mode !== "blocked") return;
  assert.match(d.reason, /todavía no admite plantilla/i);
});

/* ─────────────── parseWaTemplates ─────────────── */

test("parseWaTemplates acepta lo bien formado", () => {
  const out = parseWaTemplates({ reminder: { name: "dc_recordatorio_cita", lang: "es_MX" } });
  assert.deepEqual(out.reminder, { name: "dc_recordatorio_cita", lang: "es_MX" });
});

test("parseWaTemplates conserva el estado que dejó Meta", () => {
  const out = parseWaTemplates({
    reminder: {
      name: "dc_recordatorio_cita",
      lang: "es_MX",
      status: "REJECTED",
      reason: "Formato inválido.",
      metaId: "123456",
      updatedAt: "2026-08-12T10:00:00.000Z",
    },
  });
  assert.equal(out.reminder?.status, "REJECTED");
  assert.equal(out.reminder?.reason, "Formato inválido.");
  assert.equal(out.reminder?.metaId, "123456");
});

test("un estado que no es de Meta se ignora en vez de apagar el envío", () => {
  // Sin estado = aprobada. Un valor corrupto no puede convertirse en un
  // bloqueo silencioso de todos los recordatorios.
  const out = parseWaTemplates({
    reminder: { name: "dc_recordatorio_cita", lang: "es_MX", status: "RARO" },
  });
  assert.equal(out.reminder?.status, undefined);
});

test("parseWaTemplates descarta lo corrupto en vez de intentar enviarlo", () => {
  // Un nombre inválido gasta un intento y falla con un código que no explica
  // nada: mejor tratarlo como "sin configurar" y decirlo.
  assert.deepEqual(parseWaTemplates({ reminder: { name: "Recordatorio Cita", lang: "es_MX" } }), {});
  assert.deepEqual(parseWaTemplates({ reminder: { name: "ok_name", lang: "español" } }), {});
  assert.deepEqual(parseWaTemplates({ reminder: { name: "ok_name" } }), {});
  assert.deepEqual(parseWaTemplates({ reminder: "recordatorio" }), {});
  assert.deepEqual(parseWaTemplates(null), {});
  assert.deepEqual(parseWaTemplates("basura"), {});
  assert.deepEqual(parseWaTemplates([]), {});
});

test("parseWaTemplates ignora claves que no son tipos de mensaje conocidos", () => {
  const out = parseWaTemplates({
    reminder: { name: "ok_name", lang: "es" },
    inventado: { name: "otro", lang: "es" },
  });
  assert.deepEqual(Object.keys(out), ["reminder"]);
});

test("parseWaTemplates recorta espacios de un copiar-pegar", () => {
  const out = parseWaTemplates({ reminder: { name: "  ok_name ", lang: " es_MX " } });
  assert.deepEqual(out.reminder, { name: "ok_name", lang: "es_MX" });
});

/* ─────────────── render para el Inbox ─────────────── */

test("renderTemplateBody deja en el Inbox lo que de verdad recibió el paciente", () => {
  const body = renderTemplateBody(specForKind("reminder"), PARAMS, "texto libre");
  assert.match(body, /Hola María/);
  assert.match(body, /Clínica Sonrisa/);
  assert.match(body, /lunes 11 de agosto/);
  assert.match(body, /10:00/);
  assert.match(body, /Dra\. Ana Ruiz/);
  assert.doesNotMatch(body, /\{\{\d\}\}/);
});

test("renderTemplateBody cae al texto libre si el tipo no tiene especificación", () => {
  assert.equal(renderTemplateBody(null, [], "texto libre"), "texto libre");
});
