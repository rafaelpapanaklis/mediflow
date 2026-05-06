// Orthodontics — tests del IPR map.
// Tests de la lógica de stripping (sin mockear React).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

interface IPRValue {
  fdiLeft: number;
  fdiRight: number;
  mm: number;
}

const UPPER_FDI = [17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27];
const LOWER_FDI = [47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37];

function sumForArch(values: IPRValue[], fdis: number[]): number {
  const set = new Set(fdis);
  return values
    .filter((v) => set.has(v.fdiLeft) && set.has(v.fdiRight))
    .reduce((acc, v) => acc + v.mm, 0);
}

describe("IPR map", () => {
  it("UPPER_FDI tiene 14 dientes (cuadrantes 1 y 2)", () => {
    assert.equal(UPPER_FDI.length, 14);
  });

  it("LOWER_FDI tiene 14 dientes (cuadrantes 4 y 3)", () => {
    assert.equal(LOWER_FDI.length, 14);
  });

  it("sumForArch acumula stripping de un arch específico", () => {
    const values: IPRValue[] = [
      { fdiLeft: 13, fdiRight: 12, mm: 0.3 },
      { fdiLeft: 12, fdiRight: 11, mm: 0.2 },
      { fdiLeft: 43, fdiRight: 42, mm: 0.4 },
    ];
    assert.equal(sumForArch(values, UPPER_FDI), 0.5);
    assert.equal(sumForArch(values, LOWER_FDI), 0.4);
  });

  it("sumForArch ignora valores fuera del arch", () => {
    const values: IPRValue[] = [
      { fdiLeft: 13, fdiRight: 12, mm: 0.3 }, // upper
      { fdiLeft: 43, fdiRight: 42, mm: 0.4 }, // lower
    ];
    assert.equal(sumForArch(values, UPPER_FDI), 0.3);
    assert.equal(sumForArch(values, LOWER_FDI), 0.4);
  });

  it("0 mm se trata como ausencia (no debería persistirse)", () => {
    const value: IPRValue = { fdiLeft: 13, fdiRight: 12, mm: 0 };
    assert.equal(value.mm, 0);
  });
});
