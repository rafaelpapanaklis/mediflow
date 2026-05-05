// Periodontics — tests del parser parsePdRecInput. SPEC §13.1

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePdRecInput } from "../keyboard-shortcuts";

describe("parsePdRecInput", () => {
  it('parsea "5-2" como pd=5 rec=2', () => {
    assert.deepEqual(parsePdRecInput("5-2"), { pdMm: 5, recMm: 2 });
  });

  it('parsea "5/2" como pd=5 rec=2', () => {
    assert.deepEqual(parsePdRecInput("5/2"), { pdMm: 5, recMm: 2 });
  });

  it('parsea "5,2" como pd=5 rec=2', () => {
    assert.deepEqual(parsePdRecInput("5,2"), { pdMm: 5, recMm: 2 });
  });

  it('parsea "5" como pd=5 rec=null', () => {
    assert.deepEqual(parsePdRecInput("5"), { pdMm: 5, recMm: null });
  });

  it('parsea "5-" (sólo pd) como pd=5 rec=null', () => {
    assert.deepEqual(parsePdRecInput("5-"), { pdMm: 5, recMm: null });
  });

  it('parsea "-2" (sólo rec, encía sobre CEJ) como pd=null rec=-2', () => {
    assert.deepEqual(parsePdRecInput("-2"), { pdMm: null, recMm: -2 });
  });

  it('parsea "5--2" como pd=5 rec=-2', () => {
    assert.deepEqual(parsePdRecInput("5--2"), { pdMm: 5, recMm: -2 });
  });

  it("permite espacios alrededor", () => {
    assert.deepEqual(parsePdRecInput(" 5-2 "), { pdMm: 5, recMm: 2 });
  });

  it("rechaza pd > 15", () => {
    const out = parsePdRecInput("99-2");
    assert.equal(out.pdMm, null);
  });

  it("rechaza rec > 15", () => {
    const out = parsePdRecInput("5-99");
    assert.equal(out.recMm, null);
  });

  it("rechaza rec < -5", () => {
    const out = parsePdRecInput("5--6");
    assert.equal(out.recMm, null);
  });

  it("rechaza inputs con letras", () => {
    assert.deepEqual(parsePdRecInput("abc"), { pdMm: null, recMm: null });
  });

  it("trata input vacío como nulls", () => {
    assert.deepEqual(parsePdRecInput(""), { pdMm: null, recMm: null });
    assert.deepEqual(parsePdRecInput("   "), { pdMm: null, recMm: null });
  });
});
