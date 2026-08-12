// El catálogo de plantillas y su traducción a/desde Meta. Puro, sin red ni BD.
//   npm run test:wa-catalog
//
// Lo que se protege aquí:
//   1. que el catálogo cumpla las reglas de Meta ANTES de gastar una llamada;
//   2. que el alta que se le manda a Meta lleve lo que Meta exige (ejemplos);
//   3. que el estado que devuelve Meta se traduzca al que ve la clínica sin
//      inventar aprobaciones (lo desconocido NUNCA es "lista").

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WA_TEMPLATE_CATALOG,
  DEFAULT_CATALOG_KINDS,
  buildTemplateCreatePayload,
  catalogEntryByName,
  catalogEntryFor,
  checkCatalogEntry,
  checkTemplateBody,
  countTemplateVariables,
  describeRejectionReason,
  isValidTemplateName,
  mapMetaTemplateStatus,
  templateUiState,
} from "../templates-catalog";

/* ─────────────── el catálogo cumple las reglas de Meta ─────────────── */

test("todas las plantillas del catálogo son válidas para Meta", () => {
  for (const entry of WA_TEMPLATE_CATALOG) {
    assert.equal(checkCatalogEntry(entry), null, `${entry.name}: ${checkCatalogEntry(entry)}`);
  }
});

test("los nombres son únicos y con el formato que admite Meta", () => {
  const seen = new Set<string>();
  for (const entry of WA_TEMPLATE_CATALOG) {
    assert.ok(isValidTemplateName(entry.name), `${entry.name} no es un nombre válido`);
    assert.ok(!seen.has(entry.name), `${entry.name} está repetido`);
    seen.add(entry.name);
  }
});

test("solo la de reseñas es de marketing, y es la única opcional", () => {
  // El modelo de negocio depende de esto: marketing cuesta más y el paciente la
  // puede bloquear. Si alguna de utilidad se marcara opcional, dejaría de
  // crearse sola y los recordatorios se apagarían sin avisar.
  const marketing = WA_TEMPLATE_CATALOG.filter((e) => e.category === "MARKETING");
  assert.deepEqual(marketing.map((e) => e.kind), ["review"]);
  const optional = WA_TEMPLATE_CATALOG.filter((e) => e.optional);
  assert.deepEqual(optional.map((e) => e.kind), ["review"]);
  assert.ok(!DEFAULT_CATALOG_KINDS.includes("review"));
  assert.equal(DEFAULT_CATALOG_KINDS.length, 7);
});

test("checkTemplateBody rechaza lo que Meta rechaza", () => {
  assert.match(checkTemplateBody("{{1}}, te esperamos.") ?? "", /empezar/i);
  assert.match(checkTemplateBody("Hola, te esperamos {{1}}") ?? "", /terminar/i);
  assert.match(checkTemplateBody("Hola {{1}} {{2}}, te esperamos.") ?? "", /dos variables/i);
  assert.match(checkTemplateBody("Hola {{2}}, te esperamos.") ?? "", /sin saltos/i);
  assert.equal(checkTemplateBody("Hola {{1}}, te esperamos en {{2}}."), null);
  // Sin variables también vale (una plantilla fija).
  assert.equal(checkTemplateBody("Te esperamos."), null);
});

test("countTemplateVariables cuenta las distintas, no las apariciones", () => {
  assert.equal(countTemplateVariables("Hola {{1}}, {{2}} te espera. Hasta pronto {{1}}."), 2);
  assert.equal(countTemplateVariables("Sin variables."), 0);
});

/* ─────────────── el alta que se le manda a Meta ─────────────── */

test("el alta lleva cuerpo, categoría, idioma y un ejemplo por variable", () => {
  const entry = catalogEntryFor("reminder")!;
  const payload = buildTemplateCreatePayload(entry);

  assert.equal(payload.name, "dc_recordatorio_cita");
  assert.equal(payload.language, "es_MX");
  assert.equal(payload.category, "UTILITY");
  assert.equal(payload.components.length, 1);

  const body = payload.components[0];
  assert.equal(body.type, "BODY");
  assert.equal(body.text, entry.body);
  // Meta EXIGE `example.body_text` cuando el cuerpo tiene variables: es un
  // array de arrays (un grupo de ejemplos por componente).
  assert.ok(Array.isArray(body.example?.body_text));
  assert.equal(body.example!.body_text.length, 1);
  assert.equal(body.example!.body_text[0].length, countTemplateVariables(entry.body));
});

test("cada plantilla manda tantos ejemplos como variables tiene su cuerpo", () => {
  for (const entry of WA_TEMPLATE_CATALOG) {
    const payload = buildTemplateCreatePayload(entry);
    const vars = countTemplateVariables(entry.body);
    const ejemplos = payload.components[0].example?.body_text[0] ?? [];
    assert.equal(ejemplos.length, vars, `${entry.name}: ${ejemplos.length} ejemplos para ${vars} variables`);
    for (const v of ejemplos) assert.notEqual(v.trim(), "", `${entry.name}: ejemplo vacío`);
  }
});

test("una plantilla sin variables no manda `example` (Meta lo rechaza vacío)", () => {
  const payload = buildTemplateCreatePayload({
    ...catalogEntryFor("review")!,
    body: "Gracias por tu visita.",
    sample: [],
    variableKeys: [],
  });
  assert.equal(payload.components[0].example, undefined);
});

test("la plantilla se encuentra por su nombre de Meta (webhook y cron)", () => {
  assert.equal(catalogEntryByName("dc_recordatorio_cita")?.kind, "reminder");
  assert.equal(catalogEntryByName("  DC_RECORDATORIO_CITA  ")?.kind, "reminder");
  // Una plantilla de la clínica que no es nuestra no se toca.
  assert.equal(catalogEntryByName("promo_black_friday"), null);
  assert.equal(catalogEntryByName(""), null);
});

/* ─────────────── el estado que devuelve Meta ─────────────── */

test("APPROVED es lo único que se da por aprobado", () => {
  assert.equal(mapMetaTemplateStatus("APPROVED"), "APPROVED");
  assert.equal(mapMetaTemplateStatus("approved"), "APPROVED");
});

test("lo que exige actuar se traduce a RECHAZADA", () => {
  for (const s of ["REJECTED", "PAUSED", "DISABLED", "DELETED", "PENDING_DELETION", "LIMIT_EXCEEDED", "FLAGGED"]) {
    assert.equal(mapMetaTemplateStatus(s), "REJECTED", s);
  }
});

test("lo desconocido cae a EN REVISIÓN, nunca a aprobada", () => {
  // El lado seguro: el cron vuelve a preguntar en vez de dar por buena una
  // plantilla que Meta rechazaría al enviarla.
  for (const s of ["PENDING", "IN_APPEAL", "ESTADO_NUEVO_DE_META", "", null, undefined]) {
    assert.equal(mapMetaTemplateStatus(s as string), "PENDING", String(s));
  }
});

test("el motivo del rechazo se traduce, y lo desconocido se muestra tal cual", () => {
  assert.equal(describeRejectionReason("NONE"), "");
  assert.equal(describeRejectionReason(null), "");
  assert.match(describeRejectionReason("INVALID_FORMAT"), /formato/i);
  assert.equal(describeRejectionReason("MOTIVO_RARO"), "MOTIVO_RARO");
});

/* ─────────────── lo que ve la clínica ─────────────── */

test("el estado visible distingue los cuatro casos de la pantalla", () => {
  assert.equal(templateUiState(null), "missing");
  assert.equal(templateUiState(undefined), "missing");
  assert.equal(templateUiState({ status: "APPROVED" }), "approved");
  assert.equal(templateUiState({ status: "PENDING" }), "pending");
  assert.equal(templateUiState({ status: "REJECTED" }), "rejected");
});

test("una plantilla registrada a mano (sin estado) sale como lista", () => {
  // Las que la clínica escribió en la pantalla vieja ya estaban aprobadas en
  // Meta: pintarlas "en revisión" sería mentir y apagaría envíos que funcionan.
  assert.equal(templateUiState({}), "approved");
  assert.equal(templateUiState({ status: null }), "approved");
});
