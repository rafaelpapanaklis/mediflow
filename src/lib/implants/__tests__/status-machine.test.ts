// Implants — tests máquina de estados. Spec §13.1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isValidTransition,
  nextValidStatuses,
  isTerminal,
} from "../status-machine";

describe("status-machine", () => {
  it("PLANNED → PLACED es válido", () => {
    assert.equal(isValidTransition("PLANNED", "PLACED"), true);
  });

  it("PLACED → OSSEOINTEGRATING es válido", () => {
    assert.equal(isValidTransition("PLACED", "OSSEOINTEGRATING"), true);
  });

  it("OSSEOINTEGRATING → LOADED_DEFINITIVE es válido (carga inmediata diferida)", () => {
    assert.equal(
      isValidTransition("OSSEOINTEGRATING", "LOADED_DEFINITIVE"),
      true,
    );
  });

  it("OSSEOINTEGRATING → UNCOVERED es válido (protocolo 2-stage)", () => {
    assert.equal(isValidTransition("OSSEOINTEGRATING", "UNCOVERED"), true);
  });

  it("FUNCTIONAL → COMPLICATION es válido", () => {
    assert.equal(isValidTransition("FUNCTIONAL", "COMPLICATION"), true);
  });

  it("COMPLICATION → FUNCTIONAL es válido (resolución exitosa)", () => {
    assert.equal(isValidTransition("COMPLICATION", "FUNCTIONAL"), true);
  });

  it("FUNCTIONAL no regresa a PLANNED", () => {
    assert.equal(isValidTransition("FUNCTIONAL", "PLANNED"), false);
  });

  it("FUNCTIONAL no regresa a PLACED", () => {
    assert.equal(isValidTransition("FUNCTIONAL", "PLACED"), false);
  });

  it("REMOVED es estado terminal — no admite ninguna transición", () => {
    assert.equal(isTerminal("REMOVED"), true);
    assert.deepEqual(nextValidStatuses("REMOVED"), []);
  });

  it("FAILED solo puede ir a REMOVED", () => {
    assert.deepEqual(nextValidStatuses("FAILED"), ["REMOVED"]);
  });

  it("PLANNED → REMOVED es válido (cancelación pre-cirugía)", () => {
    assert.equal(isValidTransition("PLANNED", "REMOVED"), true);
  });

  it("PLACED → FAILED es válido (cirugía con osteointegración perdida)", () => {
    assert.equal(isValidTransition("PLACED", "FAILED"), true);
  });

  it("LOADED_PROVISIONAL → LOADED_DEFINITIVE es válido", () => {
    assert.equal(
      isValidTransition("LOADED_PROVISIONAL", "LOADED_DEFINITIVE"),
      true,
    );
  });

  it("LOADED_DEFINITIVE → FUNCTIONAL es válido (>1 año sin complicación)", () => {
    assert.equal(isValidTransition("LOADED_DEFINITIVE", "FUNCTIONAL"), true);
  });
});
