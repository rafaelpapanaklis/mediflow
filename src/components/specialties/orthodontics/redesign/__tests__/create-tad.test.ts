// Tests del predicate locationHasValidFdi usado por createOrthoTAD.
// La función `location` admite texto libre con códigos FDI embebidos —
// validamos que cada número de 2 dígitos detectado esté en rango 11-48 y
// con unidad 1-8 (no hay diente "x9" o "x0").

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { locationHasValidFdi } from "../../../../../app/actions/orthodontics/_predicates";

describe("createOrthoTAD.locationHasValidFdi", () => {
  it("acepta texto libre sin códigos numéricos", () => {
    assert.equal(
      locationHasValidFdi("vestibular sup. der entre molares"),
      true,
    );
  });

  it("acepta location con FDI válido único", () => {
    assert.equal(locationHasValidFdi("vestibular entre 14"), true);
  });

  it("acepta location con dos FDI válidos en rango", () => {
    assert.equal(
      locationHasValidFdi("vestibular sup. der entre 14 y 15"),
      true,
    );
  });

  it("acepta los 4 cuadrantes 11-18, 21-28, 31-38, 41-48", () => {
    assert.equal(locationHasValidFdi("zona 11"), true);
    assert.equal(locationHasValidFdi("zona 28"), true);
    assert.equal(locationHasValidFdi("zona 38"), true);
    assert.equal(locationHasValidFdi("zona 41"), true);
  });

  it("rechaza FDI fuera de rango (10)", () => {
    assert.equal(locationHasValidFdi("entre 10 y 11"), false);
  });

  it("rechaza FDI fuera de rango (49)", () => {
    assert.equal(locationHasValidFdi("zona 49"), false);
  });

  it("rechaza unidad inválida (39 — no existe diente x9)", () => {
    assert.equal(locationHasValidFdi("zona 39"), false);
  });

  it("rechaza unidad inválida (20 — no existe diente x0)", () => {
    assert.equal(locationHasValidFdi("zona 20"), false);
  });

  it("rechaza si CUALQUIER código está fuera de rango", () => {
    assert.equal(locationHasValidFdi("entre 14 y 50"), false);
  });

  it("ignora dígitos sueltos no de 2 (ej. '1' o '123')", () => {
    // \\b\\d{2}\\b solo matchea exactamente 2 dígitos.
    assert.equal(locationHasValidFdi("nota 1: posición lateral"), true);
    assert.equal(locationHasValidFdi("ID interno 1234 sin FDI"), true);
  });
});
