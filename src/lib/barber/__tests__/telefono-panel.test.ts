// Teléfonos de fuera de México en el panel (lógica L1, ronda 2, decisión 5).
//   npx tsx --test src/lib/barber/__tests__/telefono-panel.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { panelPhone, splitStoredPhone, telHref } from "../telefono-panel";
import { mxTenDigits } from "@/lib/phone-mx";
import { soloDigitosTelefono } from "../phone-format";

test("México se guarda IGUAL que hoy (mxTenDigits), con o sin país", () => {
  for (const raw of ["5512345678", "55 1234 5678", "+52 55 1234 5678", "+521 55 1234 5678"]) {
    const esperado = mxTenDigits(raw);
    assert.equal(panelPhone(undefined, raw).stored, esperado, raw);
    assert.equal(panelPhone("MX", raw).stored, esperado, raw);
    assert.equal(panelPhone("", raw).stored, esperado, raw);
  }
  assert.equal(panelPhone("MX", "551234").ok, false);
  assert.match(panelPhone("MX", "551234").error, /10 dígitos/);
});

test("otro país: se guarda en E.164 con +, con o sin la lada escrita", () => {
  assert.deepEqual(panelPhone("ES", "612 345 678"), { ok: true, stored: "+34612345678", error: "" });
  assert.equal(panelPhone("ES", "+34 612 345 678").stored, "+34612345678");
  assert.equal(panelPhone("US", "(305) 555-0123").stored, "+13055550123");
  assert.equal(panelPhone("co", "3001234567").stored, "+573001234567");
  assert.equal(panelPhone("ES", "12").ok, false);
  assert.match(panelPhone("ES", "12").error, /España/);
});

test("lo que ya viene guardado con + se acepta al editar aunque no llegue el país", () => {
  assert.equal(panelPhone(undefined, "+34612345678").stored, "+34612345678");
  assert.equal(panelPhone("MX", "+1 305 555 0123").stored, "+13055550123");
  // +52 sigue siendo México: 10 dígitos, como siempre.
  assert.equal(panelPhone(undefined, "+52 999 576 1629").stored, "9995761629");
});

test("de lo guardado al formulario: país y número local", () => {
  assert.deepEqual(splitStoredPhone("9995761629"), { iso: "MX", local: "9995761629" });
  assert.deepEqual(splitStoredPhone("+34612345678"), { iso: "ES", local: "612345678" });
  assert.deepEqual(splitStoredPhone("+5021234567"), { iso: "GT", local: "1234567" }); // 502 antes que 50x
  assert.deepEqual(splitStoredPhone("+13055550123"), { iso: "US", local: "3055550123" });
  assert.deepEqual(splitStoredPhone(null), { iso: "MX", local: "" });
});

test("tel: correcto para los dos", () => {
  assert.equal(telHref("9995761629"), "tel:+529995761629");
  assert.equal(telHref("+34612345678"), "tel:+34612345678");
});

test("el ayudante único de México no cambió", () => {
  assert.equal(soloDigitosTelefono("+52 (999) 576-1629"), "529995761629");
  assert.equal(mxTenDigits("+52 999 576 1629"), "9995761629");
});
