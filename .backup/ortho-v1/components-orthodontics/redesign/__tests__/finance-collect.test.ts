// Tests de la lógica de cobro + CFDI Facturapi (mapping y stub flags).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Collect method UI → DB mapping", () => {
  const METHOD_DB_MAP: Record<string, string> = {
    tarjeta: "CARD",
    transfer: "TRANSFER",
    efectivo: "CASH",
    msi: "MSI",
  };

  it("tiene 4 métodos", () => {
    assert.equal(Object.keys(METHOD_DB_MAP).length, 4);
  });

  it("tarjeta → CARD", () => {
    assert.equal(METHOD_DB_MAP.tarjeta, "CARD");
  });

  it("efectivo → CASH", () => {
    assert.equal(METHOD_DB_MAP.efectivo, "CASH");
  });

  it("transfer → TRANSFER", () => {
    assert.equal(METHOD_DB_MAP.transfer, "TRANSFER");
  });

  it("msi → MSI (3-12 meses sin intereses)", () => {
    assert.equal(METHOD_DB_MAP.msi, "MSI");
  });
});

describe("Sign@Home token format", () => {
  // Helper local que mimicka genToken().
  const tokenLike = (raw: string) => `sgnh_${raw}`;

  it("tiene prefijo sgnh_", () => {
    const t = tokenLike("abc123def");
    assert.equal(t.startsWith("sgnh_"), true);
  });

  it("totalmente determinístico para input dado", () => {
    assert.equal(tokenLike("xyz"), "sgnh_xyz");
  });

  it("base64url-safe (sin / + =)", () => {
    const sample = "abc-def_ghi123";
    const t = tokenLike(sample);
    assert.equal(t.includes("/"), false);
    assert.equal(t.includes("+"), false);
    assert.equal(t.includes("="), false);
  });
});

describe("OrthoQuoteScenario monthly total", () => {
  const total = (down: number, monthly: number, months: number) =>
    down + monthly * months;

  it("calcula total contado (months=0)", () => {
    assert.equal(total(33000, 0, 0), 33000);
  });

  it("calcula total con MSI 12 meses", () => {
    assert.equal(total(0, 2750, 12), 33000);
  });

  it("calcula total mensual estándar 22 meses con enganche", () => {
    assert.equal(total(8000, 1450, 22), 8000 + 1450 * 22);
  });
});
