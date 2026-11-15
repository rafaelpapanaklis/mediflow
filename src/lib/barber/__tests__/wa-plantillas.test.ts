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
