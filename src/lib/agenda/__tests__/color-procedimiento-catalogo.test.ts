/** Salamanca — lectura de `agendaColor` del body del catálogo (sin base). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { leerAgendaColor } from "../../../app/api/procedures/entrada";

describe("leerAgendaColor", () => {
  it("undefined = no se toca; null = color por defecto; clave válida pasa", () => {
    assert.deepEqual(leerAgendaColor(undefined), { ok: true, value: undefined });
    assert.deepEqual(leerAgendaColor(null), { ok: true, value: null });
    assert.deepEqual(leerAgendaColor("azul"), { ok: true, value: "azul" });
  });
  it("rechaza lo que no es de la paleta", () => {
    for (const malo of ["#ff0000", "AZUL", "", 3, {}, true]) assert.equal(leerAgendaColor(malo).ok, false);
  });
});
