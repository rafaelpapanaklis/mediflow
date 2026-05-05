// Implants — tests de duraciones de cita por tipo. Spec §8.1, §13.1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IMPLANT_APPOINTMENT_TYPES,
  suggestImplantAppointmentDuration,
} from "../appointment-types";

describe("IMPLANT_APPOINTMENT_TYPES", () => {
  it("planeación = 60 min", () => {
    assert.equal(IMPLANT_APPOINTMENT_TYPES.PLANEACION.durationMinutes, 60);
  });
  it("cirugía 1 implante = 90 min", () => {
    assert.equal(IMPLANT_APPOINTMENT_TYPES.CIRUGIA_1.durationMinutes, 90);
  });
  it("All-on-4 = 240 min (1 arcada)", () => {
    assert.equal(IMPLANT_APPOINTMENT_TYPES.ALL_ON_4.durationMinutes, 240);
  });
  it("elevación de seno = 180 min", () => {
    assert.equal(IMPLANT_APPOINTMENT_TYPES.ELEVACION_SENO.durationMinutes, 180);
  });
});

describe("suggestImplantAppointmentDuration", () => {
  it("'cirugía de implante en 36' → 90 min", () => {
    assert.equal(suggestImplantAppointmentDuration("Cirugía de implante en 36"), 90);
  });
  it("'all on 4' → 240 min", () => {
    assert.equal(suggestImplantAppointmentDuration("All on 4 superior"), 240);
  });
  it("'elevación de seno' → 180 min", () => {
    assert.equal(suggestImplantAppointmentDuration("Elevación de seno + implante 16"), 180);
  });
  it("'toma de impresión' → 45 min", () => {
    assert.equal(suggestImplantAppointmentDuration("Toma de impresión para corona"), 45);
  });
  it("'mantenimiento periimplantario' → 45 min", () => {
    assert.equal(suggestImplantAppointmentDuration("Mantenimiento periimplantario 6m"), 45);
  });
  it("'limpieza dental' → null (no aplica al módulo)", () => {
    assert.equal(suggestImplantAppointmentDuration("limpieza dental"), null);
  });
  it("'colocación final' → 45 min", () => {
    assert.equal(suggestImplantAppointmentDuration("Colocación final corona zirconia"), 45);
  });
});
