// Datos bancarios de la sede (ws1-t3 fase 2) — validación PURA, sin base.
// Correr: npm run test:anticipos-panel

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validarCuentaBancariaSede, cuentaSedeUsable } from "../datos-bancarios.server";

// CLABE de 18 dígitos con el dígito verificador (pesos 3-7-1) calculado a
// mano para que pase clabeValida de verdad, no solo el formato.
const CLABE_VALIDA = "012180001234567899";

describe("validarCuentaBancariaSede", () => {
  it("acepta banco + beneficiario + CLABE válida, sin referencia", () => {
    const r = validarCuentaBancariaSede({ banco: "BBVA", beneficiario: "Clínica Sonrisa SC", clabe: CLABE_VALIDA });
    assert.equal(r.ok, true);
    assert.equal(r.cuenta?.banco, "BBVA");
    assert.equal(r.cuenta?.referencia, null);
  });

  it("acepta la referencia cuando viene, recortada de espacios", () => {
    const r = validarCuentaBancariaSede({
      banco: "BBVA",
      beneficiario: "Clínica Sonrisa SC",
      clabe: CLABE_VALIDA,
      referencia: "  Escribe el nombre del paciente  ",
    });
    assert.equal(r.ok, true);
    assert.equal(r.cuenta?.referencia, "Escribe el nombre del paciente");
  });

  it("rechaza sin banco", () => {
    const r = validarCuentaBancariaSede({ banco: "", beneficiario: "X", clabe: CLABE_VALIDA });
    assert.equal(r.ok, false);
  });

  it("rechaza sin beneficiario", () => {
    const r = validarCuentaBancariaSede({ banco: "BBVA", beneficiario: "", clabe: CLABE_VALIDA });
    assert.equal(r.ok, false);
  });

  it("rechaza una CLABE con menos de 18 dígitos", () => {
    const r = validarCuentaBancariaSede({ banco: "BBVA", beneficiario: "X", clabe: "12345" });
    assert.equal(r.ok, false);
  });

  it("rechaza una CLABE de 18 dígitos con el dígito verificador MAL (un dígito cambiado)", () => {
    const rota = CLABE_VALIDA.slice(0, -1) + (CLABE_VALIDA.at(-1) === "5" ? "6" : "5");
    const r = validarCuentaBancariaSede({ banco: "BBVA", beneficiario: "X", clabe: rota });
    assert.equal(r.ok, false);
  });

  it("normaliza espacios y guiones en la CLABE antes de validar", () => {
    const conFormato = CLABE_VALIDA.replace(/(\d{3})(?=\d)/g, "$1 ");
    const r = validarCuentaBancariaSede({ banco: "BBVA", beneficiario: "X", clabe: conFormato });
    assert.equal(r.ok, true);
  });

  it("rechaza una referencia de más de 200 caracteres", () => {
    const r = validarCuentaBancariaSede({ banco: "BBVA", beneficiario: "X", clabe: CLABE_VALIDA, referencia: "a".repeat(201) });
    assert.equal(r.ok, false);
  });
});

describe("cuentaSedeUsable", () => {
  it("null/undefined no son usables", () => {
    assert.equal(cuentaSedeUsable(null), false);
    assert.equal(cuentaSedeUsable(undefined), false);
  });

  it("incompleta (sin beneficiario) no es usable", () => {
    assert.equal(cuentaSedeUsable({ banco: "BBVA", beneficiario: "", clabe: CLABE_VALIDA, referencia: null }), false);
  });

  it("con CLABE inválida no es usable, aunque banco y beneficiario estén", () => {
    assert.equal(cuentaSedeUsable({ banco: "BBVA", beneficiario: "X", clabe: "000000000000000001", referencia: null }), false);
  });

  it("completa y válida SÍ es usable", () => {
    assert.equal(cuentaSedeUsable({ banco: "BBVA", beneficiario: "X", clabe: CLABE_VALIDA, referencia: null }), true);
  });
});
