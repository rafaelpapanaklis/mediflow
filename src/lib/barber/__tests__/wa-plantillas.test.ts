/* ═══════════════════════════════════════════════════════════════════════
   Plantillas de WhatsApp de barber: lo que se le enseña a la barbería.

     npx tsx --test src/lib/barber/__tests__/wa-plantillas.test.ts

   15-nov-2026, prueba real de Rafael: bajo cada plantilla «En revisión»
   salía en ROJO la palabra «NONE» (Meta la manda cuando NO hay rechazo).
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BARBER_TEMPLATE_REJECTION_CODES,
  barberTemplateRejection,
  barberTemplateRejectionKey,
  explainBarberTemplateFailure,
  readBarberTemplateFailure,
} from "../wa-plantillas-core";

test("«NONE», vacío o nulo: no se enseña nada, esté como esté la plantilla", () => {
  for (const status of ["PENDING", "APPROVED", "REJECTED", "MISSING", "pending"]) {
    for (const raw of ["NONE", "none", " NONE ", "", null, undefined, 3]) {
      assert.equal(barberTemplateRejection(status, raw), null, `${status} / ${String(raw)}`);
    }
  }
});

test("un motivo real SOLO se enseña si la plantilla está rechazada", () => {
  assert.equal(barberTemplateRejection("PENDING", "INVALID_FORMAT"), null);
  assert.equal(barberTemplateRejection("APPROVED", "PROMOTIONAL"), null);
  assert.equal(barberTemplateRejection("REJECTED", "invalid_format"), "INVALID_FORMAT");
  assert.equal(barberTemplateRejection("rejected", "ALGO_NUEVO"), "ALGO_NUEVO");
});

test("cada motivo conocido tiene su texto es/en; lo desconocido cae en «other» con el código", () => {
  const es = JSON.parse(readFileSync("src/i18n/dictionaries/barber/whatsapp.es.json", "utf8"));
  const en = JSON.parse(readFileSync("src/i18n/dictionaries/barber/whatsapp.en.json", "utf8"));
  for (const code of BARBER_TEMPLATE_REJECTION_CODES) {
    assert.equal(barberTemplateRejectionKey(code), `templates.rejected.${code}`);
    assert.ok(es.templates.rejected[code], `es: ${code}`);
    assert.ok(en.templates.rejected[code], `en: ${code}`);
    assert.doesNotMatch(es.templates.rejected[code], /[A-Z]{4,}_/, "el texto no repite la constante en inglés");
  }
  assert.equal(barberTemplateRejectionKey("ALGO_NUEVO"), "templates.rejected.other");
  assert.match(es.templates.rejected.other, /\{code\}/);
  assert.match(en.templates.rejected.other, /\{code\}/);
});

test("la pantalla ya no pinta el motivo crudo", () => {
  const panel = readFileSync("src/components/barber/whatsapp/templates-panel.tsx", "utf8");
  assert.doesNotMatch(panel, /\{row\.reason\}/);
  assert.match(panel, /barberTemplateRejection\(row\.status, row\.reason\)/);
  const wa = readFileSync("src/lib/barber/whatsapp.ts", "utf8");
  assert.match(wa, /reason: barberTemplateRejection\(status, row\.rejected_reason\)/);
});

// ── cuando Meta NO deja dar de alta una plantilla ──────────────────────

/** Como contesta Meta un alta rechazada: lo útil va en error_user_msg. */
const META_400 = {
  error: {
    message: "Invalid parameter",
    type: "OAuthException",
    code: 100,
    error_subcode: 2388042,
    error_user_title: "Plantilla no válida",
    error_user_msg: "Este tipo de plantilla no está disponible para esta cuenta.",
    fbtrace_id: "Axyz",
  },
};

test("se guarda TODO lo que dijo Meta, no solo «Invalid parameter»", () => {
  const f = readBarberTemplateFailure("dc_barber_codigo_acceso", "AUTHENTICATION", META_400);
  assert.deepEqual(f, {
    name: "dc_barber_codigo_acceso",
    category: "AUTHENTICATION",
    code: 100,
    subcode: 2388042,
    message: "Invalid parameter",
    userTitle: "Plantilla no válida",
    userMsg: "Este tipo de plantilla no está disponible para esta cuenta.",
  });
  // Basura: no truena.
  assert.equal(readBarberTemplateFailure("x", null, null).code, null);
  assert.equal(readBarberTemplateFailure("x", null, "<html>").message, null);
});

test("la de código de acceso rechazada: texto entendible + lo crudo de Meta con su código", () => {
  const ex = explainBarberTemplateFailure(readBarberTemplateFailure("dc_barber_codigo_acceso", "AUTHENTICATION", META_400));
  assert.equal(ex.key, "authNotAccepted");
  assert.match(ex.raw, /Este tipo de plantilla no está disponible para esta cuenta\./);
  assert.match(ex.raw, /#100 · sub 2388042/);
  assert.doesNotMatch(ex.raw, /Axyz/, "nada de fbtrace ni de otros campos");
});

test("cada causa con su texto", () => {
  const k = (e: Record<string, unknown>, cat = "UTILITY") =>
    explainBarberTemplateFailure(readBarberTemplateFailure("t", cat, { error: e })).key;
  assert.equal(k({ code: 190, message: "Error validating access token" }), "token");
  assert.equal(k({ code: 190 }, "AUTHENTICATION"), "token", "el token vencido manda aunque sea la de código");
  assert.equal(k({ code: 200, message: "Permissions error" }), "permission");
  assert.equal(k({ code: 10 }), "permission");
  assert.equal(k({ code: 80008 }), "rateLimit");
  assert.equal(k({ code: 4 }), "rateLimit");
  assert.equal(k({ code: 100, error_user_msg: "New English content can't be added while the existing English content is being deleted. Try again in 4 weeks." }), "deleting");
  assert.equal(k({ code: 100, message: "Invalid parameter" }), "invalid");
  assert.equal(k({ code: 999, message: "algo" }), "other");
  assert.equal(explainBarberTemplateFailure({ name: "t", network: true }).key, "network");
});

test("cada causa tiene su texto es/en, y la pantalla ya no enseña solo los nombres", () => {
  const es = JSON.parse(readFileSync("src/i18n/dictionaries/barber/whatsapp.es.json", "utf8"));
  const en = JSON.parse(readFileSync("src/i18n/dictionaries/barber/whatsapp.en.json", "utf8"));
  for (const key of ["token", "permission", "rateLimit", "deleting", "authNotAccepted", "invalid", "network", "other", "metaSaid"]) {
    assert.ok(es.templates.failure[key], "es " + key);
    assert.ok(en.templates.failure[key], "en " + key);
  }
  const panel = readFileSync("src/components/barber/whatsapp/templates-panel.tsx", "utf8");
  assert.match(panel, /explainBarberTemplateFailure\(f\)/);
  assert.match(panel, /templates\.failure\.metaSaid/);
  assert.doesNotMatch(panel, /result\.failed\.map\(\(f\) => f\.name\)/);
});

test("la conexión ya no ignora los fallos del alta en segundo plano", () => {
  const ruta = readFileSync("src/app/api/barber/whatsapp/connect/route.ts", "utf8");
  assert.match(ruta, /for \(const f of r\.failed\)/);
  assert.match(ruta, /Meta no aceptó la plantilla/);
});
