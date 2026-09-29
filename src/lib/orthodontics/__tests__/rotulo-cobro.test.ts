// ws1-t5 — el botón de cobro de la lista de mensualidades dice a cuántos.
// Correr: npm run test:inventario-arreglos

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listaDeNombres, rotuloCobrar, rotuloProgreso } from "../rotulo-cobro";

describe("rotuloCobrar", () => {
  it("una sola mensualidad: «Cobrar»", () => {
    assert.equal(rotuloCobrar(1), "Cobrar");
  });

  it("dos hermanos: «a los dos», como antes", () => {
    assert.equal(rotuloCobrar(2), "Cobrar a los dos");
  });

  it("tres hermanos ya NO dice «a los dos»", () => {
    assert.equal(rotuloCobrar(3), "Cobrar a los tres");
    assert.equal(rotuloCobrar(4), "Cobrar a los cuatro");
    assert.equal(rotuloCobrar(5), "Cobrar a los cinco");
  });

  it("de seis en adelante, en cifra", () => {
    assert.equal(rotuloCobrar(6), "Cobrar a los 6");
    assert.equal(rotuloCobrar(12), "Cobrar a los 12");
  });

  it("un número raro no rompe el botón", () => {
    assert.equal(rotuloCobrar(0), "Cobrar");
    assert.equal(rotuloCobrar(-3), "Cobrar");
    assert.equal(rotuloCobrar(NaN), "Cobrar");
    assert.equal(rotuloCobrar(2.9), "Cobrar a los dos");
  });
});

describe("listaDeNombres", () => {
  it("dos: «Ana y Luis»", () => {
    assert.equal(listaDeNombres(["Ana", "Luis"]), "Ana y Luis");
  });

  it("tres: comas y una sola «y» (antes salía «Ana y Luis y Sofía»)", () => {
    assert.equal(listaDeNombres(["Ana", "Luis", "Sofía"]), "Ana, Luis y Sofía");
  });

  it("uno, ninguno y nombres vacíos", () => {
    assert.equal(listaDeNombres(["Ana"]), "Ana");
    assert.equal(listaDeNombres([]), "");
    assert.equal(listaDeNombres(["Ana", " ", "Luis"]), "Ana y Luis");
  });
});

describe("rotuloProgreso", () => {
  it("«1 de 2» al empezar y «2 de 2» tras guardar la primera", () => {
    assert.equal(rotuloProgreso(0, 2), "1 de 2");
    assert.equal(rotuloProgreso(1, 2), "2 de 2");
  });
  it("nunca pasa del total ni baja de 1", () => {
    assert.equal(rotuloProgreso(5, 2), "2 de 2");
    assert.equal(rotuloProgreso(-1, 0), "1 de 1");
  });
});
