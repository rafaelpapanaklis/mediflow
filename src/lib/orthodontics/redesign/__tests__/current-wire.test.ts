// Tests de resolveCurrentWire (C1, ws1-t4 — Control y agenda).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveCurrentWire } from "../current-wire";
import type { TreatmentCardDTO, WireStepDTO } from "@/components/specialties/orthodontics/redesign/types";

function wire(over: Partial<WireStepDTO> & { id: string }): WireStepDTO {
  return {
    orderIndex: 0,
    phaseKey: "ALIGNMENT",
    material: "NITI",
    shape: "ROUND",
    gauge: "0.014",
    purpose: null,
    archUpper: true,
    archLower: true,
    durationWeeks: 6,
    auxiliaries: [],
    notes: null,
    status: "PLANNED",
    plannedDate: null,
    appliedDate: null,
    completedDate: null,
    ...over,
  };
}

function card(over: Partial<TreatmentCardDTO> & { id: string; visitDate: string }): TreatmentCardDTO {
  return {
    cardNumber: 1,
    durationMin: 30,
    phaseKey: "ALIGNMENT",
    monthAt: 1,
    wireFrom: null,
    wireTo: null,
    soap: { s: "", o: "", a: "", p: "" },
    hygiene: { plaquePct: null, gingivitis: null, whiteSpots: false },
    hasProgressPhoto: false,
    photoSetId: null,
    nextDate: null,
    nextDurationMin: null,
    status: "DRAFT",
    signedAt: null,
    signedByName: null,
    elastics: [],
    iprPoints: [],
    brokenBrackets: [],
    ...over,
  };
}

describe("resolveCurrentWire", () => {
  it("sin hojas: cae al wire con status ACTIVE (comportamiento previo a C1)", () => {
    const w1 = wire({ id: "w1", status: "COMPLETED" });
    const w2 = wire({ id: "w2", status: "ACTIVE" });
    assert.equal(resolveCurrentWire([w1, w2], []), w2);
  });

  it("con una hoja firmada con wireTo: usa ESE wire, no el ACTIVE de la planeación", () => {
    const active = wire({ id: "w-active", status: "ACTIVE" });
    const annotated = wire({ id: "w-annotated", status: "PLANNED" });
    const c1 = card({ id: "c1", visitDate: "2026-09-01T10:00:00.000Z", status: "SIGNED", wireTo: annotated });
    assert.equal(resolveCurrentWire([active, annotated], [c1]), annotated);
  });

  it("con varias hojas firmadas: usa la de visitDate más reciente, no la última en el array", () => {
    const wOld = wire({ id: "w-old" });
    const wNew = wire({ id: "w-new" });
    const cOld = card({ id: "c-old", visitDate: "2026-01-01T10:00:00.000Z", status: "SIGNED", wireTo: wOld });
    const cNew = card({ id: "c-new", visitDate: "2026-06-01T10:00:00.000Z", status: "SIGNED", wireTo: wNew });
    // A propósito en orden "incorrecto" (la vieja después en el array).
    assert.equal(resolveCurrentWire([], [cNew, cOld]), wNew);
  });

  it("ignora hojas en DRAFT: solo cuenta lo firmado", () => {
    const active = wire({ id: "w-active", status: "ACTIVE" });
    const draftWire = wire({ id: "w-draft" });
    const draft = card({ id: "c-draft", visitDate: "2026-09-01T10:00:00.000Z", status: "DRAFT", wireTo: draftWire });
    assert.equal(resolveCurrentWire([active], [draft]), active);
  });

  it("ignora hojas firmadas SIN cambio de wire (wireTo null)", () => {
    const active = wire({ id: "w-active", status: "ACTIVE" });
    const signedNoWire = card({ id: "c1", visitDate: "2026-09-01T10:00:00.000Z", status: "SIGNED", wireTo: null });
    assert.equal(resolveCurrentWire([active], [signedNoWire]), active);
  });

  it("sin nada (caso recién abierto): null", () => {
    assert.equal(resolveCurrentWire([], []), null);
  });
});
