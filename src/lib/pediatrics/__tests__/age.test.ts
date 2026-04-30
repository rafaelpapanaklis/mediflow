// Pediatrics — tests para age helpers. Spec: §4.A.1, §6.1 casos del brief.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateAge, isPediatric } from "../age";

describe("calculateAge", () => {
  it("Mateo (4 a 7 m): nace 2021-09-18, ref 2026-04-30 -> 4a 7m", () => {
    const age = calculateAge(new Date("2021-09-18"), new Date("2026-04-30"));
    assert.equal(age.years, 4);
    assert.equal(age.months, 7);
    assert.equal(age.formatted, "4 a 7 m");
    assert.equal(age.long, "4 años 7 meses");
    assert.equal(age.totalMonths, 4 * 12 + 7);
    assert.ok(age.decimal >= 4.5 && age.decimal <= 4.7, `decimal=${age.decimal}`);
  });

  it("Sofía (8 a 2 m): nace 2018-02-15, ref 2026-04-30 -> 8a 2m", () => {
    const age = calculateAge(new Date("2018-02-15"), new Date("2026-04-30"));
    assert.equal(age.years, 8);
    assert.equal(age.months, 2);
    assert.equal(age.formatted, "8 a 2 m");
  });

  it("Diego (12 a 11 m): nace 2013-05-30, ref 2026-04-30 -> 12a 11m", () => {
    const age = calculateAge(new Date("2013-05-30"), new Date("2026-04-30"));
    assert.equal(age.years, 12);
    assert.equal(age.months, 11);
    assert.equal(age.formatted, "12 a 11 m");
    assert.ok(age.decimal < 13, `decimal=${age.decimal}`);
  });

  it("usa singular para 1 año/mes", () => {
    const age = calculateAge(new Date("2025-03-30"), new Date("2026-04-30"));
    assert.equal(age.years, 1);
    assert.equal(age.months, 1);
    assert.equal(age.long, "1 año 1 mes");
  });

  it("ajusta cuando el día del mes ref es menor que el de nacimiento", () => {
    const age = calculateAge(new Date("2020-06-25"), new Date("2026-04-15"));
    assert.equal(age.years, 5);
    assert.equal(age.months, 9);
  });
});

describe("isPediatric", () => {
  it("Mateo (4a 7m) es pediátrico con cutoff default 14", () => {
    assert.equal(isPediatric(new Date("2021-09-18"), 14), true);
  });

  it("Diego (12a 11m) sigue siendo pediátrico con cutoff 14", () => {
    const dob = new Date("2013-05-30");
    assert.equal(isPediatric(dob, 14), true);
  });

  it("paciente de 14a 1m NO es pediátrico con cutoff 14", () => {
    const dob = new Date("2012-03-30");
    assert.equal(isPediatric(dob, 14), false);
  });

  it("dob null nunca es pediátrico", () => {
    assert.equal(isPediatric(null, 14), false);
  });

  it("respeta cutoff override de 16", () => {
    const dob = new Date("2011-04-30");
    assert.equal(isPediatric(dob, 16), true);
  });
});
