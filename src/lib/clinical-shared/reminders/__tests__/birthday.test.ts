// Clinical-shared — tests del helper nextBirthday + ageOnBirthday.
// Caso del Caso 2 del spec: Sofía Méndez nace 2018-02-15.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextBirthday, ageOnBirthday } from "../birthday";

describe("nextBirthday", () => {
  it("Sofía (2018-02-15) referencia 2026-04-30 -> próximo 2027-02-15", () => {
    const dob = new Date("2018-02-15");
    const ref = new Date("2026-04-30");
    const next = nextBirthday(dob, ref);
    assert.equal(next.getUTCFullYear(), 2027);
    assert.equal(next.getUTCMonth(), 1);
    assert.equal(next.getUTCDate(), 15);
  });

  it("Sofía referencia 2026-01-15 -> mismo año 2026-02-15", () => {
    const dob = new Date("2018-02-15");
    const ref = new Date("2026-01-15");
    const next = nextBirthday(dob, ref);
    assert.equal(next.getUTCFullYear(), 2026);
    assert.equal(next.getUTCMonth(), 1);
    assert.equal(next.getUTCDate(), 15);
  });

  it("29-feb en año no bisiesto cae en 28-feb", () => {
    const dob = new Date("2020-02-29");
    const ref = new Date("2026-04-30");
    const next = nextBirthday(dob, ref);
    assert.equal(next.getUTCFullYear(), 2027);
    assert.equal(next.getUTCMonth(), 1);
    assert.equal(next.getUTCDate(), 28);
  });

  it("ageOnBirthday calcula edad target correctamente", () => {
    const dob = new Date("2018-02-15");
    const target = new Date("2027-02-15");
    assert.equal(ageOnBirthday(dob, target), 9);
  });
});
