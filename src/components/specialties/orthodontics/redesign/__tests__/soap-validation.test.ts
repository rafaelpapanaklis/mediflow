// Regla de firma de la hoja de control en el CAJÓN (`puedeFirmarNota`).
// Antes este archivo replicaba en línea la regla de "los 4 campos"; desde la
// fila 12 la regla vive exportada en treatment-card-state.ts y se prueba la
// real: solo el Plan (P) es obligatorio, y un Plan precargado sin tocar no
// cuenta como escrito.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { puedeFirmarNota } from "../drawers/treatment-card-state";

const precarga = { s: "S pre", o: "O pre", a: "A pre", p: "Próxima cita en 4 semanas. Ajustes: ____." };

describe("Treatment Card sign rule (cajón)", () => {
  it("permite firmar con S/O/A/P todos llenos", () => {
    assert.equal(
      puedeFirmarNota({ s: "refiere molestia", o: "alineación ok", a: "evolución", p: "cita 4 sem" }, null),
      true,
    );
  });

  it("S/O/A vacíos no bloquean", () => {
    assert.equal(puedeFirmarNota({ s: "", o: "  ", a: "", p: "x" }, null), true);
  });

  it("bloquea si P vacío o solo espacios", () => {
    assert.equal(puedeFirmarNota({ s: "x", o: "x", a: "x", p: "" }, null), false);
    assert.equal(puedeFirmarNota({ s: "x", o: "x", a: "x", p: "  \n" }, null), false);
  });

  it("un Plan precargado sin tocar no deja firmar", () => {
    assert.equal(puedeFirmarNota({ ...precarga }, precarga), false);
    // Espacios de más al final siguen siendo «sin tocar».
    assert.equal(puedeFirmarNota({ ...precarga, p: `${precarga.p}  ` }, precarga), false);
  });

  it("en cuanto el Plan precargado se edita, se puede firmar", () => {
    assert.equal(
      puedeFirmarNota({ ...precarga, p: "Próxima cita en 4 semanas. Ajustes: cambio a 0.016 NiTi." }, precarga),
      true,
    );
  });

  it("borrar el Plan precargado no deja firmar", () => {
    assert.equal(puedeFirmarNota({ ...precarga, p: "" }, precarga), false);
  });
});
